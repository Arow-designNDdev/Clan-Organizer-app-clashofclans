'use strict';
/* ====================== shared bits ====================== */
const SEG = cur => `<div class="seg"><a href="#/members" class="${cur === 'members' ? 'on' : ''}">Members</a><a href="#/status" class="${cur === 'status' ? 'on' : ''}">Clan status</a></div>`;
const ago = ts => { const d = Math.round((Date.now() / 1000 - ts) / 86400); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
const dayStr = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const scard = (title, body, cls = 's4', sub = '') => `<section class="sc ${cls} rv"><h3>${title}${sub ? `<small>${sub}</small>` : ''}</h3>${body}</section>`;
const ktile = (label, v, sub = '', fmt) => `<div class="tile"><small>${label}</small><b>${v == null ? '-' : (typeof v === 'number' ? `<span class="cu" data-to="${v}">${fmt ? fmt(v) : num(v)}</span>` : v)}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
const RES = { win: CC.green, lose: CC.red, tie: CC.gold };
function cwlOpen() {
  const c = S.st.cwl; if (!c) return false;
  const days = (Date.now() - new Date(c.season + '-01T00:00:00').getTime()) / 86400000;
  if (isNaN(days)) return c.state !== 'ended';
  return days >= -3 && days <= 45 && (c.state !== 'ended' || days <= 14);
}
let JD = {};
function openJoinDates() {
  const rows = [...S.members].sort((a, b) => b.days_in_clan - a.days_in_clan), label = { manual: 'set by you', clashking: 'ClashKing', seen: 'unknown (only since the app started)' }; JD = {};
  $('#jdTable').innerHTML = `<thead><tr><th>Player</th><th>TH</th><th>Days here</th><th>Source</th><th>Joined on</th></tr></thead><tbody>${rows.map(m => {
    const known = m.joined_source !== 'seen', val = known ? new Date(m.joined_at * 1000).toISOString().slice(0, 10) : ''; JD[m.tag] = val;
    return `<tr><td><b>${esc(m.name)}</b></td><td>${m.th}</td><td>${Math.round(m.days_in_clan)}</td><td class="${known ? '' : 'bad'}">${label[m.joined_source]}</td><td><input type="date" data-jd="${esc(m.tag)}" value="${val}"></td></tr>`; }).join('')}</tbody>`;
  openDlg($('#jdDlg'));
}
async function saveJoinDates() {
  const items = $$('#jdTable input[data-jd]').filter(i => i.value !== JD[i.dataset.jd]).map(i => ({ tag: i.dataset.jd, date: i.value }));
  if (!items.length) { toast('Nothing changed.'); return; }
  const r = await authFetch(cu('/api/joined/batch'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  if (!r.ok) { toast((await r.json()).error || 'Could not save.'); return; }
  toast(`Saved ${items.length} date${items.length > 1 ? 's' : ''}`); closeDlg($('#jdDlg')); await loadAll(); PAGES[CUR] && PAGES[CUR].update && PAGES[CUR].update(true);
}

/* ====================== CLAN STATUS ====================== */
function statusHtml(d) {
  const n = d.members || 0, act = d.status || {}, ws = d.war_summary || {}, wl = d.warlog || [];
  const ths = Object.keys(d.th_dist || {}).map(Number).sort((a, b) => b - a), sc = d.attack_stars || {};
  const li = (x, sub, open) => `<div class="li"><span class="lth">${x.th ? thImg(x.th) : ''}</span><div><b ${open ? `data-open="${esc(x.tag)}"` : ''}>${esc(x.name)}</b><small>${sub}</small></div></div>`;
  const list = (arr, fn, empty) => arr.length ? arr.map(fn).join('') : `<div class="empty small">${empty}</div>`;
  const kpis = `<div class="tiles ks">${ktile('Members', n)}${ktile('Active', n ? Math.round(100 * (act.Active || 0) / n) : null, `${act.Active || 0} of ${n}`, v => v + '%')}${ktile('Avg total value', Math.round(d.avg_total))}${ktile('Avg town hall', d.avg_th, '', v => v.toFixed(1))}${ktile('War win rate', ws.win_rate, ws.n ? `${ws.wins}W ${ws.losses}L ${ws.ties}T` : 'no war log', v => v + '%')}${ktile('Joined, 10 days', (d.joined || []).length)}${ktile('Left, 30 days', (d.left || []).length)}</div>`;
  const ths_items = ths.map(t => ({ label: t, value: d.th_dist[t], color: thColor(t) }));
  const stars_items = [0, 1, 2, 3].map(s => ({ label: s + '★', value: sc[s] || 0, color: [CC.red, '#ff8a3d', CC.gold, CC.green][s] }));
  const grid = [
    scard('Members over time', chLine((d.member_series || []).map(p => ({ d: p.d, v: p.v })), { w: 640, h: 230 }), 's8', 'per day'),
    scard('Activity status', chDonut([{ label: 'Active', value: act.Active || 0, color: CC.green }, { label: 'Inactive', value: act.Inactive || 0, color: CC.red }, { label: 'No data', value: act.Unknown || 0, color: CC.dim }], { center: n, sub: 'members' }), 's4'),
    scard('Score profile', chRadar(d.radar.labels, [{ name: 'Clan average', color: CC.gold, vals: d.radar.clan }, { name: 'Top 10', color: CC.teal, vals: d.radar.top }]), 's4', '0 to 100'),
    scard('Town halls', chBars(ths_items.map(i => ({ ...i, label: 'TH' + i.label }))), 's4'),
    scard('War record', wl.length ? chDots(wl.slice(-24).map(x => ({ result: x.result, title: `vs ${x.o_name || 'opponent'}: ${x.stars}-${x.o_stars}` }))) +
      chDonut([{ label: 'Won', value: ws.wins || 0, color: CC.green }, { label: 'Lost', value: ws.losses || 0, color: CC.red }, { label: 'Tie', value: ws.ties || 0, color: CC.gold }], { center: ws.win_rate == null ? '-' : ws.win_rate + '%', sub: 'win rate', size: 150 }) : '<div class="empty small">No war log yet. It needs to be public in game.</div>', 's4', `last ${wl.length} wars`),
    scard('Stars per war', chLine(wl.map(x => ({ d: dayStr(x.end_ts), v: x.stars || 0, c: RES[x.result] || CC.gold })), { w: 520, color: CC.gold }), 's6'),
    scard('Destruction per war', chLine(wl.map(x => ({ d: dayStr(x.end_ts), v: Math.round(x.destr || 0) })), { w: 520, color: CC.teal, min: 0, max: 100 }), 's6', '%'),
    scard('Recorded attack results', (sc[0] || sc[1] || sc[2] || sc[3]) ? chBars(stars_items) : '<div class="empty small">Attacks are recorded while wars run. This fills in over time.</div>', 's4'),
    scard('3-star rate by town hall', (d.th_threes || []).length ? chBars(d.th_threes.map(x => ({ label: 'TH' + x.th, value: x.rate, color: thColor(x.th) })), { unit: '%' }) : '<div class="empty small">Needs a few recorded attacks per town hall.</div>', 's4'),
    scard('Average trophies', chLine((d.trophy_series || []).map(p => ({ d: p.d, v: p.v })), { w: 420, color: CC.purple }), 's4'),
    scard('Joined in the last 10 days', list(d.joined || [], x => li(x, `${ago(x.at)}${x.src === 'clashking' ? '' : ' (first seen)'}`, true), 'Nobody new in the last 10 days.'), 's4', `${(d.joined || []).length}`),
    scard('Left in the last 30 days', list(d.left || [], x => li(x, `last seen ${ago(x.at)}`, false), 'Nobody has left, or the app has not seen anyone leave yet.'), 's4', `${(d.left || []).length}`),
    scard('Veterans', list(d.veterans || [], x => li(x, `${Math.round(x.days)} days in this clan${x.src === 'seen' ? ' · join date unknown' : ''}`, true), 'No data yet.') + '<p class="note">Wrong order? <a href="#" data-jdopen>Edit join dates</a></p>', 's4', 'days in this clan')
  ];
  return kpis + `<div class="sgrid">${grid.join('')}</div>`;
}
PAGES.status = {
  last: '',
  render() {
    $('#view').innerHTML = `<div id="msgs"></div><div class="mh">${SEG('status')}<h1 class="ttl"><span>Clan status</span></h1><button class="btn ghost" data-jdopen>Edit join dates</button></div><div id="sbody"><div class="skl" style="height:150px;border-radius:20px"></div></div>`;
    this.last = ''; this.update(true);
  },
  async update(force) {
    if (!$('#sbody')) return; $('#msgs').innerHTML = messages();
    if (!S.clan) { $('#sbody').innerHTML = '<div class="empty">Add a clan to see its status.</div>'; return; }
    let d; try { d = await get(cu(`/api/status?days=${S.days}`)); } catch { return; }
    const sig = JSON.stringify(d); if (!force && sig === this.last) return; this.last = sig;
    $('#sbody').innerHTML = statusHtml(d); reveal($('#sbody')); countUp($('#sbody'));
  }
};

/* ====================== CWL ANALYSIS ====================== */
const LVL = v => v >= 66 ? ['Dangerous', CC.red] : v >= 40 ? ['Watch', CC.gold] : ['Low', CC.green];
const CWLR = { win: ['Won', CC.green], lose: ['Lost', CC.red], tie: ['Tie', CC.gold], live: ['Live', CC.teal], prep: ['Preparing', CC.dim] };
function lockedHtml(check) {
  const d = new Date(), next = new Date(d.getFullYear(), d.getMonth() + 1, 1), days = Math.ceil((next - d) / 86400000);
  const diag = check ? `<div class="diag"><b>What the app saw</b> <small>${new Date(check.ts * 1000).toLocaleString()}</small><p>${esc(check.detail)}</p><button class="btn gold" id="cwlCheck">Check again now</button></div>`
    : '<div class="diag"><p>The app has not asked the game about CWL yet. Press Sync now, then check again.</p><button class="btn gold" id="cwlCheck">Check now</button></div>';
  return `<div class="lock rv"><div class="lk-ico">${IC.lock}</div><h1>CWL analysis is locked</h1>
    <p>This page switches on when your clan is in a Clan War League group. It studies every opponent of the week: how strong they are, how active they are, and who really is dangerous.</p>
    ${diag}<div class="next">Next CWL starts in about <b>${days}</b> day${days === 1 ? '' : 's'}, on the 1st.</div></div>`;
}
function cwlHtml(d) {
  const o = d.opponent, s = d.standings || [];
  const maxPts = Math.max(1, ...s.map(x => x.points));
  const stand = `<table class="tb"><thead><tr><th>#</th><th>Clan</th><th>Played</th><th>Stars</th><th>Destr.</th><th>Points</th></tr></thead><tbody>${s.map(x => `<tr class="${x.tag === d.us.tag ? 'me' : ''}"><td>${x.rank}</td><td><b>${esc(x.name)}</b></td><td>${x.played}</td><td>${x.stars}</td><td>${x.destr}%</td><td><div class="tbar"><i style="width:${100 * x.points / maxPts}%;background:${x.tag === d.us.tag ? CC.gold : CC.blue}"></i></div> <b>${x.points}</b></td></tr>`).join('')}</tbody></table>`;
  const rounds = `<div class="rtl">${(d.rounds || []).map(r => { const k = CWLR[r.result]; return `<div class="rcard ${r.round === d.selected ? 'on' : ''}" data-round="${r.round}"><div class="rn">R${r.round}</div><div><b>vs ${esc(r.opp_name)}</b><small>${r.stars}★ ${Math.round(r.destr)}%  –  ${r.o_stars}★ ${Math.round(r.o_destr)}%</small></div><span class="rb" style="color:${k[1]};border-color:${k[1]}">${k[0]}</span></div>`; }).join('') || '<div class="empty small">No rounds yet.</div>'}</div>`;
  let opp = '<div class="empty">The opponent appears once the next round is announced.</div>';
  if (o) {
    const [lv, lc] = LVL(o.threat), dl = o.th_delta;
    const ths = [...new Set([...Object.keys(o.th_us), ...Object.keys(o.th_op)])].map(Number).sort((a, b) => b - a);
    const rows = o.lineup.map(x => { const [l, c] = LVL(x.threat); return `<tr><td>${x.pos ?? ''}</td><td class="pl">${thImg(x.th, 'sm')}<b>${esc(x.name)}</b></td><td>${x.th}</td><td class="${x.edge > 0 ? 'bad' : 'ok'}">${x.edge > 0 ? '+' : ''}${x.edge}</td><td>${x.activity == null ? '<span class="dim">no data</span>' : x.activity + '%'}</td><td>${x.avg_stars ?? '-'}</td><td>${x.three_rate == null ? '-' : x.three_rate + '%'}</td><td>${x.attacked ? `<span class="ok">${x.att_stars}★ ${x.att_destr}%</span>` : '<span class="dim">not yet</span>'}</td><td><div class="tbar"><i style="width:${x.threat}%;background:${c}"></i></div> <b>${x.threat}</b> <small style="color:${c}">${l}</small></td></tr>`; }).join('');
    const prev = o.previous.map(p => `<details class="rv"><summary><b>Round ${p.round}</b> vs ${esc(p.vs)} <span class="rb" style="color:${CWLR[p.result][1]};border-color:${CWLR[p.result][1]}">${CWLR[p.result][0]}</span> <small>${p.stars}★ – ${p.o_stars}★</small></summary>
      <div class="atk">${p.attackers.length ? p.attackers.map(a => `<span class="ak s${a.stars}" title="TH${a.th} hit TH${a.vs_th || '?'}">${esc(a.name)} <b>${a.stars}★</b> <small>${a.destr}% · TH${a.th}→${a.vs_th || '?'}</small></span>`).join('') : '<span class="dim">No attacks recorded.</span>'}</div></details>`).join('') || '<div class="empty small">They have no earlier rounds yet, so activity is unknown. Their scores use neutral values until data comes in.</div>';
    opp = `<div class="mh"><h1 class="ttl"><span>Round ${o.round}: ${esc(o.name)}</span></h1><span class="rb big" style="color:${lc};border-color:${lc}">${lv} · ${o.threat}</span></div>
    <div class="sgrid">
      ${scard('Threat level', chGauge(o.threat, { label: lv }) + `<p class="note c">Average of every player's threat. Equal town halls sit around the middle. An active player with a higher town hall pushes it up, a high town hall who never attacks barely moves it.</p>`, 's4')}
      <section class="sc s8 rv"><h3>How they compare</h3><div class="tiles ks">${ktile('Their avg TH', o.avg_th, `ours ${o.our_avg_th}`, v => v.toFixed(1))}${ktile('TH difference', `<span class="${dl > 0 ? 'bad' : 'ok'}">${dl > 0 ? '+' : ''}${dl}</span>`, dl > 0 ? 'they are higher' : dl < 0 ? 'we are higher' : 'even')}${ktile('Attack rate', o.attack_rate, 'of their slots used', v => v + '%')}${ktile('Avg stars / attack', o.avg_stars_per_attack, '', v => v.toFixed(2))}${ktile('3-star rate', o.three_rate, '', v => v + '%')}${ktile('Avg destruction', o.avg_destr, '', v => v + '%')}${ktile('Record this season', `${o.record.w}W ${o.record.l}L ${o.record.t}T`)}${ktile('Attacked so far', o.attacks_made, `of ${o.size}`)}</div></section>
      ${scard('Town hall lineup', chGroup(ths, ths.map(t => o.th_us[t] || 0), ths.map(t => o.th_op[t] || 0), ['Us', 'Them']), 's6')}
      ${scard('Threat per player', chBars(o.lineup.slice(0, 15).map(x => ({ label: x.name.slice(0, 6), value: x.threat, color: LVL(x.threat)[1] })), { w: 520 }), 's6')}
      <section class="sc s12 rv"><h3>Their lineup <small>sorted by threat</small></h3><div class="scroll"><table class="tb lt"><thead><tr><th>Map</th><th>Player</th><th>TH</th><th>Edge</th><th>Activity</th><th>Avg ★</th><th>3★ rate</th><th>This round</th><th>Threat</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="note">Edge is their town hall minus our average. Activity is how often they used their attack in earlier rounds of this CWL. Threat = town hall edge × activity × how well they hit.</p></section>
      <section class="sc s12 rv"><h3>Previous wars this season <small>who attacked and how it went</small></h3>${prev}</section>
      <section class="sc s12 rv"><h3>Army intel <small>ranked battles</small></h3><p class="note">Looks at their recent ranked and legend battle logs and groups the armies they attack with. Only players who play ranked battles will show up.</p>
        <button class="btn gold" id="armyBtn">Scan their armies</button><div id="armyOut"></div></section>
    </div>`;
  }
  return `<div class="mh"><h1 class="ttl first"><span>CWL analysis</span></h1><span class="chip2">Season ${esc(d.season)} · ${esc(d.state || '')}</span></div>
    <div class="sgrid"><section class="sc s7 rv"><h3>League standings <small>stars + 10 for each win</small></h3>${stand}</section><section class="sc s5 rv"><h3>Your rounds <small>tap one to analyse its opponent</small></h3>${rounds}</section></div><div class="gap"></div>${opp}`;
}
PAGES.cwl = {
  last: '', sel: null,
  render() { $('#view').innerHTML = '<div id="msgs"></div><div id="cbody"><div class="skl" style="height:150px;border-radius:20px"></div></div>'; this.last = ''; this.update(true); },
  async update(force) {
    if (!$('#cbody')) return; $('#msgs').innerHTML = '';
    if (!S.clan) { $('#cbody').innerHTML = lockedHtml(null); reveal($('#cbody')); return; }
    let d; try { d = await get(cu('/api/cwl' + (this.sel ? `?round=${this.sel}` : ''))); } catch { return; }
    const sig = JSON.stringify(d) + cwlOpen(); if (!force && sig === this.last) return; this.last = sig;
    $('#cbody').innerHTML = (!d.active || !cwlOpen()) ? lockedHtml(d.check || S.st.cwl_check) : cwlHtml(d); reveal($('#cbody')); countUp($('#cbody'));
  },
  async armies() {
    const out = $('#armyOut'); out.innerHTML = '<p class="note">Scanning battle logs...</p>';
    try {
      const a = await get(cu('/api/cwl/armies' + (this.sel ? `?round=${this.sel}` : '')));
      if (a.error) { out.innerHTML = `<p class="err">${esc(a.error)}</p>`; return; }
      out.innerHTML = `<p class="note">Scanned ${a.scanned} players.</p>` + (a.armies.length ? `<div class="armies">${a.armies.map(x => `<div class="army"><div><b>${x.uses}× used</b> <span class="dim">· ${x.avg_stars}★ · ${x.avg_destr}% on average</span><small>${esc(x.players.join(', '))}${x.type ? ' · ' + esc(x.type) : ''}</small><code>${esc(x.code)}</code></div>
        <div class="row-btns"><a class="btn gold" href="${esc(x.link)}" target="_blank" rel="noopener">Open in game</a><button class="btn ghost" data-copy="${esc(x.code)}">Copy code</button></div></div>`).join('')}</div>
        <p class="note">Troop names are not decoded yet. The link opens the exact army in your game so you can see it there.</p>` : `<p class="note">${esc(a.note || 'Nothing found.')}</p>`) + (a.errors && a.errors.length ? `<p class="note">Some players could not be read: ${esc(a.errors[0])}</p>` : '');
    } catch (e) { out.innerHTML = '<p class="err">Could not scan right now.</p>'; }
  }
};
