'use strict';
const PAGES = {};
const EMAIL = 'arrowisoffline@gmail.com', DISCORD = 'arow3000';
const ord = n => { const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const pill = (label, v, low, hint) => `<i class="${low && v != null ? 'low' : ''}${hint ? ' old' : ''}"${hint ? ` title="${esc(hint)}"` : ''}>${label}<b>${v == null ? '-' : Math.round(v)}</b>${hint ? `<s>${IC.hist}</s>` : ''}</i>`;
const statusText = m => m.status === 'Unknown' ? 'No data yet' : m.status;
const clanName = () => S.st.clan?.name || S.clans.find(c => c.tag === S.clan)?.name || S.clan;

function messages() {
  const st = S.st, out = [];
  if (!S.configured) out.push('<div class="banner bad">Add your api_key to config.json, then restart the app.</div>');
  else if (!S.clan) out.push('<div class="banner">No clan yet. Add one from the Home page or with Add clan.</div>');
  else if (st.errors && st.errors.length) out.push(`<div class="banner bad"><b>Sync problems:</b><br>${st.errors.slice(0, 4).map(esc).join('<br>')}</div>`);
  else if (st.clan && st.clan.war_log_public === false) out.push('<div class="banner">This clan\'s war log is private, so war history is limited to wars the app sees live. Make it public in game for the best impact and prestige scores.</div>');
  if (st.ck_note) out.push(`<div class="banner">${esc(st.ck_note)}</div>`);
  if (S.clan && S.loaded && S.members.length && st.wars === 0) out.push(st.war_state === 'inWar'
    ? '<div class="banner">A war is running now, so Impact starts from the attacks used so far (dashed) and firms up once the war ends.</div>'
    : '<div class="banner">No wars recorded for this clan yet, so Impact shows - for now. The game only shares attack details for the war in progress (or the last one, until a new war starts) and the current CWL season, so the app records them as they happen. Impact fills in after the next war.</div>');
  if (S.clan && S.loaded && S.hd < 1 && S.members.length) out.push('<div class="banner">Only one snapshot so far. Activity, upgrades and clan games fill in as the app keeps syncing.</div>');
  return out.join('');
}

/* =========================== HOME =========================== */
const FAQ = [
  ['Where does the data come from?', `<p>The official Clash of Clans API, through your own API key. Every hour (and whenever you press Sync now) the app saves a snapshot of every member's profile, plus the current war, CWL and capital raid data. Everything is stored in files on your computer.</p>`],
  ['Why are some numbers empty at first?', `<p>The game does not give history. Activity and upgrades compare today with older snapshots, so they need a few days of syncing. War attacks are only visible while a war or CWL is running, so war history starts the day you first run the app. Dashed score badges mean there are only a few attacks on record, so treat them as rough.</p>`],
  ['How is the activity score calculated?', `<p>Over the activity window (7, 14 or 30 days) every member earns points: <code>1</code> per troop donated, <code>15</code> per level point of upgrades (a town hall upgrade adds 40 level points), <code>4</code> per attack won, <code>0.05</code> per clan games point, <code>0.02</code> per capital gold contributed and <code>25</code> per war attack.</p><p>Those points are then ranked against the rest of your clan, so the score is a 0 to 100 position within the clan.</p>`],
  ['What decides Active or Inactive?', `<p>This does not use the activity score. A member is <b>Active</b> if, inside the window, they donated, upgraded something, won an attack, earned clan games points, gave capital gold or made a war attack. Otherwise they are <b>Inactive</b>. While the app has less than a day of history it shows "No data yet" instead of guessing.</p>`],
  ['What is war weight?', `<p>An estimate, because the game does not publish an official figure: <code>town hall x 250 + hero levels x 5 + troop, spell, siege, pet and equipment levels x 2</code>. Higher town halls always weigh more, and within a town hall the better upgraded player weighs more. The three numbers are easy to change in <code>app.py</code>.</p>`],
  ['What is impact?', `<p>Stars earned per available attack over the last 20 wars, CWL included, scaled two ways. First by <b>your own town hall</b>: every level above your clan's median town hall adds 8% to your stars, every level below takes 8% off, so a higher town hall is always worth a little more for the same result. Second by <b>the target</b>: every level you hit above your own town hall adds 8%, every level below takes 8% off (up to 3 levels either way).</p><p>The rate is the same in both directions, so hitting up consistently is rewarded fairly without beating a stronger player doing the same job. A missed attack counts as zero. A perfect 100 is three stars on every attack slot from the highest town hall in your clan, hitting an equal town hall.</p><p>The game only shares attack details for the war in progress (or the last one, until a new war starts) and the current CWL season, so the app records wars as they happen, checking every 10 minutes while a war is on. A new clan shows no impact until its first war is captured. During a live war, impact uses the attacks made so far and shows dashed.</p>`],
  ['What is prestige?', `<p>Prestige is what a member is worth to <b>your clan</b>, nothing from other clans. It blends five things, each ranked inside your clan: <code>days in this clan 50%</code>, <code>war and CWL stars earned here 15%</code>, <code>capital gold given here 15%</code>, <code>clan games points earned here 10%</code> and <code>troops donated here 10%</code>.</p><p>Days add up across every time someone was in your clan, so leaving and coming back does not reset them. The game does not say when someone joined, so the app uses ClashKing's join history, then the days it has watched them. If a veteran shows too few days, use <b>Edit join dates</b> on the Clan status page and enter the real date. The other four parts count from the day the app started watching the player, so they grow with time.</p>`],
  ['What is total value?', `<p>One number out of 100 that blends everything: <code>impact 30%</code>, <code>prestige 25%</code>, <code>activity 25%</code> and <code>war weight 20%</code> (as a rank inside your clan). If a score is missing, for example no war data yet, the others are re-weighted so nobody is punished for it.</p>`],
  ['15v15 or 30v30?', `<p>Pick the CWL size next to the roster list. It sets the roster limit, and the roster builder tells you when it is full. The exported image shows how many slots you filled.</p>`],
  ['What do the stat rows on a profile mean?', `<p><b>All time</b> comes from the player's account and includes every clan they have been in. <b>In this clan</b> counts what happened since the app started watching them, and war and CWL stars are counted from the attacks it recorded for your clan. <b>Last days</b> is the change over the activity window you picked. Season-based numbers in the game reset every month, so the app uses lifetime counters instead.</p><p>The raid weekend board adds up only the capital gold a member raided, for every raid weekend that ended this calendar month, and starts over on the 1st.</p>`],
  ['What happens when someone joins from another clan?', `<p>If their old clan is also tracked on this site, the app reuses what it recorded there: war attacks for impact (until they have 4 attack slots here) and their activity baseline, so a newcomer is not shown as empty. Those scores carry a small <b>history icon</b>, and hovering it tells you where the numbers came from.</p><p>Prestige never borrows from other clans. Days and contributions only count inside your clan.</p>`],
    ['Is this affiliated with Supercell?', `<p>No. This is a fan-made tool. Clash of Clans and its artwork belong to Supercell.</p>`]
];
PAGES.home = {
  render() {
    $('#view').innerHTML = `
    <section class="hero">
      <div class="panel-o rv"><h1>The clash of clans tool for all clan related data analyzing and organization</h1>
        <ul><li>Plan CWL with activity, prestige and total value scores, rank members on every leaderboard, and see your full roster at a glance.</li>
        <li>From donations to capital gold to weekly upgrades, track it all, then plan your league around it.</li></ul></div>
      <div class="hero-r"><div class="px" style="--d:18"><img src="assets/hero-fly.png" alt=""></div><ul class="ast"><li>Plan. Rank. Manage.</li><li>Plan your league. Rank your members. Know your clan.</li><li>Your clan, tracked and planned.</li></ul></div>
    </section>
    <section class="row2">
      <div class="clip rv"><img src="assets/clipboard.png" alt=""><div class="in"><h3>Core Features!</h3>
        <p>CWL Planner: build your league lineup from real activity and prestige scores.</p><p>Leaderboards: donations, capital gold, weekly upgrades, and more.</p><p>Member Overview: your whole roster in one list.</p></div></div>
      <div class="panel-o addbox rv"><div class="px" style="--d:14"><img src="assets/throne.png" alt=""></div><h2>Add your clan today!</h2><p>Enter your clan tag below to start tracking!</p>
        <div class="tagrow"><input id="homeTag" type="text" placeholder="Enter Tag (#ABC123)" autocomplete="off" aria-label="Clan tag"><button class="sh" id="homeGo" aria-label="Add clan">${IC.shield}</button></div><div class="err" id="homeErr"></div></div>
    </section>
    <div class="clans" id="homeClans"></div>
    <section class="sec faq rv" id="faq"><h2>Frequently asked questions</h2><p class="lead">How every number in the app is worked out, so you know exactly what you are looking at.</p>
      ${FAQ.map((f, i) => `<details class="rv" style="transition-delay:${i * 50}ms"${i === 0 ? ' open' : ''}><summary>${f[0]}</summary><div class="ans">${f[1]}</div></details>`).join('')}</section>
    <section class="sec rv" id="contact"><h2>Contact me</h2><p class="lead">Questions, bugs or ideas for the app? Reach me on either of these and I will get back to you.</p>
      <div class="contact">
        <div class="cc rv">${IC.mail.replace('<svg', '<svg class="ico"')}<h3>Email</h3><div class="val">${EMAIL}</div><div class="row-btns"><a class="btn" href="mailto:${EMAIL}" style="text-decoration:none">Send an email</a><button class="btn ghost" data-copy="${EMAIL}">Copy</button></div></div>
        <div class="cc rv" style="transition-delay:120ms">${IC.chat.replace('<svg', '<svg class="ico"')}<h3>Discord</h3><div class="val">${DISCORD}</div><div class="row-btns"><button class="btn" data-copy="${DISCORD}">Copy username</button></div></div>
      </div></section>`;
    this.update();
  },
  update() {
    const el = $('#homeClans'); if (!el) return;
    el.innerHTML = S.clans.length ? '<span class="lbl">Your clans</span>' + S.clans.map(c => `<a class="chip" href="#/roster" data-pick="${esc(c.tag)}"><b>${esc(c.name)}</b><span class="note">${esc(c.tag)}</span></a>`).join('') : '';
  }
};

/* =========================== ROSTER =========================== */
const rosterOrder = (sortKey = S.rsort) => { const by = byTag(), R = S.roster.map(t => by[t]).filter(Boolean); return sortKey === 'manual' ? R : [...R].sort(SORTS[sortKey]); };
const saveRoster = () => { store('roster', S.roster); store('size', S.size); store('rsort', S.rsort); };
function addR(t) { if (S.roster.includes(t)) return; if (S.roster.length >= S.size) { toast(`Roster is full (${S.size}). Remove someone first.`); return; } S.roster.push(t); saveRoster(); PAGES.roster.update(); }
async function rmR(t) {
  const row = $(`#right .rr[data-tag="${t}"]`); if (row && !reduced) { row.classList.add('leaving'); await sleep(250); }
  S.roster = S.roster.filter(x => x !== t); saveRoster(); PAGES.roster.update();
}
function moveR(t, d) { const i = S.roster.indexOf(t), j = i + d; if (i < 0 || j < 0 || j >= S.roster.length) return; [S.roster[i], S.roster[j]] = [S.roster[j], S.roster[i]]; saveRoster(); PAGES.roster.update(); }
function reorderR(t, target, after) {
  S.roster = rosterOrder().map(m => m.tag).filter(x => x !== t); S.roster.splice(S.roster.indexOf(target) + (after ? 1 : 0), 0, t);
  S.rsort = 'manual'; saveRoster(); PAGES.roster.update();
}
const memberCard = (m, inR) => `<div class="mc${inR ? ' in' : ''}" data-tag="${esc(m.tag)}" draggable="true"><div class="c"><div class="thw">${thImg(m.th)}</div>
  <div class="top2"><div class="idb"><div class="nmrow"><span class="nm" data-open="${esc(m.tag)}">${esc(m.name)}</span>${leagueImg(m)}</div><div class="tg">${esc(m.tag)}</div></div>
  <div class="sp">${pill('Activity score', m.activity, false, (m.carried || {}).activity)}${pill('Impact', m.impact, m.impact_n < 4, (m.carried || {}).impact)}${pill('Prestige', m.prestige, m.prestige_n < 3, (m.carried || {}).days)}</div></div>
  <div class="bt"><span>${roleName(m.role)} &nbsp;|&nbsp; <span class="st ${m.status}">${statusText(m)}</span></span><span class="tv">Total value : <b>${Math.round(m.total)}</b><img src="assets/trophy.png" alt=""></span></div></div>
  <div class="cir"><button class="g" data-act="add" ${inR ? 'disabled' : ''} aria-label="Add to roster">${IC.right}</button><button class="r" data-act="rm" ${inR ? '' : 'disabled'} aria-label="Remove from roster">${IC.left}</button></div></div>`;
const rosterRow = (m, i, manual, n) => `<div class="rr" draggable="true" data-tag="${esc(m.tag)}"><div class="rb" title="${esc(m.tag)} · Activity ${Math.round(m.activity)} · Impact ${m.impact == null ? '-' : Math.round(m.impact)} · Prestige ${m.prestige == null ? '-' : Math.round(m.prestige)}">
  ${manual ? `<div class="mvs"><button class="mvb" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&#9650;</button><button class="mvb" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">&#9660;</button></div>` : ''}
  <div class="thc">${thImg(m.th)}</div><div class="mn"><b data-open="${esc(m.tag)}">${esc(m.name)}</b><small>TH${m.th} · ${roleName(m.role)}</small></div>
  ${leagueImg(m)}<div class="tot">${Math.round(m.total)}<small>TOTAL</small></div><button class="rx" data-act="rm" aria-label="Remove from roster">&#10005;</button>${CHEV}</div>
  <div class="dia">${String(i + 1).padStart(2, '0')}</div><span class="dots"></span></div>`;

PAGES.roster = {
  render() {
    $('#view').innerHTML = `<div id="msgs"></div><div class="bn"><div class="t" id="bnT"></div><div class="i"></div></div>
    <div class="ctl"><span class="lbl">Sort by:</span><select id="lsort" aria-label="Sort members"></select>
      <button class="pillt" data-t="activity">Activity</button><button class="pillt" data-t="impact">Impact</button><button class="pillt" data-t="prestige">Prestige</button>
      <span class="lbl">Roster size:</span><select id="size" aria-label="CWL size"><option value="15">15v15</option><option value="30">30v30</option></select>
      <input type="search" id="q" placeholder="Search name or tag" aria-label="Search"></div>
    <div class="cols"><div class="pnl" id="lpanel"><h2>Clan members (unassigned pool) <small id="lc"></small></h2><div class="lst" id="left"></div></div>
      <div class="pnl dk" id="rpanel"><h2>CWL roster <span><button class="btn" id="exp">Export image</button> <button class="btn" id="clr">Clear</button></span></h2><div class="knight"></div>
        <div class="rtools"><span id="rcount"></span><label>Order <select id="rsort" aria-label="Order roster"></select></label></div><div class="lst" id="right"></div></div></div>`;
    $('#q').value = S.q; this.update();
  },
  update() {
    if (!$('#left')) return;
    const keep = [$('#left').scrollTop, $('#right').scrollTop], before = snap('.mc,.rr');
    $('#msgs').innerHTML = messages(); $('#bnT').textContent = cwlBanner();
    $('#lsort').innerHTML = sortOpts(S.lsort); $('#size').value = S.size;
    $('#rsort').innerHTML = sortOpts(S.rsort, `<option value="manual"${S.rsort === 'manual' ? ' selected' : ''}>Manual (drag or use arrows)</option>`);
    $$('.pillt').forEach(b => b.classList.toggle('on', S.on[b.dataset.t]));
    const q = S.q.toLowerCase(), list = S.members.filter(m => !q || m.name.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q)).sort(SORTS[S.lsort] || SORTS.weight);
    $('#lc').textContent = S.loaded ? `${list.length} shown` : '';
    $('#left').innerHTML = !S.loaded ? '<div class="skl"></div>'.repeat(5) : list.length ? list.map(m => memberCard(m, S.roster.includes(m.tag))).join('') : `<div class="empty">${S.clan ? 'No members yet. Press Sync now.' : 'Add a clan to get started.'}</div>`;
    const R = rosterOrder(), manual = S.rsort === 'manual';
    $('#rcount').innerHTML = `<b style="color:${R.length > S.size ? 'var(--red)' : 'var(--gold)'}">${R.length}</b> / ${S.size} players &nbsp;·&nbsp; weight ${num(R.reduce((s, m) => s + m.weight, 0))}`;
    $('#right').innerHTML = R.length ? R.map((m, i) => rosterRow(m, i, manual, R.length)).join('') : '<div class="empty">Drag players here, or press the green arrow on a member, to build your roster.</div>';
    $('#left').scrollTop = keep[0]; $('#right').scrollTop = keep[1]; flip(before, '.mc,.rr');
  }
};

/* =========================== LEADERBOARDS =========================== */
PAGES.boards = {
  render() {
    $('#view').innerHTML = `<div id="msgs"></div><div class="lb-h"><h1>Leaderboards</h1><div class="dots2" id="dots"></div><button class="btn ghost" id="prev" aria-label="Previous">&#8592;</button><button class="btn ghost" id="next" aria-label="Next">&#8594;</button></div><div class="track" id="track"></div>`;
    const h = document.createElement('div'); h.className = 'hint'; h.innerHTML = `Swipe to see more ${IC.swipe}`; document.body.appendChild(h);
    const tr = $('#track'); this.seen = new Set();
    this.io = 'IntersectionObserver' in window && !reduced ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); this.seen.add(+e.target.dataset.i); this.io.unobserve(e.target); } }), { root: tr, threshold: .3 }) : null;
    let down = false, sx = 0, sl = 0, moved = false;
    tr.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.target.closest('button')) return; down = true; moved = false; sx = e.clientX; sl = tr.scrollLeft; });
    window.addEventListener('pointermove', e => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 5) { moved = true; tr.classList.add('drag'); } if (moved) tr.scrollLeft = sl - dx; });
    window.addEventListener('pointerup', () => { if (!down) return; down = false; tr.classList.remove('drag'); });
    tr.addEventListener('scroll', () => {
      if (tr.scrollLeft > 40) $('.hint')?.classList.add('gone');
      const step = tr.firstElementChild ? tr.firstElementChild.offsetWidth + 28 : 1; $$('#dots i').forEach((d, i) => d.classList.toggle('on', i === Math.round(tr.scrollLeft / step)));
    }, { passive: true });
    const stepBy = d => tr.scrollBy({ left: d * (tr.firstElementChild ? tr.firstElementChild.offsetWidth + 28 : 400), behavior: 'smooth' });
    $('#prev').onclick = () => stepBy(-1); $('#next').onclick = () => stepBy(1);
    this.update();
  },
  update() {
    const tr = $('#track'); if (!tr) return; $('#msgs').innerHTML = messages();
    if (!S.loaded) { tr.innerHTML = '<article class="slide"><div class="skl"></div><div class="skl"></div></article>'.repeat(2); return; }
    const left = tr.scrollLeft;
    tr.innerHTML = S.boards.length ? S.boards.map((b, i) => `<article class="slide" data-i="${i}"><button class="btn xp" data-lbexp="${i}">Export image</button><h2>${esc(b.title)}</h2>
      <div class="sub">1st to ${ord(Math.min(10, b.rows.length || 10)).toLowerCase()} place &nbsp;·&nbsp; last ${S.days} days</div>
      ${b.rows.length ? b.rows.map((r, k) => `<div class="lr"><span class="rk">${ord(k + 1)}</span><span class="pl">${r.th ? thImg(r.th) : ''}<span data-open="${esc(r.tag)}">${esc(r.name)}</span>${leagueImg(r)}</span><span class="vl">${esc(r.label)}</span></div>`).join('') : '<div class="lr none">Nothing to show yet. This fills in as the app keeps syncing.</div>'}</article>`).join('')
      : '<article class="slide"><h2>No data</h2><div class="lr none">Add a clan and sync to see leaderboards.</div></article>';
    $$('.slide', tr).forEach((s, i) => { $$('.lr', s).forEach((r, k) => r.style.setProperty('--i', k)); if (this.seen.has(i) || !this.io) s.classList.add('seen'); else this.io.observe(s); });
    $('#dots').innerHTML = S.boards.slice(0, Math.max(1, S.boards.length - 1)).map(() => '<i></i>').join(''); tr.scrollLeft = left; tr.dispatchEvent(new Event('scroll'));
  }
};

/* =========================== MEMBERS =========================== */
const MF = { status: 'all', th: 'all', sort: 'total' };
PAGES.members = {
  render() {
    $('#view').innerHTML = `<div id="msgs"></div><div class="mh">${SEG('members')}<h1 class="ttl"><b id="mcount" class="cu" data-to="0">0</b> <span>Members</span></h1>
      <input type="search" id="mq" placeholder="Search name or tag" aria-label="Search members" style="min-width:240px">
      <div class="fil"><button class="btn ghost" id="fbtn">${IC.filter} Filter</button><div class="fpop" id="fpop">
        <label class="fld">Status<select id="fs"><option value="all">All</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
        <label class="fld">Town hall<select id="ft"></select></label><label class="fld">Sort by<select id="fo"></select></label></div></div></div><div class="grid3" id="mgrid"></div>`;
    $('#mq').value = S.q; this.update(); countUp($('.mh'));
  },
  update() {
    if (!$('#mgrid')) return; $('#msgs').innerHTML = messages();
    const ths = [...new Set(S.members.map(m => m.th))].sort((a, b) => b - a);
    $('#fs').value = MF.status; $('#ft').innerHTML = '<option value="all">All</option>' + ths.map(t => `<option value="${t}"${String(t) === MF.th ? ' selected' : ''}>TH${t}</option>`).join(''); $('#fo').innerHTML = sortOpts(MF.sort);
    const q = S.q.toLowerCase(), list = S.members.filter(m => (MF.status === 'all' || m.status === MF.status) && (MF.th === 'all' || String(m.th) === MF.th) && (!q || m.name.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q))).sort(SORTS[MF.sort]);
    $('#mcount').dataset.to = list.length; $('#mcount').textContent = S.loaded ? list.length : '…';
    $('#mgrid').innerHTML = !S.loaded ? '<div class="skl" style="height:260px;border-radius:26px"></div>'.repeat(6) : list.length ? list.map(m => `<article class="mm" data-open="${esc(m.tag)}"><div class="hd"><div class="av">${thImg(m.th)}<span class="dot ${m.status}"></span></div>
      <div><div class="nm">${esc(m.name)} ${leagueImg(m)}</div><div class="rl">${roleName(m.role)} · ${esc(m.tag)}</div></div></div>
      <div class="ins"><div class="f2"><div><small>Town hall</small><b>TH${m.th}</b></div><div><small>Total value</small><b>${Math.round(m.total)}</b></div></div>
      <div class="f2"><div><small>War weight</small><b>${num(m.weight)}</b></div><div><small>Status</small><b>${statusText(m)}</b></div></div>
      <div class="ln">${IC.trophy}<span>${num(m.trophies)} trophies${m.league_name ? ' · ' + esc(m.league_name) : ''}</span></div>
      <div class="ln">${IC.coin}<span>${num(m.don_delta)} donated · ${m.upg_delta} upgrade levels</span></div>
      <div class="sp">${pill('Activity', m.activity, false, (m.carried || {}).activity)}${pill('Impact', m.impact, m.impact_n < 4, (m.carried || {}).impact)}${pill('Prestige', m.prestige, m.prestige_n < 3, (m.carried || {}).days)}</div></div></article>`).join('')
      : `<div class="empty" style="grid-column:1/-1">${S.clan ? 'No members match.' : 'Add a clan to see your members.'}</div>`;
  }
};

/* =========================== PLAYER PROFILE =========================== */
const PP = { tab: 'ov', tag: '' };
const PARTS = { donations: 'Donations', upgrades: 'Upgrades', attacks: 'Attack wins', games: 'Clan games', capital: 'Capital gold', war: 'War attacks' };
const STAT_COLS = [['don', 'Donated'], ['war', 'War stars'], ['cwl', 'CWL stars'], ['atk', 'Attacks won'], ['raid', 'Raided'], ['cap', 'Capital given'], ['games', 'Clan games']];
const cuNum = v => v == null ? '<span class="dim">-</span>' : `<span class="cu" data-to="${v}">${num(v)}</span>`;
const ringHtml = (v, label, hint) => `<div class="ringw"><svg class="ring" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="v" cx="50" cy="50" r="42" data-v="${v == null ? 0 : v}"/></svg><div class="rn"><b class="cu" data-to="${v == null ? 0 : Math.round(v)}">${v == null ? '-' : Math.round(v)}</b></div><span>${label}${hint ? ` <s class="rh" title="${esc(hint)}">${IC.hist}</s>` : ''}</span></div>`;
const tile = (label, v, sub = '') => `<div class="tile"><small>${label}</small><b>${v == null ? '-' : (typeof v === 'number' ? `<span class="cu" data-to="${v}">${num(v)}</span>` : v)}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;

function ppTab(name) {
  PP.tab = name; $$('.pp-tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', b.dataset.tab === name); });
  $$('.pp-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
  moveInd($('.pp-tabs'), 'button.on', 'ind'); const pane = $(`.pp-pane[data-pane="${name}"]`); countUp(pane); animateBars(pane);
}
function showPlayer(tag, tab) {
  const m = byTag()[tag]; if (!m) return;
  PP.tag = tag; PP.tab = tab || PP.tab || 'ov';
  const p = m.act_parts || {}, tot = Object.values(p).reduce((a, b) => a + b, 0) || 1, inR = S.roster.includes(tag), st = m.stats || { all: {}, since: {}, window: {} };
  const joined = new Date(m.joined_at * 1000).toISOString().slice(0, 10);
  const row = (label, o) => `<div class="pp-r"><span class="pp-rl">${label}</span>${STAT_COLS.map(c => `<span class="pp-v">${cuNum(o[c[0]])}</span>`).join('')}</div>`;
  const heroes = Object.entries(m.heroes).map(([k, v]) => `${k} ${v}`).join('  ·  ') || 'none';
  const srcNote = { manual: 'Date set by you.', clashking: 'From ClashKing\'s clan history. Days count every stint in this clan.', seen: 'No join history found, so this is the day the app first saw them. Set the real one if you know it.' }[m.joined_source] || '';
  const trk = (m.stats && m.stats.since) || {};
  $('#plBody').innerHTML = `<div class="pp" style="--len:${Math.max(4, m.name.length)}">
    <div class="pp-ghost"><span class="g1">${esc(m.name)}</span><span class="g2">${m.th}</span></div>
    <div class="pp-bar"><button class="pp-x" data-close aria-label="Close profile">&#10005;</button><img class="pp-logo" src="assets/logo-crown.png" alt="">
      <div class="pp-tabs" role="tablist"><button data-tab="ov" role="tab">Overview</button><button data-tab="sc" role="tab">Scores</button><button data-tab="wr" role="tab">War</button></div>
      <button class="pp-add${inR ? ' in' : ''}" id="ppAdd" ${inR ? 'disabled' : ''}>${inR ? 'In roster &#10003;' : 'Add to roster <b>+</b>'}</button></div>
    <div class="pp-body">
      <section class="pp-pane" data-pane="ov"><div class="pp-left">
        <div class="pp-role">${roleName(m.role)}</div><h2 class="pp-name">${esc(m.name)}</h2><div class="pp-ul"></div>
        <div class="pp-id">${leagueImg(m)}<span>${esc(m.tag)}</span><i></i><span>TH${m.th}</span><span class="st ${m.status}" style="font:600 17px var(--body)">${statusText(m)}</span></div>
        <div class="pp-two"><div><small>Town hall</small><b>${m.th}</b></div><div><small>War weight</small><b class="cu" data-to="${m.weight}">${num(m.weight)}</b></div><div><small>Total value</small><b class="cu" data-to="${Math.round(m.total)}">${Math.round(m.total)}</b></div></div>
        <dl class="pp-kv"><dt>Joined :</dt><dd>${joined}</dd><dt>League :</dt><dd>${esc(m.league_name || 'Unranked')}</dd><dt>Trophies :</dt><dd>${num(m.trophies)}${m.best_trophies ? ` <span class="dim">(best ${num(m.best_trophies)})</span>` : ''}</dd><dt>Heroes :</dt><dd>${esc(heroes)}</dd></dl>
          ${Object.keys(m.carried || {}).length ? `<div class="pp-carry">${IC.hist}<div><b>Carried over from an earlier clan</b>${Object.values(m.carried).map(x => `<p>${esc(x)}</p>`).join('')}</div></div>` : ''}</div>
        <div class="pp-art"><img class="th-big" src="assets/th/th${m.th}.png" alt="Town hall ${m.th}" onerror="this.outerHTML='<div class=&quot;th-fallback&quot;>${m.th}</div>'"></div></section>
      <section class="pp-pane wide" data-pane="sc"><div class="rings">${ringHtml(m.total, 'Total value')}${ringHtml(m.activity, 'Activity', (m.carried || {}).activity)}${ringHtml(m.impact, 'Impact', (m.carried || {}).impact)}${ringHtml(m.prestige, 'Prestige', (m.carried || {}).days)}</div>
        <div class="sc-grid"><div><h4>Activity, last ${S.days} days</h4>${Object.keys(PARTS).map(k => `<div class="bar2"><span>${PARTS[k]}</span><div class="trk"><i data-w="${Math.round(100 * (p[k] || 0) / tot)}"></i></div><span style="text-align:right">${Math.round(p[k] || 0)} pts</span></div>`).join('')}
          <h4>More all-time stats</h4><div class="tiles">${tile('Spells donated', m.spell_total)}${tile('Siege donated', m.siege_total)}${tile('Defenses won', m.def_total)}${tile('Troops donated', m.don_total)}</div></div>
          <div><h4>Prestige is built from <small class="dim">this clan only</small></h4><div class="kv"><span>Days in this clan</span><b>${m.days_in_clan}</b><span>War stars here</span><b>${num((st.since.war || 0) + (st.since.cwl || 0))}</b><span>Capital gold given here</span><b>${num(st.since.cap || 0)}</b><span>Clan games points here</span><b>${num(st.since.games || 0)}</b><span>Troops donated here</span><b>${num(st.since.don || 0)}</b></div>
          <div class="jrow"><label class="fld">Joined the clan on<input type="date" id="jDate" data-tag="${esc(m.tag)}" value="${joined}"></label><button class="btn" id="jSave">Save date</button>${m.joined_manual ? '<button class="btn ghost" id="jReset">Use detected</button>' : ''}</div><p class="note">${srcNote}</p>
          <button class="btn ghost" id="ckDebug" data-tag="${esc(m.tag)}">Check join history source</button><pre class="ckout" id="ckOut"></pre></div></div></section>
      <section class="pp-pane wide" data-pane="wr"><div class="tiles lg">${tile('Attacks used', m.attacks_used, `of ${m.attacks_avail} available`)}${tile('Missed', m.missed)}${tile('3-star attacks', m.threes)}${tile('War stars here', trk.war, 'tracked in this clan')}${tile('CWL stars here', trk.cwl, 'tracked in this clan')}${tile('Impact', m.impact == null ? null : Math.round(m.impact), m.impact_prov ? 'provisional, war in progress' : `${m.impact_n} attack slots`)}</div>
        <p class="note" style="margin-top:18px">War and CWL numbers only cover wars the app has recorded, so they grow the longer it runs. Lifetime totals are in the table below.</p></section>
    </div>
    <div class="pp-stats"><div class="pp-scroll"><div class="pp-h"><span></span>${STAT_COLS.map(c => `<span>${c[1]}</span>`).join('')}</div>
      ${row('All time', st.all)}${row('In this clan', st.since)}${row('Last ' + S.days + ' days', st.window)}</div></div></div>`;
  openDlg($('#plDlg')); ppTab(PP.tab); countUp($('.pp-stats'));
}

/* =========================== ROSTER EXPORT =========================== */
let rBg = null;
function exportPlayers() { const o = $('#rOrder').value; if (o === 'roster') return rosterOrder(); const by = byTag(), R = S.roster.map(t => by[t]).filter(Boolean); return o === 'manual' ? R : R.sort(SORTS[o]); }
function drawR() {
  const m = new Date().toLocaleString('en', { month: 'long', year: 'numeric' });
  renderRosterImage($('#rCanvas'), { title: $('#rTitle').value, subtitle: $('#rSub').value, footer: $('#rFoot').value, size: S.size, players: exportPlayers(),
    opts: { cols: +$('#rCols').value, scores: $('#rScores').checked, league: $('#rLeague').checked, tags: $('#rTags').checked, bgImg: rBg } });
}
function openRosterExport() {
  if (!S.roster.length) { toast('Add players to the roster first.'); return; }
  $('#rTitle').value = `${clanName()} war roster`; $('#rSub').value = `Clan War League ${S.size}v${S.size}, ${new Date().toLocaleString('en', { month: 'long', year: 'numeric' })}`; $('#rFoot').value = S.clan;
  $('#rOrder').innerHTML = `<option value="roster">Same as roster panel</option><option value="manual">As arranged by hand</option>` + Object.keys(SORT_LABEL).map(k => `<option value="${k}">${SORT_LABEL[k]}</option>`).join('');
  $('#rCols').value = S.size > 15 ? '2' : '1'; openDlg($('#rDlg')); drawR();
}

/* =========================== LEADERBOARD EXPORT =========================== */
const LB = { acc: '#f0b646', keys: ['total', 'activity', 'impact', 'prestige'], th: true, league: true };
const SWATCH = ['#f0b646', '#2fc79a', '#e5544d', '#4d7cff', '#a46bff', '#5fd0ff'];
function drawL() {
  const rank = $('#lRank').value, n = +$('#lRows').value; let rows, cols;
  if (rank.startsWith('board:')) { const b = S.boards[+rank.slice(6)]; rows = b.rows.slice(0, n).map(r => ({ ...r, cells: [r.label] })); cols = ['Result']; }
  else {
    const keys = LB.keys.length ? LB.keys : [rank]; cols = keys.map(k => METRICS[k][1]);
    rows = [...S.members].sort((a, z) => (z[rank] ?? -1) - (a[rank] ?? -1)).slice(0, n).map(m => ({ ...m, cells: keys.map(k => fmtM(k, m)) }));
  }
  renderLeaderboardImage($('#lCanvas'), { title: $('#lTitle').value, script: $('#lSub').value, footer: $('#lFoot').value, accent: LB.acc, rows, cols,
    clanLine: `${clanName()}  ${S.clan}`, date: new Date().toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }), opts: { th: LB.th, league: LB.league } });
}
function paintLControls() {
  $('#lColors').innerHTML = SWATCH.map(c => `<i style="background:${c}" data-c="${c}" class="${c === LB.acc ? 'on' : ''}"></i>`).join('') + `<input type="color" id="lPick" value="${LB.acc}" aria-label="Custom colour">`;
  $('#lCols').innerHTML = Object.keys(METRICS).map(k => `<label><input type="checkbox" data-k="${k}" ${LB.keys.includes(k) ? 'checked' : ''}> ${METRICS[k][0]}</label>`).join('') +
    `<label><input type="checkbox" id="lTH" ${LB.th ? 'checked' : ''}> TH icons</label><label><input type="checkbox" id="lLG" ${LB.league ? 'checked' : ''}> League icons</label>`;
  $('#lCols').style.display = $('#lRank').value.startsWith('board:') ? 'none' : '';
}
function openLeaderboardExport(i) {
  const b = S.boards[i]; if (!b) return;
  $('#lRank').innerHTML = `<optgroup label="Rank members by">${Object.keys(METRICS).map(k => `<option value="${k}">${METRICS[k][0]}</option>`).join('')}</optgroup><optgroup label="Board results">${S.boards.map((x, k) => x.metric ? '' : `<option value="board:${k}">${esc(x.title)}</option>`).join('')}</optgroup>`;
  $('#lRank').value = b.metric || `board:${i}`; if (!$('#lRank').value) $('#lRank').value = 'total';
  if (b.metric && !LB.keys.includes(b.metric) && LB.keys.length < 6) LB.keys = [b.metric, ...LB.keys];
  $('#lTitle').value = b.title; $('#lSub').value = `Top ${$('#lRows').value}`; $('#lFoot').value = `Based on the last ${S.days} days`; paintLControls(); openDlg($('#lDlg')); drawL();
}
