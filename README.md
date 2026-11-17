# Clan Organizer

**A Clash of Clans clan analytics and CWL roster planner that records clan history the game API doesn't provide, then scores members and builds rosters from it.**

⬇️ **Download:** [Windows installer](PASTE RELEASE LINK) · Python source below

<img width="1365" height="673" alt="image" src="https://github.com/user-attachments/assets/16cd96a8-0df5-4953-a81e-bf1a20b025e5" />
<img width="1365" height="672" alt="image" src="https://github.com/user-attachments/assets/0f594770-dfd1-488f-b215-27be31b2f05f" />



## What it does
The game API only shows today's snapshot: no history, no "last seen". Clan Organizer syncs in the background, stores snapshots in SQLite, and uses the changes over time to measure activity, war impact and loyalty. Leaders use those scores to plan a CWL roster.

## What's interesting
- **Snapshot engine:** an hourly scheduler stores per-clan SQLite history, with lighter 10-minute syncs while a war is live.
- **Four scores (0–100):** Activity, Impact, Prestige and a blended Total Value, all ranked within the clan. The formulas are documented on the Home page.
- **Transfers handled fairly:** war history and activity carry over when a player moves between tracked clans, and days-in-clan never go down.
- **CWL opponent analysis:** a per-player threat score from the enemy's earlier rounds, plus an army-code scanner from ranked battle logs.
- **Roster builder:** drag-and-drop, 15v15 / 30v30, exports as an image.
- **Leaderboards:** donations, raids, capital gold, upgrades, 3-stars and more, each exportable as an image.
- **Ships as a real app:** one-click launcher, Windows installer (PyInstaller + Inno Setup), Cloudflare-tunnel sharing, plus a Docker + Caddy deploy.

## Stack
Python · Flask · SQLite · Waitress · vanilla JS/CSS · Docker · GitHub Actions

![Members](docs/members.png) ![CWL analysis](docs/cwl.png)

*Fan-made tool. Not affiliated with Supercell. Clash of Clans and its artwork belong to Supercell. Join history provided by [ClashKing](https://clashk.ing).*

---



## Make a real installable app (Setup.exe with Uninstall)
1. On a Windows PC, install Python and the free Inno Setup (jrsoftware.org/isdl.php).
2. Double-click **build_installer.bat**. It makes `installer\ClanOrganizer-Setup.exe`.
3. Run that file to install. The app then shows in Start menu and in Settings > Apps, where **Uninstall** removes it.
   Send the same Setup.exe to co-leaders. They need nothing else installed. Windows may show a blue "unknown publisher" warning: More info > Run anyway.
   Each person's key, clans and history are stored in `%LocalAppData%\Clan Organizer`.
(No Windows PC handy? Upload this folder to GitHub and run the "Build installer" action.)

## Start it (the easy way)
1. Double-click **Clan Organizer.bat**. A small window opens and your browser opens by itself.
2. First time only: it asks for your Clash of Clans key. Paste it and press Save.
3. Want it on your Desktop with the crown icon? Double-click **Create Desktop Shortcut.bat** once.
4. To show a friend, press **Share with a friend** in that window. It gives you a link and a password to send.
   The link works only while the window is open and your computer is on.
(Mac: double-click `Clan Organizer.command`. If Python is missing, the .bat tells you what to install.)


Local Clash of Clans clan manager. Runs on your laptop, keeps history in local files.

## Setup
1. `pip install -r requirements.txt`
2. Rename `config.example.json` to `config.json` and paste your API key into `api_key`.
   (RoyaleAPI proxy: the key must allow IP `45.79.218.79`.) You can leave `clan_tag` empty.
3. `python app.py`, then open http://localhost:5000
4. On the Home page enter your clan tag. More clans can be added any time from the bar under the menu.

Leave it running: it syncs every `sync_minutes` and history builds up the longer it runs.

## Sharing it
See `DEPLOY.md` to put the app on a server so friends can use it with just a link (password protected for changes).

## Pages
- **Home**: add your clan, FAQ explaining every number, contact, footer.
- **Roster builder**: member pool and CWL roster (15v15 or 30v30), separate sorting for each side,
  manual ordering (drag or arrows), image export.
- **Leaderboards**: swipe through boards, two at a time. Each board exports as an image.
- **Members**: card grid with search and filters. Click a card for the full profile: overview, score breakdown and war record, plus an all-time stats table (all time, in this clan, last N days).
- The **Raid weekend, this month** leaderboard adds up raided capital gold for raid weekends that ended this calendar month and starts over on the 1st.

## Scores
- Activity, Impact, Prestige and Total value are all 0 to 100. The FAQ on the Home page has the exact formulas.
- Active or Inactive is decided from real actions in the window, not from the activity score.
- Tuning knobs (war weight, league bonus, total value mix) are constants near the top of the scoring section in `app.py`.

## Icons and images
- Town hall icons: `static/assets/th/th<N>.png` (11 to 18 included; others fall back to a badge).
- League icons: bundled in `static/assets/leagues/`. To replace one, put a PNG in `data/leagues/` named
  `skeleton, barbarian, archer, wizard, valkyrie, witch, golem, pekka, dragon, electro-dragon, electro-titan` or `legend`.
- Image export designs live in `static/exports.js` (colours and layout), so a new design only touches that file.

## Join history (days in clan)
The official game API has no join dates. The app asks ClashKing (https://clashk.ing, free, credit required) for each
player's join and leave history, once per day per player, and counts days across all stints in your clan.
Their data only goes back to when they started tracking that player or clan, and they say it is not perfect.
If nothing is found, the day the app first saw the player is used. A date you set by hand always wins.

## Players who move between clans
If a player's old clan is also tracked on the same site, their war attacks and activity baseline carry over to the new clan
until the new one has its own data (shown with a small history icon). Prestige counts career days across every clan, so
leaving and rejoining never resets it.

## What the game API can and can't give
- No "last seen", no building levels, no history. Activity and upgrades come from snapshot changes,
  so they need a few days of syncing. Upgrades are measured from hero, troop, spell, equipment and town hall levels.
- War attack detail exists only while a war or CWL is live. The app stores it on every sync.
- Clan games points come from the Games Champion achievement, capital gold from Most Valuable Clanmate.
