"""Clan Organizer - local Clash of Clans clan manager.
Run:  python app.py   then open http://localhost:5000
"""
import datetime as dt
import functools
import hmac
import json
import os
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

HERE = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).parent)   # bundled files (static/) live here when packaged
CFG_FILE = Path(os.environ.get("CONFIG_FILE") or HERE / "config.json")
DATA = Path(os.environ.get("DATA_DIR") or HERE / "data")
CLANS_FILE = DATA / "clans.json"
LOCK = threading.Lock()
STATE = {}


def st(clan):
    return STATE.setdefault(clan, {"syncing": False, "errors": []})


def norm(tag):
    tag = (tag or "").strip().upper().replace("O", "0")
    if not tag:
        return ""
    return tag if tag.startswith("#") else "#" + tag


def load_cfg():
    cfg = {"base_url": "https://cocproxy.royaleapi.dev/v1", "sync_minutes": 60, "games_max": 4000}
    if CFG_FILE.exists():
        cfg.update(json.loads(CFG_FILE.read_text(encoding="utf-8")))
    cfg["api_key"] = os.environ.get("COC_API_KEY", cfg.get("api_key", "")).strip()
    cfg["clan_tag"] = norm(os.environ.get("COC_CLAN_TAG", cfg.get("clan_tag", "")))
    cfg["base_url"] = os.environ.get("COC_BASE_URL", cfg["base_url"])
    cfg["host"] = os.environ.get("HOST", cfg.get("host", "127.0.0.1"))
    cfg["port"] = int(os.environ.get("PORT", cfg.get("port", 5000)))
    cfg["admin_password"] = os.environ.get("ADMIN_PASSWORD", cfg.get("admin_password", ""))
    cfg["max_clans"] = int(os.environ.get("MAX_CLANS", cfg.get("max_clans", 20)))
    cfg["sync_minutes"] = int(os.environ.get("SYNC_MINUTES", cfg.get("sync_minutes", 60)))
    public = cfg["host"] not in ("127.0.0.1", "localhost")
    cfg["sync_cooldown"] = int(os.environ.get("SYNC_COOLDOWN", cfg.get("sync_cooldown", 300 if public else 0)))
    return cfg


CFG = load_cfg()


class ApiError(Exception):
    pass


def q(tag):
    return quote(tag, safe="")


def api(path):
    r = requests.get(CFG["base_url"].rstrip("/") + path,
                     headers={"Authorization": "Bearer " + CFG["api_key"]}, timeout=25)
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        try:
            j = r.json()
        except Exception:
            j = {}
        reason = j.get("reason") or j.get("message") or r.text[:120]
        hint = ""
        if r.status_code == 403:
            hint = " (key rejected, or the war log is private. With the RoyaleAPI proxy the key must allow IP 45.79.218.79)"
        raise ApiError(f"{r.status_code} {reason}{hint} on {path}")
    return r.json()


# ---------------------------------------------------------------- database
SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots(tag TEXT, ts INTEGER, name TEXT, role TEXT, th INTEGER,
  trophies INTEGER, donations INTEGER, received INTEGER, war_stars INTEGER, attack_wins INTEGER,
  games INTEGER, capital INTEGER, upgrades INTEGER, weight INTEGER, heroes TEXT, league INTEGER DEFAULT 0,
  league_name TEXT, league_icon TEXT, PRIMARY KEY(tag, ts));
CREATE TABLE IF NOT EXISTS wars(key TEXT PRIMARY KEY, kind TEXT, season TEXT, state TEXT, end_ts INTEGER);
CREATE TABLE IF NOT EXISTS participants(key TEXT, tag TEXT, name TEXT, avail INTEGER, PRIMARY KEY(key, tag));
CREATE TABLE IF NOT EXISTS attacks(key TEXT, tag TEXT, att_th INTEGER, def_th INTEGER, stars INTEGER,
  dest REAL, ord INTEGER, PRIMARY KEY(key, ord));
CREATE TABLE IF NOT EXISTS raids(season TEXT, tag TEXT, name TEXT, attacks INTEGER, looted INTEGER,
  PRIMARY KEY(season, tag));
CREATE TABLE IF NOT EXISTS joined(tag TEXT PRIMARY KEY, ts INTEGER);
CREATE TABLE IF NOT EXISTS ckjoin(tag TEXT PRIMARY KEY, first_join INTEGER, days REAL, checked INTEGER);
CREATE TABLE IF NOT EXISTS cwlraw(key TEXT PRIMARY KEY, season TEXT, round INTEGER, state TEXT, json TEXT);
CREATE TABLE IF NOT EXISTS blcache(tag TEXT PRIMARY KEY, checked INTEGER, json TEXT);
CREATE TABLE IF NOT EXISTS ledger(tag TEXT PRIMARY KEY, career REAL, here REAL, updated INTEGER);
CREATE TABLE IF NOT EXISTS phist(key TEXT, tag TEXT, end_ts INTEGER, kind TEXT, avail INTEGER, att_th INTEGER, atks TEXT, PRIMARY KEY(key, tag));
CREATE TABLE IF NOT EXISTS ckwar(tag TEXT PRIMARY KEY, checked INTEGER, n INTEGER);
CREATE TABLE IF NOT EXISTS rosterlog(ts INTEGER, tag TEXT, name TEXT, th INTEGER, role TEXT, PRIMARY KEY(ts, tag));
CREATE TABLE IF NOT EXISTS warlog(end_ts INTEGER PRIMARY KEY, result TEXT, team INTEGER, per_member INTEGER, stars INTEGER, destr REAL, o_stars INTEGER, o_destr REAL, o_name TEXT);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
"""


def clan_db_path(clan):
    return DATA / (clan.lstrip("#") + ".db")


def save_clans(lst):
    DATA.mkdir(exist_ok=True)
    CLANS_FILE.write_text(json.dumps(lst), encoding="utf-8")


def load_clans():
    DATA.mkdir(exist_ok=True)
    if CLANS_FILE.exists():
        return json.loads(CLANS_FILE.read_text(encoding="utf-8"))
    seed = [CFG["clan_tag"]] if CFG["clan_tag"] else []
    old = HERE / "clan.db"
    if seed and old.exists() and not clan_db_path(seed[0]).exists():
        old.rename(clan_db_path(seed[0]))
    save_clans(seed)
    return seed


def db(clan):
    DATA.mkdir(exist_ok=True)
    con = sqlite3.connect(clan_db_path(clan), timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    for col, typ in (("league", "INTEGER DEFAULT 0"), ("league_name", "TEXT"), ("league_icon", "TEXT"), ("don_total", "INTEGER DEFAULT 0"), ("conq_total", "INTEGER DEFAULT 0"),
                     ("cwl_total", "INTEGER"), ("raid_total", "INTEGER"), ("spell_total", "INTEGER"), ("siege_total", "INTEGER"),
                     ("def_total", "INTEGER"), ("best_trophies", "INTEGER")):
        try:
            con.execute(f"ALTER TABLE snapshots ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    for col, typ in (("career", "REAL"), ("others", "TEXT"), ("cur_since", "INTEGER")):
        try:
            con.execute(f"ALTER TABLE ckjoin ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    return con


def set_meta(con, k, v):
    con.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, json.dumps(v)))


def get_meta(con, k, default=None):
    r = con.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return json.loads(r["v"]) if r else default


# ---------------------------------------------------------------- syncing
HERO_CODES = {"Barbarian King": "BK", "Archer Queen": "AQ", "Grand Warden": "GW",
              "Royal Champion": "RC", "Minion Prince": "MP"}


def parse_player(p, ts):
    ach = {a["name"]: a.get("value", 0) for a in p.get("achievements", [])}
    heroes = {HERO_CODES.get(h["name"], h["name"]): h["level"]
              for h in p.get("heroes", []) if h.get("village") == "home"}
    other = sum(t["level"] for t in p.get("troops", [])
                if t.get("village") == "home" and "superTroopIsActive" not in t)
    other += sum(s["level"] for s in p.get("spells", []))
    other += sum(e["level"] for e in p.get("heroEquipment", []))
    hero_total = sum(heroes.values())
    return dict(tag=p["tag"], ts=ts, name=p["name"], role=p.get("role", "member"),
                th=p.get("townHallLevel", 0), trophies=p.get("trophies", 0),
                donations=p.get("donations", 0), received=p.get("donationsReceived", 0),
                war_stars=p.get("warStars", 0), attack_wins=p.get("attackWins", 0),
                games=ach.get("Games Champion", 0), capital=ach.get("Most Valuable Clanmate", 0),
                upgrades=hero_total * 3 + other, weight=hero_total * 4 + other,
                heroes=json.dumps(heroes), league=league_tier(p), league_name=(p.get("leagueTier") or {}).get("name", ""),
                league_icon=((p.get("leagueTier") or {}).get("iconUrls") or {}).get("large", ""),
                don_total=ach.get("Friend in Need", 0), conq_total=ach.get("Conqueror", 0),
                cwl_total=ach.get("War League Legend"), raid_total=ach.get("Aggressive Capitalism"), spell_total=ach.get("Sharing is caring"),
                siege_total=ach.get("Siege Sharer"), def_total=ach.get("Unbreakable"), best_trophies=p.get("bestTrophies", 0))


def league_tier(p):
    # Ranked-battle league tiers have ids 105000001 (lowest) up to Legend I; tier number = id - 105000000.
    tid = (p.get("leagueTier") or {}).get("id") or 0
    return tid - 105000000 if tid > 105000000 else 0


def coc_time(s):
    try:
        return int(dt.datetime.strptime(s, "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=dt.timezone.utc).timestamp())
    except Exception:
        return 0


def store_war(con, clan, w, kind, key, season=""):
    mine, theirs = (w["clan"], w["opponent"]) if norm(w["clan"]["tag"]) == clan else (w["opponent"], w["clan"])
    state = w.get("state", "")
    if state in ("preparation", "notInWar"):
        return
    their_th = {m["tag"]: m["townhallLevel"] for m in theirs.get("members", [])}
    avail = 2 if kind == "war" else 1
    con.execute("INSERT OR REPLACE INTO wars VALUES(?,?,?,?,?)", (key, kind, season, state, coc_time(w.get("endTime", ""))))
    con.execute("DELETE FROM participants WHERE key=?", (key,))
    con.execute("DELETE FROM attacks WHERE key=?", (key,))
    for m in mine.get("members", []):
        con.execute("INSERT OR REPLACE INTO participants VALUES(?,?,?,?)", (key, m["tag"], m["name"], avail))
        for a in m.get("attacks", []) or []:
            con.execute("INSERT OR REPLACE INTO attacks VALUES(?,?,?,?,?,?,?)",
                        (key, m["tag"], m.get("townhallLevel", 0), their_th.get(a["defenderTag"], 0),
                         a.get("stars", 0), a.get("destructionPercentage", 0), a.get("order", 0)))


def sync_war(con, clan):
    w = api(f"/clans/{q(clan)}/currentwar")
    set_meta(con, "war_state", (w or {}).get("state") or "notInWar")
    if w and w.get("state") not in (None, "notInWar"):
        store_war(con, clan, w, "war", f"war:{w['clan']['tag']}:{w.get('startTime')}")


def sync_cwl(con, clan):
    now = int(time.time())
    try:
        g = api(f"/clans/{q(clan)}/currentwar/leaguegroup")
    except ApiError as e:
        set_meta(con, "cwl_check", {"ts": now, "result": "error", "detail": f"The game answered with an error: {e}"})
        raise
    if not g:
        set_meta(con, "cwl_check", {"ts": now, "result": "not_in_group", "detail": "The game says this clan is not in a Clan War League group right now (it returned 'not found'). If your clan did sign up, the group may not be formed yet."})
        return
    if g.get("state") in (None, "notInWar"):
        set_meta(con, "cwl_check", {"ts": now, "result": "not_in_war", "detail": "The game answered, but with no active league group (state: notInWar)."})
        return
    set_meta(con, "cwl_check", {"ts": now, "result": "in_group", "detail": f"In a league group, season {g.get('season')}, state {g.get('state')}."})
    season = g.get("season", "")
    started = sum(1 for r_ in g.get("rounds", []) if any(w_ != "#0" for w_ in r_.get("warTags", [])))
    set_meta(con, "cwl", {"season": season, "state": g.get("state"), "round": started})
    set_meta(con, "cwl_group", {"season": season, "clans": [
        {"tag": norm(c_.get("tag", "")), "name": c_.get("name", ""), "level": c_.get("clanLevel"),
         "members": [{"tag": m_.get("tag"), "name": m_.get("name"), "th": m_.get("townHallLevel", 0)} for m_ in c_.get("members", [])]}
        for c_ in g.get("clans", [])]})
    for ri, rnd in enumerate(g.get("rounds", []), 1):
        for wt in rnd.get("warTags", []):
            if wt == "#0":
                continue
            key = f"cwl:{season}:{wt}"
            if con.execute("SELECT 1 FROM cwlraw WHERE key=? AND state='warEnded'", (key,)).fetchone():
                continue
            w = api(f"/clanwarleagues/wars/{q(wt)}")
            if not w:
                continue
            con.execute("INSERT OR REPLACE INTO cwlraw VALUES(?,?,?,?,?)", (key, season, ri, w.get("state", ""), json.dumps(w)))
            if clan in (norm(w["clan"]["tag"]), norm(w["opponent"]["tag"])):
                store_war(con, clan, w, "cwl", key, season)


def sync_raids(con, clan):
    r = api(f"/clans/{q(clan)}/capitalraidseasons?limit=6")
    for s in (r or {}).get("items", []):
        for m in s.get("members", []):
            con.execute("INSERT OR REPLACE INTO raids VALUES(?,?,?,?,?)",
                        (s["endTime"], m["tag"], m["name"], m.get("attacks", 0), m.get("capitalResourcesLooted", 0)))


# ---- join history from ClashKing (a free third-party service that tracks clan history; the official API has none)
CK_BASE = "https://api.clashk.ing"


def ck_time(v):
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.replace(".", "", 1).isdigit()):
        x = float(v)
        return int(x / 1000 if x > 1e12 else x)
    s = str(v).strip()
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return int((d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).timestamp())
    except ValueError:
        pass
    ts = coc_time(s)
    if ts:
        return ts
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return int(dt.datetime.strptime(s, f).replace(tzinfo=dt.timezone.utc).timestamp())
        except ValueError:
            pass
    return 0


def ck_items(data):
    """Pull the list of events out of whatever shape the service answers with."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("items", "data", "events", "history", "results"):
            if isinstance(data.get(k), list):
                return data[k]
    return []


def ck_event(it):
    """One join/leave event -> (clan_tag, clan_name, kind, ts) or None. Accepts several field spellings."""
    if not isinstance(it, dict):
        return None
    ty = str(it.get("type") or it.get("event") or it.get("action") or "").lower()
    kind = "join" if "join" in ty else ("leave" if any(w in ty for w in ("leave", "left", "kick", "remov")) else None)
    ts = ck_time(it.get("time") or it.get("timestamp") or it.get("date") or it.get("created_at"))
    c_ = it.get("clan")
    ctag = norm(str((c_.get("tag") if isinstance(c_, dict) else c_) or it.get("clan_tag") or it.get("clanTag") or ""))
    cname = it.get("clan_name") or (c_.get("name") if isinstance(c_, dict) else None) or ctag
    return (ctag, cname, kind, ts) if (kind and ts and ctag) else None


def ck_all(items, now):
    """Join/leave events grouped by clan -> {clan_tag: {name, first, days, since}} (days across every stint)."""
    by = {}
    for it in items or []:
        e = ck_event(it)
        if e:
            by.setdefault(e[0], {"name": e[1], "ev": []})["ev"].append((e[3], e[2]))
    out = {}
    for ctag, v in by.items():
        total, start, first = 0, None, None
        for ts, kind in sorted(v["ev"]):
            if kind == "join":
                if start is None:
                    start, first = ts, first or ts
            elif start is not None:
                total += max(0, ts - start)
                start = None
        since = start
        if start is not None:
            total += max(0, now - start)
        if first:
            out[ctag] = {"name": v["name"], "first": first, "days": round(total / 86400, 2), "since": since}
    return out


def ck_stints(items, clan, now):
    """First join and days in THIS clan, plus career days across all clans and the other clans they were in."""
    allc = ck_all(items, now)
    if not allc:
        return None
    mine = allc.get(clan)
    others = sorted(({"name": v["name"], "days": v["days"]} for k, v in allc.items() if k != clan), key=lambda x: -x["days"])[:6]
    return {"first_join": mine["first"] if mine else None, "days": mine["days"] if mine else None,
            "cur_since": mine["since"] if mine else None,
            "career": round(sum(v["days"] for v in allc.values()), 2), "others": others}


def ck_fetch(tag):
    r = requests.get(f"{CK_BASE}/player/{q(tag)}/join-leave", params={"limit": 200}, timeout=12)
    if r.status_code != 200:
        raise ApiError(f"ClashKing answered {r.status_code}")
    return ck_items(r.json())


def ck_war_fetch(tag):
    r = requests.get(f"{CK_BASE}/player/{q(tag)}/warhits", params={"limit": 12}, timeout=25)
    if r.status_code != 200:
        raise ApiError(f"ClashKing answered {r.status_code}")
    return ck_items(r.json())


def n0(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def ck_war_rows(items, tag, now):
    """A player's past wars from ClashKing -> one row per war with their attacks (stars, defender town hall)."""
    rows = []
    for it in items or []:
        wd = (it.get("war_data") if isinstance(it, dict) else None) or it
        if not isinstance(wd, dict):
            continue
        typ = str(wd.get("type", "")).lower()
        end_ts = coc_time(str(wd.get("endTime", ""))) or ck_time(wd.get("endTime"))
        if "friendly" in typ or not end_ts or end_ts > now:
            continue
        kind = "cwl" if ("cwl" in typ or "league" in typ) else "war"
        for side, other in (("clan", "opponent"), ("opponent", "clan")):
            s = wd.get(side) or {}
            mem = next((m for m in (s.get("members") or []) if isinstance(m, dict) and m.get("tag") == tag), None)
            if mem:
                oth = {m.get("tag"): n0(m.get("townhallLevel")) for m in ((wd.get(other) or {}).get("members") or []) if isinstance(m, dict)}
                atks = [{"d": oth.get(a.get("defenderTag"), 0), "s": n0(a.get("stars")), "p": n0(a.get("destructionPercentage"))}
                        for a in (mem.get("attacks") or []) if isinstance(a, dict)]
                avail = n0(wd.get("attacksPerMember")) or (1 if kind == "cwl" else 2)
                rows.append((f"ck:{s.get('tag', '')}:{end_ts}", tag, end_ts, kind, avail, n0(mem.get("townhallLevel")), json.dumps(atks)))
                break
    return rows


def sync_joins(con, clan, tags):
    """Refresh join history for members not checked in the last 24 hours. Returns a note for the UI, or None."""
    now = int(time.time())
    fresh = {r["tag"] for r in con.execute("SELECT tag FROM ckjoin WHERE checked>?", (now - 86400,))}
    todo = [x for x in tags if x not in fresh][:80]
    if not todo:
        return None

    def one(x):
        try:
            return x, ck_fetch(x), None
        except Exception as e:
            return x, None, str(e)

    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, todo))
    ok = [(x, it) for x, it, err in res if err is None]
    known = con.execute("SELECT COUNT(*) n FROM ckjoin WHERE first_join IS NOT NULL").fetchone()["n"]
    if not ok:
        return None if known else "Join history (ClashKing) could not be reached, so days in clan use the day the app first saw each player. " + res[0][2]
    found = 0
    for x, it in ok:
        st = ck_stints(it, clan, now)
        found += 1 if (st and st["first_join"]) else 0
        con.execute("INSERT OR REPLACE INTO ckjoin(tag, first_join, days, checked, career, others, cur_since) VALUES(?,?,?,?,?,?,?)",
                    (x, st["first_join"] if st else None, st["days"] if st else None, now, st["career"] if st else None,
                     json.dumps(st["others"]) if st else None, st["cur_since"] if st else None))
    if found + known == 0:
        return "ClashKing has no join records for this clan yet, so days in clan use the day the app first saw each player. You can still set real dates on a player's card."
    return None


def sync_warhits(con, clan, tags):
    """Backfill each member's past war attacks from ClashKing (once a day per player), so impact works for new clans."""
    now = int(time.time())
    fresh = {r["tag"] for r in con.execute("SELECT tag FROM ckwar WHERE checked>?", (now - 86400,))}
    todo = [x for x in tags if x not in fresh][:80]
    if not todo:
        return 0

    def one(x):
        try:
            return x, ck_war_fetch(x), None
        except Exception as e:
            return x, None, str(e)

    with ThreadPoolExecutor(3) as ex:
        res = list(ex.map(one, todo))
    n = 0
    for x, items, err in res:
        if err:
            continue
        rows = ck_war_rows(items, x, now)
        for r in rows:
            con.execute("INSERT OR REPLACE INTO phist VALUES(?,?,?,?,?,?,?)", r)
        n += len(rows)
        con.execute("INSERT OR REPLACE INTO ckwar VALUES(?,?,?)", (x, now, len(rows)))
    return n


def sync_warlog(con, clan):
    w = api(f"/clans/{q(clan)}/warlog?limit=50")
    for it in (w or {}).get("items", []):
        end = coc_time(it.get("endTime", ""))
        if end:
            c_, o_ = it.get("clan") or {}, it.get("opponent") or {}
            con.execute("INSERT OR REPLACE INTO warlog VALUES(?,?,?,?,?,?,?,?,?)",
                        (end, it.get("result"), it.get("teamSize"), it.get("attacksPerMember"), c_.get("stars"),
                         c_.get("destructionPercentage"), o_.get("stars"), o_.get("destructionPercentage"), o_.get("name")))


def sync(clan):
    if not CFG["api_key"]:
        raise ApiError("Set api_key in config.json, then restart.")
    errors, ts = [], int(time.time())
    info = api("/clans/" + q(clan))
    if not info:
        raise ApiError("Clan not found. Check the clan tag.")
    members = api(f"/clans/{q(clan)}/members")["items"]

    def fetch(m):
        try:
            return api("/players/" + q(m["tag"]))
        except Exception as e:
            errors.append(f"{m['name']}: {e}")

    with ThreadPoolExecutor(6) as ex:
        players = [p for p in ex.map(fetch, members) if p]
    con = db(clan)
    cols = "tag,ts,name,role,th,trophies,donations,received,war_stars,attack_wins,games,capital,upgrades,weight,heroes,league,league_name,league_icon,don_total,conq_total,cwl_total,raid_total,spell_total,siege_total,def_total,best_trophies"
    for m_ in members:
        con.execute("INSERT OR REPLACE INTO rosterlog VALUES(?,?,?,?,?)", (ts, m_["tag"], m_.get("name", ""), m_.get("townHallLevel", 0), m_.get("role", "member")))
    for p in players:
        con.execute(f"INSERT OR REPLACE INTO snapshots({cols}) VALUES({','.join(':' + c for c in cols.split(','))})", parse_player(p, ts))
    try:
        set_meta(con, "ck_note", sync_joins(con, clan, [p["tag"] for p in players]))
    except Exception as e:
        errors.append(f"sync_joins: {e}")
    try:
        sync_warhits(con, clan, [p["tag"] for p in players])
    except Exception as e:
        errors.append(f"sync_warhits: {e}")
    set_meta(con, "clan", {"name": info["name"], "level": info.get("clanLevel"), "members": len(members),
                           "war_log_public": info.get("isWarLogPublic")})
    for fn in (sync_war, sync_cwl, sync_raids, sync_warlog):
        try:
            fn(con, clan)
        except Exception as e:
            errors.append(f"{fn.__name__}: {e}")
    set_meta(con, "last_sync", ts)
    con.commit()
    con.close()
    return errors


def run_sync(clan):
    s = st(clan)
    if s["syncing"]:
        return s["errors"]
    with LOCK:
        s["syncing"] = True
        try:
            s["errors"] = sync(clan)
        except Exception as e:
            s["errors"] = [str(e)]
        finally:
            s["syncing"] = False
    return s["errors"]


def war_active(clan):
    con = db(clan)
    ws, cw = get_meta(con, "war_state"), get_meta(con, "cwl") or {}
    con.close()
    return ws in ("preparation", "inWar") or cw.get("state") in ("preparation", "inWar")


def run_war_sync(clan):
    """Light sync (war + CWL only) so attacks are captured while a war is running."""
    s = st(clan)
    if s["syncing"]:
        return
    with LOCK:
        s["syncing"] = True
        try:
            con = db(clan)
            for fn in (sync_war, sync_cwl):
                try:
                    fn(con, clan)
                except Exception:
                    pass
            con.commit()
            con.close()
        finally:
            s["syncing"] = False


def scheduler():
    last_full, last_light = {}, {}
    while True:
        try:
            if CFG["api_key"]:
                now = time.time()
                for clan in load_clans():
                    try:
                        if now - last_full.get(clan, 0) >= max(10, CFG["sync_minutes"]) * 60:
                            run_sync(clan)
                            last_full[clan] = last_light[clan] = time.time()
                            time.sleep(3)
                        elif now - last_light.get(clan, 0) >= 600 and war_active(clan):
                            run_war_sync(clan)
                            last_light[clan] = time.time()
                    except Exception as e:           # keep the loop alive whatever happens
                        print("scheduler:", clan, e, flush=True)
        except Exception as e:
            print("scheduler:", e, flush=True)
        time.sleep(120)


# ---------------------------------------------------------------- scoring
# War weight = town hall + heroes + everything else (troops, spells, siege, pets, equipment).
# Tune these three numbers if the ranking feels off.
TH_WEIGHT, HERO_WEIGHT, OTHER_WEIGHT = 250, 5, 2

# Ranked league tiers are only used for the "Ranked overachievers" board now.
# These expected tiers are a rough guess (tier 1 = lowest ranked league, 34-36 = Legend III-I). Edit freely.
EXPECTED_TIER = {7: 4, 8: 6, 9: 9, 10: 12, 11: 15, 12: 19, 13: 23, 14: 27, 15: 30, 16: 32, 17: 33}

# Impact: stars on every attack, scaled by the attacker's own town hall (a higher town hall is worth more)
# and by how far up or down the target was. Both use the same step per town hall level.
IMPACT_TH_STEP, IMPACT_HITUP_STEP, IMPACT_HITUP_MAX = 0.08, 0.08, 3

# Prestige: what a clanmate is worth to the clan. Each part is ranked inside your clan, then blended.
PRESTIGE_MIX = {"days": 0.50, "war": 0.15, "capital": 0.15, "games": 0.10, "donated": 0.10}   # all measured inside THIS clan

# Total value (0-100): weighted blend of the other scores. Missing scores are left out and the rest re-weighted.
TOTAL_MIX = {"impact": 0.30, "prestige": 0.25, "activity": 0.25, "weight": 0.20}


def expected_tier(th):
    return EXPECTED_TIER.get(th, 33 if th > 17 else 4)


def calc_weight(c, heroes):
    hs = sum(heroes.values())
    return round(c["th"] * TH_WEIGHT + hs * HERO_WEIGHT + max(0, c["upgrades"] - 3 * hs) * OTHER_WEIGHT)


def pct_scores(raw):
    vals = sorted(raw.values())
    if not vals or vals[-1] <= 0:
        return {t: 0 for t in raw}
    n = len(vals)
    return {t: round(100 * (sum(1 for x in vals if x < v) + 0.5 * sum(1 for x in vals if x == v)) / n, 1)
            for t, v in raw.items()}


def clip(x, a, b):
    return max(a, min(b, x))


def games_window(now):
    d = dt.datetime.fromtimestamp(now, dt.timezone.utc)
    y, m = (d.year, d.month) if d.day >= 22 else ((d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12))
    start = dt.datetime(y, m, 22, tzinfo=dt.timezone.utc)
    return int(start.timestamp()), int((start + dt.timedelta(days=7)).timestamp())


def other_dbs(clan):
    """Open the saved history of every OTHER clan tracked on this site (a player's records follow them)."""
    res = []
    for f in sorted(DATA.glob("*.db")):
        tag = "#" + f.stem
        if tag != clan:
            try:
                res.append((tag, db(tag)))
            except Exception:
                pass
    return res


def build_members(con, days, clan=None):
    cur_ts = con.execute("SELECT MAX(ts) m FROM snapshots").fetchone()["m"]
    if not cur_ts:
        return [], 0
    cur = {r["tag"]: dict(r) for r in con.execute("SELECT * FROM snapshots WHERE ts=?", (cur_ts,))}
    since = cur_ts - days * 86400
    ths = sorted(c["th"] for c in cur.values()) or [0]
    ref_th = ths[len(ths) // 2]
    att_f = lambda th: clip(1 + IMPACT_TH_STEP * (th - ref_th), 0.7, 1.4)
    hit_f = lambda a_, d_: 1 + IMPACT_HITUP_STEP * clip(d_ - a_, -IMPACT_HITUP_MAX, IMPACT_HITUP_MAX) if d_ else 1.0
    f_max = att_f(ths[-1])
    first_seen = {r["tag"]: r["m"] for r in con.execute("SELECT tag, MIN(ts) m FROM snapshots GROUP BY tag")}
    joined_ts = {r["tag"]: r["ts"] for r in con.execute("SELECT tag, ts FROM joined")}
    ck = {r["tag"]: r for r in con.execute("SELECT tag, first_join, days, career, others, cur_since FROM ckjoin")}
    b = con.execute("SELECT MAX(ts) m FROM snapshots WHERE ts<=?", (since,)).fetchone()["m"]
    if b is None:
        b = con.execute("SELECT MIN(ts) m FROM snapshots").fetchone()["m"]
    base = {r["tag"]: dict(r) for r in con.execute("SELECT * FROM snapshots WHERE ts=?", (b,))} if b < cur_ts else {}
    history_days = round((cur_ts - b) / 86400, 1) if base else 0

    # ---- carry data over from the player's old clan when this clan has little or none of its own
    olds = other_dbs(clan) if clan else []
    old_name = {otag: (get_meta(oc, "clan") or {}).get("name", otag) for otag, oc in olds}
    carried, base_old, old_wa = {}, {}, {}
    for tg in cur:
        if tg in base:
            continue
        for otag, oc in olds:
            r = oc.execute("SELECT * FROM snapshots WHERE tag=? AND ts<=? ORDER BY ts DESC LIMIT 1", (tg, since)).fetchone()
            if r and r["ts"] < since - 3 * 86400:
                r = None
            r = r or oc.execute("SELECT * FROM snapshots WHERE tag=? AND ts>? ORDER BY ts ASC LIMIT 1", (tg, since)).fetchone()
            if r and r["ts"] < cur_ts:
                base_old[tg] = dict(r)
                old_wa[tg] = oc.execute("SELECT COUNT(*) n FROM attacks a JOIN wars w ON w.key=a.key WHERE a.tag=? AND w.end_ts>=?", (tg, since)).fetchone()["n"]
                carried.setdefault(tg, {})["activity"] = f"Compared with their activity in {old_name[otag]}, because they only just joined this clan."
                break
    conns = [con] + [oc for _, oc in olds]

    def presence(tag, cs):
        s = set()
        for c_ in cs:
            for r_ in c_.execute("SELECT DISTINCT date(ts,'unixepoch') d FROM snapshots WHERE tag=?", (tag,)):
                s.add(r_["d"])
        return len(s)

    war_att = {r["tag"]: r["n"] for r in con.execute(
        "SELECT a.tag, COUNT(*) n FROM attacks a JOIN wars w ON w.key=a.key WHERE w.end_ts>=? GROUP BY a.tag", (since,))}

    ended = [r["key"] for r in con.execute("SELECT key FROM wars WHERE state='warEnded' ORDER BY end_ts DESC LIMIT 20")]
    avail, used, impact_sum = {}, {}, {}
    if ended:
        ph = ",".join("?" * len(ended))
        for r in con.execute(f"SELECT tag, SUM(avail) a FROM participants WHERE key IN ({ph}) GROUP BY tag", ended):
            avail[r["tag"]] = r["a"]
        for r in con.execute(f"SELECT tag, att_th, def_th, stars FROM attacks WHERE key IN ({ph})", ended):
            used[r["tag"]] = used.get(r["tag"], 0) + 1
            v = r["stars"] * att_f(r["att_th"]) * hit_f(r["att_th"], r["def_th"])
            impact_sum[r["tag"]] = impact_sum.get(r["tag"], 0) + v

    old_av, old_sum, thin = {}, {}, {x for x in cur if avail.get(x, 0) < 4}
    for otag, oc in olds:
        ended_o = [r["key"] for r in oc.execute("SELECT key FROM wars WHERE state='warEnded' ORDER BY end_ts DESC LIMIT 20")]
        if not ended_o:
            continue
        ph_ = ",".join("?" * len(ended_o))
        for r in oc.execute(f"SELECT tag, SUM(avail) a FROM participants WHERE key IN ({ph_}) GROUP BY tag", ended_o):
            if r["tag"] in thin and r["a"]:
                old_av[r["tag"]] = old_av.get(r["tag"], 0) + r["a"]
                carried.setdefault(r["tag"], {}).setdefault("_from", []).append(old_name[otag])
        for r in oc.execute(f"SELECT tag, att_th, def_th, stars FROM attacks WHERE key IN ({ph_})", ended_o):
            if r["tag"] in thin:
                old_sum[r["tag"]] = old_sum.get(r["tag"], 0) + r["stars"] * att_f(r["att_th"]) * hit_f(r["att_th"], r["def_th"])
    hist_av, hist_sum, local_ends, cnt = {}, {}, {}, {}
    for r in con.execute("SELECT p.tag, w.end_ts FROM participants p JOIN wars w ON w.key=p.key WHERE w.state='warEnded'"):
        local_ends.setdefault(r["tag"], []).append(r["end_ts"])
    for r in con.execute("SELECT tag, end_ts, kind, avail, att_th, atks FROM phist WHERE end_ts<=? ORDER BY end_ts DESC", (cur_ts,)):
        tg = r["tag"]
        if tg not in thin or cnt.get(tg, 0) >= 10 or any(abs(e - r["end_ts"]) < 3600 for e in local_ends.get(tg, [])):
            continue
        cnt[tg] = cnt.get(tg, 0) + 1
        hist_av[tg] = hist_av.get(tg, 0) + r["avail"]
        for a_ in json.loads(r["atks"] or "[]"):
            hist_sum[tg] = hist_sum.get(tg, 0) + a_["s"] * att_f(r["att_th"]) * hit_f(r["att_th"], a_["d"])
    for tg in hist_av:
        old_av[tg], old_sum[tg] = hist_av[tg], hist_sum.get(tg, 0)
        carried.setdefault(tg, {})["_from"] = ["earlier wars (ClashKing history)"]
    ledger_c, ledger_h = {}, {}
    for i_, c_ in enumerate(conns):
        try:
            for r in c_.execute("SELECT tag, career, here FROM ledger"):
                ledger_c[r["tag"]] = max(ledger_c.get(r["tag"], 0), r["career"] or 0)
                if i_ == 0:
                    ledger_h[r["tag"]] = r["here"] or 0
        except sqlite3.OperationalError:
            pass
    ledger_up = []
    live_sum, live_used = {}, {}
    for r in con.execute("SELECT a.tag, a.att_th, a.def_th, a.stars FROM attacks a JOIN wars w ON w.key=a.key WHERE w.state='inWar'"):
        live_used[r["tag"]] = live_used.get(r["tag"], 0) + 1
        live_sum[r["tag"]] = live_sum.get(r["tag"], 0) + r["stars"] * att_f(r["att_th"]) * hit_f(r["att_th"], r["def_th"])
    threes, all_used = {}, {}
    for r in con.execute("SELECT a.tag, a.stars FROM attacks a JOIN wars w ON w.key=a.key WHERE w.state='warEnded'"):
        all_used[r["tag"]] = all_used.get(r["tag"], 0) + 1
        if r["stars"] == 3:
            threes[r["tag"]] = threes.get(r["tag"], 0) + 1

    LIFE = {"don": "don_total", "war": "war_stars", "cwl": "cwl_total", "atk": "conq_total", "raid": "raid_total", "cap": "capital", "games": "games"}
    firsts = {}
    for k_, col in LIFE.items():
        firsts[k_] = {r["tag"]: r["v"] for r in con.execute(
            f"SELECT s.tag, s.{col} v FROM snapshots s JOIN (SELECT tag, MIN(ts) m FROM snapshots WHERE {col}>0 GROUP BY tag) f ON s.tag=f.tag AND s.ts=f.m")}
    tracked = {}
    for r in con.execute("SELECT a.tag, w.kind, SUM(a.stars) s FROM attacks a JOIN wars w ON w.key=a.key WHERE w.state='warEnded' GROUP BY a.tag, w.kind"):
        tracked.setdefault(r["tag"], {})[r["kind"]] = r["s"] or 0
    nd = dt.datetime.fromtimestamp(cur_ts, dt.timezone.utc)
    m0 = int(dt.datetime(nd.year, nd.month, 1, tzinfo=dt.timezone.utc).timestamp())
    m1 = int(dt.datetime(nd.year + (nd.month == 12), nd.month % 12 + 1, 1, tzinfo=dt.timezone.utc).timestamp())
    raid_month = {}
    for r in con.execute("SELECT season, tag, attacks, looted FROM raids"):
        if m0 <= coc_time(r["season"]) < m1:
            g, a_ = raid_month.get(r["tag"], (0, 0))
            raid_month[r["tag"]] = (g + (r["looted"] or 0), a_ + (r["attacks"] or 0))
    hmap = {t: json.loads(c["heroes"] or "{}") for t, c in cur.items()}
    wmap = {t: calc_weight(c, hmap[t]) for t, c in cur.items()}
    raw_act, rows = {}, []
    wp = pct_scores(wmap)
    for t, c in cur.items():
        bs = base.get(t) or base_old.get(t)
        if bs:
            don = c["donations"] - bs["donations"] if c["donations"] >= bs["donations"] else c["donations"]
            upg = max(0, c["upgrades"] - bs["upgrades"]) + 40 * max(0, c["th"] - bs["th"])
            aw = max(0, c["attack_wins"] - bs["attack_wins"])
            gm = max(0, c["games"] - bs["games"])
            cap = max(0, c["capital"] - bs["capital"])
        else:
            don, upg, aw, gm, cap = c["donations"], 0, 0, 0, 0
        wa = war_att.get(t, 0) + old_wa.get(t, 0)
        parts = {"donations": don, "upgrades": 15 * upg, "attacks": 4 * aw, "games": round(0.05 * gm, 1),
                 "capital": round(0.02 * cap, 1), "war": 25 * wa}
        raw_act[t] = sum(parts.values())
        heroes, weight = hmap[t], wmap[t]
        av, us = avail.get(t, 0), used.get(t, 0)
        impact_prov = False
        oav = old_av.get(t, 0) if av < 4 else 0
        if av + oav:
            impact = round(min(100, 100 * (impact_sum.get(t, 0) + (old_sum.get(t, 0) if oav else 0)) / (3 * (av + oav) * f_max)), 1)
            if oav:
                carried[t]["impact"] = f"Includes {oav} attack slots from {', '.join(carried[t].get('_from', []))}, because they have few wars here."
        elif live_used.get(t):
            impact, impact_prov = round(min(100, 100 * live_sum[t] / (3 * live_used[t] * f_max)), 1), True
        else:
            impact = None
        tier = c.get("league") or 0
        lb = clip((tier - expected_tier(c["th"])) / 6, -1, 1) if tier else 0.0
        if t in joined_ts:
            join_at, days_in, src = joined_ts[t], max(0.0, (cur_ts - joined_ts[t]) / 86400), "manual"
        elif ck.get(t) and ck[t]["first_join"]:
            join_at, days_in, src = ck[t]["first_join"], float(ck[t]["days"] or 0), "clashking"
        else:
            join_at = first_seen.get(t, cur_ts)
            days_in, src = float(presence(t, [con])), "seen"
        ckr = ck.get(t)
        others = json.loads(ckr["others"]) if ckr and ckr["others"] else []
        if src != "manual":
            days_in = max(days_in, ledger_h.get(t, 0))   # never lower than the best we have ever seen
        career = max(days_in, float(ckr["career"] or 0) if ckr else 0.0, float(presence(t, conns)), ledger_c.get(t, 0))
        if career > ledger_c.get(t, 0) + 0.01 or days_in > ledger_h.get(t, 0) + 0.01:
            ledger_up.append((t, career, days_in, cur_ts))
        if history_days < 1:
            status = "Active" if (c["donations"] > 0 or wa > 0) else "Unknown"
        else:
            status = "Active" if (don > 0 or upg > 0 or aw > 0 or gm > 0 or cap > 0 or wa > 0) else "Inactive"
        def pick(k_, mode):
            col = LIFE[k_]; v = c.get(col)
            if v is None:
                return None
            if mode == "all":
                return v
            if mode == "since":
                if k_ == "war":
                    return tracked.get(t, {}).get("war", 0)
                if k_ == "cwl":
                    return tracked.get(t, {}).get("cwl", 0)
                return max(0, v - firsts[k_][t]) if t in firsts[k_] else 0
            b_ = (bs or {}).get(col)
            return max(0, v - b_) if b_ else None
        stats = {m_: {k_: pick(k_, m_) for k_ in LIFE} for m_ in ("all", "since", "window")}
        rm_g, rm_a = raid_month.get(t, (0, 0))
        rows.append(dict(c, stats=stats, raid_month=rm_g, raid_attacks_month=rm_a, weight=weight, weight_pct=wp[t], league_bonus=round(lb, 2), status=status,
                         act_parts=parts, heroes=heroes, hero_total=sum(heroes.values()), upg_delta=upg, don_delta=don,
                         games_delta=gm, capital_delta=cap, war_attacks=wa, impact=impact, impact_prov=impact_prov, impact_n=av + oav,
                         career_days=round(career, 1), old_clans=others[:4], carried={k_: v_ for k_, v_ in carried.get(t, {}).items() if not k_.startswith('_')},
                         days_in_clan=round(days_in, 1), joined_at=join_at, joined_manual=t in joined_ts, joined_source=src, stint_since=(ckr["cur_since"] if ckr else None),
                         don_total=c.get("don_total") or 0, conq_total=c.get("conq_total") or 0, threes=threes.get(t, 0),
                         missed=max(0, av - us), attacks_used=us, attacks_avail=av))
    act = pct_scores(raw_act)
    sn = lambda r, k: (r["stats"]["since"].get(k) or 0)
    parts_fn = {"days": lambda r: r["days_in_clan"], "war": lambda r: sn(r, "war") + sn(r, "cwl"), "capital": lambda r: sn(r, "cap"),
                "games": lambda r: sn(r, "games"), "donated": lambda r: sn(r, "don")}
    pc = {}
    for k, fn in parts_fn.items():
        vals = {r["tag"]: fn(r) for r in rows}
        if max(vals.values(), default=0) > 0:
            pc[k] = pct_scores(vals)
    wsum = sum(PRESTIGE_MIX[k] for k in pc)
    for r in rows:
        r["activity"] = act[r["tag"]]
        r["prestige"] = round(sum(pc[k][r["tag"]] * PRESTIGE_MIX[k] for k in pc) / wsum, 1) if wsum else None
        r["prestige_n"] = r["days_in_clan"]
        comps = [(r["impact"], TOTAL_MIX["impact"]), (r["prestige"], TOTAL_MIX["prestige"]),
                 (r["activity"], TOTAL_MIX["activity"]), (r["weight_pct"], TOTAL_MIX["weight"])]
        have = [(v, w) for v, w in comps if v is not None]
        r["total"] = round(sum(v * w for v, w in have) / sum(w for _, w in have), 1)
    if ledger_up:
        try:
            con.executemany("INSERT INTO ledger(tag, career, here, updated) VALUES(?,?,?,?) ON CONFLICT(tag) DO UPDATE SET career=MAX(career, excluded.career), here=MAX(here, excluded.here), updated=excluded.updated", ledger_up)
            con.commit()
        except sqlite3.OperationalError:
            pass
    for _, oc in olds:
        oc.close()
    return rows, history_days


def ent(r, label, value=None):
    return {"name": r["name"], "tag": r["tag"], "th": r.get("th", 0), "league": r.get("league") or 0,
            "league_name": r.get("league_name") or "", "league_icon": r.get("league_icon") or "",
            "label": label, "value": value}


def top(rows, bid, title, key, label, flt=None, n=10):
    items = [r for r in rows if (flt(r) if flt else r.get(key) is not None)]
    items.sort(key=lambda r: r[key], reverse=True)
    return {"id": bid, "title": title, "metric": key, "rows": [ent(r, label(r), r[key]) for r in items[:n]]}


def build_boards(con, days, clan=None):
    rows, history_days = build_members(con, days, clan)
    if not rows:
        return [], 0
    now = con.execute("SELECT MAX(ts) m FROM snapshots").fetchone()["m"]
    info = {r["tag"]: r for r in rows}
    pos = lambda k: (lambda r: r[k] > 0)
    boards = [
        top(rows, "total", "Top total value", "total", lambda r: f"{r['total']}"),
        top(rows, "activity", "Most active", "activity", lambda r: f"{r['activity']}"),
        top(rows, "prestige", "Prestige", "prestige", lambda r: f"{r['prestige']}"),
        top(rows, "impact", "War impact", "impact", lambda r: f"{r['impact']}"),
        top(rows, "weight", "War weight", "weight", lambda r: f"{r['weight']:,}"),
        top(rows, "upgrades", "Most upgrades", "upg_delta", lambda r: f"{r['upg_delta']} levels", flt=pos("upg_delta")),
        top(rows, "donators", "Top donators", "don_delta", lambda r: f"{r['don_delta']:,} troops", flt=pos("don_delta")),
        top(rows, "threes", "Most 3-stars", "threes", lambda r: f"{r['threes']} stars", flt=pos("threes")),
        top(rows, "raids", "Raid weekend, this month", "raid_month", lambda r: f"{r['raid_month']:,} gold  ·  {r['raid_attacks_month']} attacks", flt=pos("raid_month")),
        top(rows, "capital", "Capital gold given", "capital_delta", lambda r: f"{r['capital_delta']:,}", flt=pos("capital_delta")),
        top(rows, "ranked", "Ranked overachievers", "league_bonus", lambda r: f"{r['league_name'] or r['league']}", flt=pos("league_bonus")),
        top(rows, "trophies", "Trophies", "trophies", lambda r: f"{r['trophies']:,}"),
        top(rows, "missed", "Missed attacks", "missed", lambda r: f"{r['missed']} missed", flt=pos("missed")),
    ]
    gs, ge = games_window(now)
    snaps = {}
    for r in con.execute("SELECT tag, ts, games FROM snapshots WHERE ts>=? AND ts<=? ORDER BY ts", (gs - 86400 * 3, ge + 86400)):
        snaps.setdefault(r["tag"], []).append((r["ts"], r["games"]))
    cap_pts = int(CFG.get("games_max", 4000))
    pts, fin = [], []
    for t, lst in snaps.items():
        if t not in info:
            continue
        before = [g for ts_, g in lst if ts_ <= gs]
        inside = [(ts_, g) for ts_, g in lst if gs < ts_ <= ge + 86400]
        if not inside:
            continue
        basev = before[-1] if before else inside[0][1]
        p = max(0, inside[-1][1] - basev)
        pts.append((p, ent(info[t], f"{min(p, cap_pts):,} points", p)))
        hit = next((ts_ for ts_, g in inside if g - basev >= cap_pts), None)
        if hit:
            fin.append((hit, ent(info[t], dt.datetime.fromtimestamp(hit, dt.timezone.utc).strftime("%d %b %H:%M UTC"), hit)))
    boards.append({"id": "games", "title": "Clan games points", "metric": None, "rows": [e for _, e in sorted(pts, key=lambda x: -x[0])[:10]]})
    boards.append({"id": "fastest", "title": "Fastest games finisher", "metric": None, "rows": [e for _, e in sorted(fin, key=lambda x: x[0])[:10]]})
    return boards, history_days


# ---------------------------------------------------------------- clan status
def build_status(con, clan, days):
    rows, hd = build_members(con, days, clan)
    now = con.execute("SELECT MAX(ts) m FROM snapshots").fetchone()["m"] or 0
    base_ts = con.execute("SELECT MIN(ts) m FROM snapshots").fetchone()["m"] or 0
    cl = get_meta(con, "clan") or {}
    n = len(rows)
    avg = lambda k: round(sum((r[k] or 0) for r in rows) / n, 1) if n else 0
    stat = {"Active": 0, "Inactive": 0, "Unknown": 0}
    th_dist, role_dist = {}, {}
    for r in rows:
        stat[r["status"]] = stat.get(r["status"], 0) + 1
        th_dist[r["th"]] = th_dist.get(r["th"], 0) + 1
        role_dist[r["role"]] = role_dist.get(r["role"], 0) + 1
    cutoff = now - 10 * 86400
    joined = []
    for r in rows:
        s = r.get("stint_since")
        if not s and r["joined_source"] == "seen" and r["joined_at"] > base_ts + 3600:
            s = r["joined_at"]
        if s and s >= cutoff:
            joined.append({"name": r["name"], "tag": r["tag"], "th": r["th"], "at": s, "src": r["joined_source"]})
    joined.sort(key=lambda x: -x["at"])
    cur_tags = {r["tag"] for r in rows}
    rl_ts = [x["ts"] for x in con.execute("SELECT DISTINCT ts FROM rosterlog ORDER BY ts")]
    src = "rosterlog" if len(rl_ts) >= 2 else "snapshots"
    last_seen = {x["tag"]: x["m"] for x in con.execute(f"SELECT tag, MAX(ts) m FROM {src} GROUP BY tag")}
    left = []
    for tg, m in last_seen.items():
        if tg not in cur_tags and m >= now - 30 * 86400:
            nm = con.execute("SELECT name, th FROM snapshots WHERE tag=? ORDER BY ts DESC LIMIT 1", (tg,)).fetchone()
            left.append({"name": nm["name"] if nm else tg, "tag": tg, "th": nm["th"] if nm else 0, "at": m})
    left.sort(key=lambda x: -x["at"])
    vets = sorted(rows, key=lambda r: -r["days_in_clan"])[:8]
    veterans = [{"name": r["name"], "tag": r["tag"], "th": r["th"], "days": r["days_in_clan"], "src": r["joined_source"]} for r in vets]
    if len(rl_ts) >= 2:
        series = [x for x in con.execute("SELECT d, MAX(c) c FROM (SELECT date(ts,'unixepoch') d, COUNT(*) c FROM rosterlog GROUP BY ts) GROUP BY d ORDER BY d DESC LIMIT 60")]
    else:
        series = [x for x in con.execute("SELECT date(ts,'unixepoch') d, COUNT(DISTINCT tag) c FROM snapshots GROUP BY d ORDER BY d DESC LIMIT 60")]
    member_series = [{"d": x["d"], "v": x["c"]} for x in reversed(series)]
    trophy_series = [{"d": x["d"], "v": round(x["a"])} for x in reversed(list(con.execute("SELECT date(ts,'unixepoch') d, AVG(trophies) a FROM snapshots GROUP BY d ORDER BY d DESC LIMIT 60")))]
    wl = [dict(x) for x in con.execute("SELECT * FROM warlog WHERE result IN ('win','lose','tie') ORDER BY end_ts DESC LIMIT 30")][::-1]
    for x in wl:
        x["destr"] = min(100.0, max(0.0, x["destr"] or 0))
    decided = [x for x in wl if x["result"] in ("win", "lose", "tie")]
    wins = sum(1 for x in decided if x["result"] == "win")
    summary = {"wins": wins, "losses": sum(1 for x in decided if x["result"] == "lose"), "ties": sum(1 for x in decided if x["result"] == "tie"),
               "win_rate": round(100 * wins / len(decided)) if decided else None,
               "avg_stars": round(sum(x["stars"] or 0 for x in wl) / len(wl), 1) if wl else None,
               "avg_destr": round(sum(x["destr"] or 0 for x in wl) / len(wl), 1) if wl else None, "n": len(wl)}
    stars = {x["s"]: x["n"] for x in con.execute("SELECT a.stars s, COUNT(*) n FROM attacks a JOIN wars w ON w.key=a.key WHERE w.state='warEnded' GROUP BY a.stars")}
    th_threes = [{"th": x["att_th"], "n": x["n"], "rate": round(100 * (x["t"] or 0) / x["n"])} for x in con.execute(
        "SELECT a.att_th, COUNT(*) n, SUM(a.stars=3) t FROM attacks a JOIN wars w ON w.key=a.key WHERE w.state='warEnded' GROUP BY a.att_th HAVING n>=2 ORDER BY a.att_th")]
    top = sorted(rows, key=lambda r: -r["total"])[:10]
    ax = [("Activity", "activity"), ("Impact", "impact"), ("Prestige", "prestige"), ("War weight", "weight_pct"), ("Total", "total")]
    mean = lambda lst, k: round(sum(r[k] for r in lst if r[k] is not None) / max(1, sum(1 for r in lst if r[k] is not None)), 1)
    radar = {"labels": [a_[0] for a_ in ax], "clan": [mean(rows, a_[1]) if rows else 0 for a_ in ax], "top": [mean(top, a_[1]) if top else 0 for a_ in ax]}
    return {"clan": cl, "members": n, "history_days": hd, "status": stat, "avg_total": avg("total"), "avg_th": avg("th"), "total_weight": sum(r["weight"] for r in rows),
            "th_dist": th_dist, "role_dist": role_dist, "joined": joined, "left": left, "veterans": veterans, "member_series": member_series,
            "trophy_series": trophy_series, "warlog": wl, "war_summary": summary, "attack_stars": stars, "th_threes": th_threes, "radar": radar}


# ---------------------------------------------------------------- CWL analysis
def _clip(x, a, b):
    return max(a, min(b, x))


def threat_score(th, our_avg, activity, perf):
    """0-100. A higher town hall only matters if the player is active, and an active player matters more when strong."""
    base = _clip(0.5 + 0.25 * (th - our_avg), 0, 1.5) / 1.5
    act = 0.6 if activity is None else activity
    pf = 0.5 if perf is None else perf
    return round(100 * min(1, base * (0.35 + 0.65 * act) * (0.6 + 0.4 * pf) * 1.5))


def build_cwl(con, clan, round_sel=None):
    grp, cw = get_meta(con, "cwl_group"), get_meta(con, "cwl")
    if not grp or not cw:
        return {"active": False, "check": get_meta(con, "cwl_check")}
    season = grp["season"]
    wars = []
    for r in con.execute("SELECT round, state, json FROM cwlraw WHERE season=? ORDER BY round", (season,)):
        w = json.loads(r["json"]); w["_round"] = r["round"]; w["_state"] = r["state"]
        w["_a"], w["_b"] = norm(w["clan"]["tag"]), norm(w["opponent"]["tag"])
        wars.append(w)
    if not wars:
        return {"active": True, "season": season, "state": cw.get("state"), "rounds": [], "standings": [], "opponent": None}
    names = {c["tag"]: c["name"] for c in grp["clans"]}
    for w in wars:
        names.setdefault(w["_a"], w["clan"].get("name")); names.setdefault(w["_b"], w["opponent"].get("name"))

    def side(w, tag):
        return w["clan"] if w["_a"] == tag else w["opponent"]

    def other(w, tag):
        return w["opponent"] if w["_a"] == tag else w["clan"]

    def result(w, tag):
        if w["_state"] != "warEnded":
            return "live" if w["_state"] == "inWar" else "prep"
        a_, b_ = side(w, tag), other(w, tag)
        ka, kb = (a_.get("stars", 0), a_.get("destructionPercentage", 0)), (b_.get("stars", 0), b_.get("destructionPercentage", 0))
        return "win" if ka > kb else ("lose" if ka < kb else "tie")

    # standings (stars + 10 for a win)
    st = {tg: {"tag": tg, "name": nm, "stars": 0, "destr": 0.0, "wins": 0, "played": 0, "points": 0} for tg, nm in names.items()}
    for w in wars:
        if w["_state"] != "warEnded":
            continue
        for tg in (w["_a"], w["_b"]):
            s_ = side(w, tg)
            e = st.setdefault(tg, {"tag": tg, "name": names.get(tg), "stars": 0, "destr": 0.0, "wins": 0, "played": 0, "points": 0})
            e["stars"] += s_.get("stars", 0); e["destr"] += s_.get("destructionPercentage", 0); e["played"] += 1
            if result(w, tg) == "win":
                e["wins"] += 1
        # winner bonus
    for e in st.values():
        e["points"] = e["stars"] + 10 * e["wins"]; e["destr"] = round(e["destr"], 1)
    standings = sorted(st.values(), key=lambda e: (-e["points"], -e["destr"]))
    for i, e in enumerate(standings, 1):
        e["rank"] = i

    # our rounds
    mine = [w for w in wars if clan in (w["_a"], w["_b"])]
    rounds = []
    for w in mine:
        us, op = side(w, clan), other(w, clan)
        rounds.append({"round": w["_round"], "state": w["_state"], "result": result(w, clan), "opp_tag": norm(op["tag"]), "opp_name": op.get("name"),
                       "stars": us.get("stars", 0), "destr": us.get("destructionPercentage", 0), "o_stars": op.get("stars", 0), "o_destr": op.get("destructionPercentage", 0),
                       "attacks": us.get("attacks", 0), "o_attacks": op.get("attacks", 0), "size": w.get("teamSize")})
    live = [r for r in rounds if r["state"] in ("inWar", "preparation")]
    sel = round_sel or (live[0]["round"] if live else (rounds[-1]["round"] if rounds else None))
    cur = next((w for w in mine if w["_round"] == sel), None)
    opponent = None
    if cur:
        otag = norm(other(cur, clan)["tag"])
        our_side, opp_side = side(cur, clan), other(cur, clan)
        our_avg = sum(m["townhallLevel"] for m in our_side["members"]) / max(1, len(our_side["members"]))
        opp_avg = sum(m["townhallLevel"] for m in opp_side["members"]) / max(1, len(opp_side["members"]))
        hist = {}
        prev_rounds = []
        for w in wars:
            if w["_round"] >= cur["_round"] or otag not in (w["_a"], w["_b"]):
                continue
            o_ = side(w, otag); e_ = other(w, otag)
            e_th = {m["tag"]: m["townhallLevel"] for m in e_["members"]}
            attackers = []
            for m in o_["members"]:
                h = hist.setdefault(m["tag"], {"lineups": 0, "used": 0, "stars": 0, "threes": 0, "destr": 0})
                if w["_state"] == "warEnded":
                    h["lineups"] += 1
                    for a_ in m.get("attacks") or []:
                        h["used"] += 1; h["stars"] += a_.get("stars", 0); h["destr"] += a_.get("destructionPercentage", 0)
                        h["threes"] += 1 if a_.get("stars") == 3 else 0
                        attackers.append({"name": m["name"], "th": m["townhallLevel"], "stars": a_.get("stars", 0), "destr": a_.get("destructionPercentage", 0), "vs_th": e_th.get(a_.get("defenderTag"), 0)})
            prev_rounds.append({"round": w["_round"], "vs": e_.get("name"), "result": result(w, otag), "stars": o_.get("stars", 0), "o_stars": e_.get("stars", 0),
                                "destr": o_.get("destructionPercentage", 0), "attackers": sorted(attackers, key=lambda x: (-x["stars"], -x["destr"]))})
        lineup = []
        for m in opp_side["members"]:
            h = hist.get(m["tag"])
            act = (h["used"] / h["lineups"]) if h and h["lineups"] else None
            perf = (h["stars"] / h["used"] / 3) if h and h["used"] else None
            atk = (m.get("attacks") or [None])[0]
            lineup.append({"name": m["name"], "tag": m["tag"], "th": m["townhallLevel"], "pos": m.get("mapPosition"), "edge": round(m["townhallLevel"] - our_avg, 1),
                           "lineups": h["lineups"] if h else 0, "activity": round(act * 100) if act is not None else None,
                           "avg_stars": round(h["stars"] / h["used"], 2) if h and h["used"] else None,
                           "three_rate": round(100 * h["threes"] / h["used"]) if h and h["used"] else None,
                           "avg_destr": round(h["destr"] / h["used"]) if h and h["used"] else None,
                           "attacked": bool(atk), "att_stars": atk.get("stars") if atk else None, "att_destr": atk.get("destructionPercentage") if atk else None,
                           "threat": threat_score(m["townhallLevel"], our_avg, act, perf)})
        lineup.sort(key=lambda x: (-x["threat"], x["pos"] or 99))
        used_all = sum(h["used"] for h in hist.values()); lin_all = sum(h["lineups"] for h in hist.values())
        stars_all = sum(h["stars"] for h in hist.values())
        th_us, th_op = {}, {}
        for m in our_side["members"]:
            th_us[m["townhallLevel"]] = th_us.get(m["townhallLevel"], 0) + 1
        for m in opp_side["members"]:
            th_op[m["townhallLevel"]] = th_op.get(m["townhallLevel"], 0) + 1
        clan_threat = round(sum(x["threat"] for x in lineup) / max(1, len(lineup)))
        opponent = {"tag": otag, "name": opp_side.get("name"), "round": cur["_round"], "state": cur["_state"], "our_avg_th": round(our_avg, 1), "avg_th": round(opp_avg, 1),
                    "th_delta": round(opp_avg - our_avg, 1), "th_us": th_us, "th_op": th_op, "size": len(opp_side["members"]),
                    "attack_rate": round(100 * used_all / lin_all) if lin_all else None, "avg_stars_per_attack": round(stars_all / used_all, 2) if used_all else None,
                    "three_rate": round(100 * sum(h["threes"] for h in hist.values()) / used_all) if used_all else None,
                    "avg_destr": round(sum(h["destr"] for h in hist.values()) / used_all) if used_all else None,
                    "record": {"w": sum(1 for r_ in prev_rounds if r_["result"] == "win"), "l": sum(1 for r_ in prev_rounds if r_["result"] == "lose"), "t": sum(1 for r_ in prev_rounds if r_["result"] == "tie")},
                    "threat": clan_threat, "level": "Dangerous" if clan_threat >= 66 else ("Watch" if clan_threat >= 40 else "Low"),
                    "lineup": lineup, "previous": prev_rounds, "attacks_made": sum(1 for x in lineup if x["attacked"]), "stars_now": opp_side.get("stars", 0), "our_stars_now": our_side.get("stars", 0)}
    return {"active": True, "check": get_meta(con, "cwl_check"), "season": season, "state": cw.get("state"), "round": cw.get("round"), "selected": sel, "standings": standings,
            "rounds": rounds, "opponent": opponent, "us": {"tag": clan, "name": names.get(clan)}}


def bl_entries(data):
    return data if isinstance(data, list) else (data.get("items", []) if isinstance(data, dict) else [])


def build_armies(con, clan, round_sel):
    cwl = build_cwl(con, clan, round_sel)
    opp = cwl.get("opponent") if cwl.get("active") else None
    if not opp:
        return {"error": "No opponent selected."}
    tags = [m["tag"] for m in opp["lineup"]][:20]
    now = int(time.time())
    cached = {r["tag"]: r for r in con.execute("SELECT tag, checked, json FROM blcache WHERE checked>?", (now - 3600,))}

    def one(tg):
        if tg in cached:
            return tg, json.loads(cached[tg]["json"]), None
        try:
            return tg, bl_entries(api(f"/players/{q(tg)}/battlelog")), None
        except Exception as e:
            return tg, None, str(e)

    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, tags))
    names = {m["tag"]: m["name"] for m in opp["lineup"]}
    players, armies, errs = [], {}, []
    for tg, entries, err in res:
        if err:
            errs.append(err); continue
        if tg not in cached:
            con.execute("INSERT OR REPLACE INTO blcache VALUES(?,?,?)", (tg, now, json.dumps(entries or [])))
        atk = [e for e in (entries or []) if isinstance(e, dict) and e.get("attack")]
        coded = [e for e in atk if e.get("armyShareCode")]
        for e in coded:
            a_ = armies.setdefault(e["armyShareCode"], {"code": e["armyShareCode"], "uses": 0, "stars": 0, "destr": 0, "by": set(), "type": e.get("battleType")})
            a_["uses"] += 1; a_["stars"] += e.get("stars", 0) or 0; a_["destr"] += e.get("destructionPercentage", 0) or 0; a_["by"].add(names.get(tg, tg))
        players.append({"tag": tg, "name": names.get(tg), "battles": len(entries or []), "attacks": len(atk), "with_army": len(coded)})
    con.commit()
    out = []
    for a_ in sorted(armies.values(), key=lambda x: -x["uses"])[:12]:
        out.append({"code": a_["code"], "uses": a_["uses"], "avg_stars": round(a_["stars"] / a_["uses"], 2), "avg_destr": round(a_["destr"] / a_["uses"]),
                    "players": sorted(a_["by"]), "type": a_["type"], "link": "https://link.clashofclans.com/en?action=CopyArmy&army=" + a_["code"]})
    return {"opponent": opp["name"], "scanned": len(players), "players": players, "armies": out, "errors": errs[:3],
            "note": None if out else "No ranked or legend attacks with an army were found in their recent battle logs. Players who do not play ranked battles have nothing to show."}


# ---------------------------------------------------------------- web
app = Flask(__name__, static_folder=str(HERE / "static"))


def need_admin(f):
    @functools.wraps(f)
    def wrapper(*a, **k):
        pw = CFG["admin_password"]
        if pw and not hmac.compare_digest(request.headers.get("X-Admin", ""), pw):
            return jsonify({"error": "password"}), 401
        return f(*a, **k)
    return wrapper


@app.get("/healthz")
def healthz():
    return "ok"


def cur_clan():
    clans = load_clans()
    c = norm(request.args.get("clan", ""))
    return c if c in clans else (clans[0] if clans else "")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/<path:name>")
def static_files(name):
    return send_from_directory(app.static_folder, name)


@app.get("/api/clans")
def clans_list():
    out = []
    for t in load_clans():
        name = t
        if clan_db_path(t).exists():
            con = db(t)
            name = (get_meta(con, "clan") or {}).get("name", t)
            con.close()
        out.append({"tag": t, "name": name, "syncing": st(t)["syncing"]})
    return jsonify({"clans": out, "configured": bool(CFG["api_key"]), "auth": bool(CFG["admin_password"])})


@app.post("/api/clans")
@need_admin
def clans_add():
    tag = norm((request.get_json(silent=True) or {}).get("tag", ""))
    if len(tag) < 4:
        return jsonify({"error": "Enter a clan tag, like #2PP0RQ8L."}), 400
    if not CFG["api_key"]:
        return jsonify({"error": "Add your api_key to config.json and restart first."}), 400
    try:
        info = api("/clans/" + q(tag))
    except ApiError as e:
        return jsonify({"error": str(e)}), 400
    if not info:
        return jsonify({"error": "No clan found with that tag."}), 404
    clans = load_clans()
    if tag not in clans and len(clans) >= CFG["max_clans"]:
        return jsonify({"error": f"This site tracks up to {CFG['max_clans']} clans and is full."}), 400
    if tag not in clans:
        clans.append(tag)
        save_clans(clans)
    threading.Thread(target=run_sync, args=(tag,), daemon=True).start()
    return jsonify({"ok": True, "tag": tag, "name": info["name"]})


@app.delete("/api/clans")
@need_admin
def clans_del():
    tag = norm(request.args.get("tag", ""))
    save_clans([c for c in load_clans() if c != tag])
    return jsonify({"ok": True})


LEAGUE_SLUGS = [("electro titan", "electro-titan"), ("electro dragon", "electro-dragon"), ("dragon", "dragon"),
                ("legend", "legend"), ("p.e.k.k.a", "pekka"), ("pekka", "pekka"), ("golem", "golem"), ("witch", "witch"),
                ("valkyrie", "valkyrie"), ("wizard", "wizard"), ("archer", "archer"), ("barbarian", "barbarian"),
                ("skeleton", "skeleton")]


# Ranked tiers run 1 to 36, three per league, in this order (same order as the icons you supplied, low to high).
TIER_SLUGS = ["skeleton", "barbarian", "archer", "wizard", "valkyrie", "witch", "golem", "pekka",
              "electro-titan", "dragon", "electro-dragon", "legend"]


def league_slug(name, tier):
    n = (name or "").lower()
    s = next((s for k, s in LEAGUE_SLUGS if k in n), None)
    if s:
        return s
    return TIER_SLUGS[(tier - 1) // 3] if 1 <= tier <= 36 else None


@app.get("/league-icon")
def league_icon():
    try:
        tier = int(request.args.get("tier") or 0)
    except ValueError:
        tier = 0
    slug = league_slug(request.args.get("name"), tier)
    if slug:  # data/leagues/<slug>.png overrides the bundled icon, so you can drop in your own
        for folder in (DATA / "leagues", HERE / "static" / "assets" / "leagues"):
            if (folder / (slug + ".png")).exists():
                return send_from_directory(folder, slug + ".png")
    u = request.args.get("u", "")
    if u.startswith("https://api-assets.clashofclans.com/"):
        try:
            r = requests.get(u, timeout=10)
            return Response(r.content, mimetype=r.headers.get("Content-Type", "image/png"))
        except Exception:
            pass
    return ("", 404)


@app.get("/api/state")
def state():
    clan = cur_clan()
    out = {"configured": bool(CFG["api_key"]), "clan_tag": clan, "syncing": False, "errors": [],
           "last_sync": None, "clan": None, "cwl": None, "ck_note": None, "war_state": None, "snapshots": 0, "wars": 0}
    if clan:
        con = db(clan)
        out.update({"syncing": st(clan)["syncing"], "errors": st(clan)["errors"],
                    "last_sync": get_meta(con, "last_sync"), "clan": get_meta(con, "clan"), "cwl": get_meta(con, "cwl"), "ck_note": get_meta(con, "ck_note"), "war_state": get_meta(con, "war_state"), "cwl_check": get_meta(con, "cwl_check"),
                    "snapshots": con.execute("SELECT COUNT(DISTINCT ts) n FROM snapshots").fetchone()["n"],
                    "wars": con.execute("SELECT COUNT(*) n FROM wars WHERE state='warEnded'").fetchone()["n"]})
        con.close()
    return jsonify(out)


@app.post("/api/sync")
def sync_now():
    clan = cur_clan()
    if not clan:
        return jsonify({"errors": ["Add a clan first."]})
    s, wait = st(clan), 0
    if CFG["sync_cooldown"]:
        wait = int(CFG["sync_cooldown"] - (time.time() - s.get("last_manual", 0)))
    if wait > 0:
        return jsonify({"errors": s["errors"], "cooldown": wait})
    s["last_manual"] = time.time()
    return jsonify({"errors": run_sync(clan)})


@app.post("/api/joined")
@need_admin
def set_joined():
    clan = cur_clan()
    j = request.get_json(silent=True) or {}
    tag, date = j.get("tag", ""), (j.get("date") or "").strip()
    if not clan or not tag:
        return jsonify({"error": "Missing clan or player."}), 400
    con = db(clan)
    try:
        if not date:
            con.execute("DELETE FROM joined WHERE tag=?", (tag,))
        else:
            ts = int(dt.datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())
            con.execute("INSERT OR REPLACE INTO joined VALUES(?,?)", (tag, ts))
        con.commit()
    except ValueError:
        return jsonify({"error": "Use the date format YYYY-MM-DD."}), 400
    finally:
        con.close()
    return jsonify({"ok": True})


@app.get("/api/status")
def status_api():
    clan = cur_clan()
    if not clan:
        return jsonify({"members": 0})
    con = db(clan)
    out = build_status(con, clan, int(request.args.get("days", 14)))
    con.close()
    return jsonify(out)


@app.get("/api/cwl")
def cwl_api():
    clan = cur_clan()
    if not clan:
        return jsonify({"active": False})
    con = db(clan)
    try:
        sel = int(request.args.get("round") or 0) or None
    except ValueError:
        sel = None
    out = build_cwl(con, clan, sel)
    con.close()
    return jsonify(out)


@app.post("/api/cwl/check")
def cwl_check():
    clan = cur_clan()
    if not clan:
        return jsonify({"check": None})
    run_war_sync(clan)
    con = db(clan)
    out = {"check": get_meta(con, "cwl_check"), "found": bool(get_meta(con, "cwl_group"))}
    con.close()
    return jsonify(out)


@app.post("/api/joined/batch")
@need_admin
def joined_batch():
    clan = cur_clan()
    items = (request.get_json(silent=True) or {}).get("items", [])
    con = db(clan)
    n = 0
    try:
        for it in items:
            tag, date = it.get("tag", ""), (it.get("date") or "").strip()
            if not tag:
                continue
            if not date:
                con.execute("DELETE FROM joined WHERE tag=?", (tag,))
            else:
                ts = int(dt.datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())
                con.execute("INSERT OR REPLACE INTO joined VALUES(?,?)", (tag, ts))
            n += 1
        con.commit()
    except ValueError:
        return jsonify({"error": "Dates must look like 2025-03-21."}), 400
    finally:
        con.close()
    return jsonify({"ok": True, "saved": n})


@app.get("/api/cwl/armies")
def cwl_armies():
    clan = cur_clan()
    if not clan:
        return jsonify({"error": "No clan."})
    con = db(clan)
    try:
        sel = int(request.args.get("round") or 0) or None
    except ValueError:
        sel = None
    try:
        out = build_armies(con, clan, sel)
    except Exception as e:
        out = {"error": str(e)}
    con.close()
    return jsonify(out)


@app.get("/api/debug/ck")
def debug_ck():
    """Shows exactly what ClashKing returns for one player and how the app reads it (for troubleshooting)."""
    tag = norm(request.args.get("tag", ""))
    clan = cur_clan()
    out = {"tag": tag}
    try:
        items = ck_fetch(tag)
        out["join_leave_events"] = len(items)
        out["sample"] = items[:3]
        out["parsed"] = ck_stints(items, clan, int(time.time()))
    except Exception as e:
        out["join_leave_error"] = str(e)
    try:
        wi = ck_war_fetch(tag)
        out["warhits_items"] = len(wi)
        out["warhits_parsed"] = len(ck_war_rows(wi, tag, int(time.time())))
    except Exception as e:
        out["warhits_error"] = str(e)
    return jsonify(out)


@app.get("/api/members")
def members():
    clan = cur_clan()
    if not clan:
        return jsonify({"members": [], "history_days": 0})
    con = db(clan)
    rows, hd = build_members(con, int(request.args.get("days", 14)), clan)
    con.close()
    return jsonify({"members": rows, "history_days": hd})


@app.get("/api/leaderboards")
def leaderboards():
    clan = cur_clan()
    if not clan:
        return jsonify({"boards": [], "history_days": 0})
    con = db(clan)
    boards, hd = build_boards(con, int(request.args.get("days", 14)), clan)
    con.close()
    return jsonify({"boards": boards, "history_days": hd})


def main():
    load_clans()
    threading.Thread(target=scheduler, daemon=True).start()
    host, port = CFG["host"], CFG["port"]
    print(f"Clan Organizer running at http://{'localhost' if host in ('127.0.0.1', 'localhost') else host}:{port}", flush=True)
    if host in ("127.0.0.1", "localhost"):
        app.run(host=host, port=port, threaded=True)
    else:
        from waitress import serve  # production server for hosting
        serve(app, host=host, port=port, threads=8)


if __name__ == "__main__":
    main()
