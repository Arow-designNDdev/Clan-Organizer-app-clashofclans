'use strict';
let CUR = 'home'; const autoSync = {}; let busy = false;
const NAV = [['home', 'Home', IC.home], ['roster', 'Roster builder', IC.edit], ['boards', 'Leaderboards', IC.chart], ['members', 'Members', IC.users], ['cwl', 'CWL analysis', IC.cwl]];
$('#nav').innerHTML = NAV.map(n => `<a href="#/${n[0]}" data-r="${n[0]}" title="${n[1]}">${n[2]} <span>${n[1]}</span></a>`).join('');
$('#foot').innerHTML = `<div class="fg"><div><div class="b"><img src="assets/logo-crown.png" alt=""><span>Clan Organizer</span></div><p>The Clash of Clans tool for clan data, CWL planning and leaderboards. Plan. Rank. Manage.</p></div>
  <div><h4>Explore</h4>${NAV.map(n => `<a href="#/${n[0]}">${n[1]}</a>`).join('')}<a href="#/home" data-jump="faq">FAQ</a></div>
  <div><h4>Contact</h4><a href="mailto:${EMAIL}">${EMAIL}</a><a href="#/home" data-jump="contact">Discord: ${DISCORD}</a></div></div>
  <div class="fl"><span>Fan-made tool. Not affiliated with Supercell. Clash of Clans and its artwork belong to Supercell.</span><span>Join history by <a href="https://clashk.ing" target="_blank" rel="noopener">ClashKing</a> · Built by Arow</span></div>`;

$('#foot').classList.add('rv');
function route() { const h = (location.hash || '#/home').replace('#/', '').split('?')[0]; return PAGES[h] ? h : 'home'; }
function renderSubbar() {
  const el = $('#subbar');
  if (CUR === 'home' || !S.clans.length) { el.innerHTML = ''; return; }
  const meta = S.st.last_sync ? `Synced ${new Date(S.st.last_sync * 1000).toLocaleString()} · ${S.st.snapshots} snapshots · ${S.st.wars} wars stored` : (S.st.syncing ? 'First sync running...' : 'Not synced yet');
  el.innerHTML = `<select id="clanSel" aria-label="Clan">${S.clans.map(c => `<option value="${esc(c.tag)}"${c.tag === S.clan ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <button class="btn ghost" id="addB">Add clan</button><button class="btn ghost" id="delB">Remove</button><span class="meta">${esc(meta)}</span>
    <label class="note">Activity window <select id="days">${[7, 14, 30].map(d => `<option value="${d}"${d === S.days ? ' selected' : ''}>${d} days</option>`).join('')}</select></label><button class="btn" id="syncB"${busy ? ' disabled' : ''}>${busy ? 'Syncing...' : 'Sync now'}</button>`;
}
let navFirst = true, navToken = 0;
async function go() {
  const my = ++navToken, next = route(), view = $('#view');
  if (!navFirst && !reduced) { view.classList.add('out'); await sleep(170); if (my !== navToken) return; }
  navFirst = false; view.classList.remove('out'); CUR = next;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (CUR === 'status' ? 'members' : CUR))); markNav(); moveInd($('#nav'), 'a.on');
  $$('.hint').forEach(x => x.remove()); renderSubbar(); PAGES[CUR].render(); window.scrollTo(0, 0);
  view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
  stagger(view, '.mc,.rr,.mm,.chip,.skl'); playIn(view); reveal(document); countUp(view); animateBars(view);
}
function markNav() { $$('#nav a').forEach(a => a.classList.toggle('locked', a.dataset.r === 'cwl' && !cwlOpen())); }
function refreshUI() { markNav(); renderSubbar(); PAGES[CUR]?.update?.(); }

async function loadAll() {
  try {
    const c = await get('/api/clans'); S.clans = c.clans; S.configured = c.configured;
    if (!S.clans.find(x => x.tag === S.clan)) S.clan = S.clans[0]?.tag || '';
    localStorage.setItem('clan', S.clan);
    if (!S.clan) { S.members = []; S.boards = []; S.st = {}; S.loaded = true; refreshUI(); return; }
    S.roster = recall('roster', []); S.size = +recall('size', 15); S.rsort = recall('rsort', 'weight');
    const [st, m, b] = await Promise.all([get(cu('/api/state')), get(cu(`/api/members?days=${S.days}`)), get(cu(`/api/leaderboards?days=${S.days}`))]);
    const first = !S.loaded; S.st = st; S.members = m.members; S.hd = m.history_days; S.boards = b.boards; S.loaded = true;
    if (S.members.length) { const by = byTag(); S.roster = S.roster.filter(t => by[t]); saveRoster(); }
    refreshUI(); if (first && S.members.length) { stagger($('#view'), '.mc,.rr,.mm'); playIn($('#view')); countUp($('.mh') || document.createElement('i')); }
    if (st.configured && !st.last_sync && !st.syncing && !autoSync[S.clan]) { autoSync[S.clan] = 1; await doSync(); }
  } catch (e) { toast('Could not reach the app. Is python app.py still running?'); }
}
async function waitSync() { for (let i = 0; i < 60; i++) { const s = await get(cu('/api/state')); if (!s.syncing) return; await new Promise(r => setTimeout(r, 2000)); } }
async function doSync() { if (busy || !S.clan) return; busy = true; renderSubbar(); try { const j = await (await fetch(cu('/api/sync'), { method: 'POST' })).json(); if (j.cooldown) toast(`Synced recently. Try again in ${Math.ceil(j.cooldown / 60)} min.`); } finally { busy = false; await loadAll(); } }
async function addClan(tag, errEl, btn) {
  if (errEl) errEl.textContent = ''; if (btn) btn.disabled = true;
  try {
    const r = await authFetch('/api/clans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag }) }), d = await r.json();
    if (!r.ok) { if (errEl) errEl.textContent = d.error; return false; }
    S.clan = d.tag; localStorage.setItem('clan', S.clan); S.loaded = false; S.members = []; S.boards = [];
    closeDlg($('#addDlg')); if (location.hash !== '#/roster') location.hash = '#/roster'; else go();
    toast(`Added ${d.name}. First sync running...`); await loadAll(); await waitSync(); await loadAll(); return true;
  } finally { if (btn) btn.disabled = false; }
}
function switchClan(tag) { S.clan = tag; localStorage.setItem('clan', tag); S.members = []; S.boards = []; S.st = {}; S.loaded = false; S.roster = recall('roster', []); S.size = +recall('size', 15); S.rsort = recall('rsort', 'weight'); refreshUI(); loadAll(); }

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target;
  if (t.tagName === 'DIALOG') { closeDlg(t); return; }
  if (t.closest('[data-close]')) { closeDlg(t.closest('dialog')); return; }
  const rc = t.closest('[data-round]'); if (rc) { PAGES.cwl.sel = +rc.dataset.round; PAGES.cwl.update(true); return; }
  if (t.id === 'ckDebug') {
    const out = $('#ckOut'); out.textContent = 'Asking ClashKing...';
    try { const j = await get(cu('/api/debug/ck?tag=' + encodeURIComponent(t.dataset.tag))); out.textContent = JSON.stringify(j, null, 2); } catch (e) { out.textContent = 'Could not reach the app.'; }
    return;
  }
  if (t.closest('[data-jdopen]')) { e.preventDefault(); openJoinDates(); return; }
  if (t.id === 'jdSave') { saveJoinDates(); return; }
  if (t.id === 'cwlCheck') {
    t.disabled = true; t.textContent = 'Checking...';
    try { await fetch(cu('/api/cwl/check'), { method: 'POST' }); await loadAll(); await PAGES.cwl.update(true); } finally { t.disabled = false; }
    return;
  }
  if (t.id === 'armyBtn') { PAGES.cwl.armies(); return; }
  const tb = t.closest('.pp-tabs button'); if (tb) { ppTab(tb.dataset.tab); return; }
  if (t.closest('#ppAdd')) { addR(PP.tag); if (S.roster.includes(PP.tag)) { const b = $('#ppAdd'); b.disabled = true; b.classList.add('in'); b.innerHTML = 'In roster &#10003;'; } return; }
  if (t.closest('.faq summary')) { e.preventDefault(); toggleFaq(t.closest('details')); return; }
  const open = t.closest('[data-open]'); if (open && !t.closest('[data-act]')) { showPlayer(open.dataset.open, 'ov'); return; }
  const copy = t.closest('[data-copy]'); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied ' + copy.dataset.copy); } catch { toast(copy.dataset.copy); } return; }
  const jump = t.closest('[data-jump]'); if (jump) { e.preventDefault(); if (CUR !== 'home') location.hash = '#/home'; setTimeout(() => document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }), 60); return; }
  const pick = t.closest('[data-pick]'); if (pick) { S.clan = pick.dataset.pick; localStorage.setItem('clan', S.clan); S.loaded = false; loadAll(); return; }
  const act = t.closest('[data-act]');
  if (act) { const row = act.closest('[data-tag]'), tag = row?.dataset.tag, a = act.dataset.act; if (a === 'add') addR(tag); else if (a === 'rm') rmR(tag); else moveR(tag, a === 'up' ? -1 : 1); return; }
  if (t.closest('.pillt')) { const k = t.closest('.pillt').dataset.t; S.on[k] = !S.on[k]; S.lsort = 'mix'; PAGES.roster.update(); return; }
  if (t.id === 'exp') return openRosterExport();
  if (t.id === 'clr') { if (S.roster.length && confirm('Clear the roster?')) { S.roster = []; saveRoster(); PAGES.roster.update(); } return; }
  const lb = t.closest('[data-lbexp]'); if (lb) return openLeaderboardExport(+lb.dataset.lbexp);
  if (t.closest('#homeGo')) return addClan($('#homeTag').value, $('#homeErr'), t.closest('#homeGo'));
  if (t.id === 'addB') { $('#addErr').textContent = ''; $('#addTag').value = ''; openDlg($('#addDlg')); $('#addTag').focus(); return; }
  if (t.id === 'addGo') return addClan($('#addTag').value, $('#addErr'), t);
  if (t.id === 'delB') { if (S.clan && confirm('Remove this clan from the list? Its saved history stays on disk.')) { await authFetch('/api/clans?tag=' + encodeURIComponent(S.clan), { method: 'DELETE' }); S.clan = ''; await loadAll(); } return; }
  if (t.id === 'syncB') return doSync();
  if (t.id === 'jSave' || t.id === 'jReset') {
    const inp = $('#jDate'), tag = inp.dataset.tag, date = t.id === 'jReset' ? '' : inp.value;
    const r = await authFetch(cu('/api/joined'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, date }) });
    if (!r.ok) { toast((await r.json()).error || 'Could not save the date.'); return; }
    await loadAll(); showPlayer(tag, PP.tab); toast('Join date saved'); return;
  }
  if (t.id === 'fbtn') { $('#fpop').classList.toggle('on'); return; }
  if (t.closest('#lColors i')) { LB.acc = t.closest('i').dataset.c; paintLControls(); drawL(); return; }
  if (t.id === 'rSave') return $('#rCanvas').toBlob(b => dl(b, $('#rTitle').value));
  if (t.id === 'lSave') return $('#lCanvas').toBlob(b => dl(b, $('#lTitle').value));
  if (t.id === 'rCopy' || t.id === 'lCopy') { const cv = t.id === 'rCopy' ? $('#rCanvas') : $('#lCanvas'); return cv.toBlob(async b => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Image copied'); } catch { toast('Copy blocked by the browser. Use Download.'); } }); }
  if (!t.closest('.fil')) $('#fpop')?.classList.remove('on');
});
const dl = (b, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (name || 'image').replace(/[^\w-]+/g, '_') + '.png'; a.click(); };
document.addEventListener('change', e => {
  const t = e.target, id = t.id;
  if (id === 'clanSel') return switchClan(t.value);
  if (id === 'days') { S.days = +t.value; loadAll(); return; }
  if (id === 'lsort') { S.lsort = t.value; PAGES.roster.update(); return; }
  if (id === 'size') { S.size = +t.value; saveRoster(); PAGES.roster.update(); return; }
  if (id === 'rsort') { if (t.value === 'manual') S.roster = rosterOrder().map(m => m.tag); S.rsort = t.value; saveRoster(); PAGES.roster.update(); return; }
  if (['fs', 'ft', 'fo'].includes(id)) { MF[{ fs: 'status', ft: 'th', fo: 'sort' }[id]] = t.value; PAGES.members.update(); stagger($('#mgrid'), '.mm'); playIn($('#mgrid')); return; }
  if (['rOrder', 'rCols', 'rScores', 'rLeague', 'rTags'].includes(id)) return drawR();
  if (id === 'rBg') { const f = t.files[0]; if (!f) { rBg = null; return drawR(); } const im = new Image(); im.onload = () => { rBg = im; drawR(); }; im.src = URL.createObjectURL(f); return; }
  if (id === 'lRank' || id === 'lRows') { if (id === 'lRank') paintLControls(); $('#lSub').value = `Top ${$('#lRows').value}`; return drawL(); }
  if (t.dataset.k) { const k = t.dataset.k; LB.keys = t.checked ? [...LB.keys, k] : LB.keys.filter(x => x !== k); if (LB.keys.length > 6) { LB.keys.pop(); t.checked = false; toast('Up to 6 columns fit on the image.'); } return drawL(); }
  if (id === 'lTH') { LB.th = t.checked; return drawL(); } if (id === 'lLG') { LB.league = t.checked; return drawL(); }
  if (id === 'lPick') { LB.acc = t.value; return drawL(); }
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'q' || id === 'mq') { S.q = e.target.value; PAGES[CUR].update(); }
  if (['rTitle', 'rSub', 'rFoot'].includes(id)) drawR(); if (['lTitle', 'lSub', 'lFoot'].includes(id)) drawL();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'homeTag') addClan(e.target.value, $('#homeErr'), $('#homeGo')); if (e.key === 'Enter' && e.target.id === 'addTag') addClan(e.target.value, $('#addErr'), $('#addGo')); });

/* ---------- motion extras ---------- */
document.addEventListener('cancel', e => { if (e.target.tagName === 'DIALOG') { e.preventDefault(); closeDlg(e.target); } }, true);
function toggleFaq(d) {
  const ans = $('.ans', d); if (reduced) { d.open = !d.open; return; }
  if (d.open) { const h = ans.offsetHeight; ans.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 320, easing: EASE }).onfinish = () => { d.open = false; }; }
  else { d.open = true; const h = ans.scrollHeight; ans.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 400, easing: EASE }); }
}
let pRaf = 0;
window.addEventListener('pointermove', e => {
  if (!pRaf) pRaf = requestAnimationFrame(() => { pRaf = 0; const s = document.documentElement.style; s.setProperty('--mx', ((e.clientX / innerWidth - .5) * 2).toFixed(3)); s.setProperty('--my', ((e.clientY / innerHeight - .5) * 2).toFixed(3)); });
  const c = e.target.closest && e.target.closest('.mm,.cc'); if (!c) return;
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  c.style.setProperty('--rx', ((x - .5) * 9).toFixed(2)); c.style.setProperty('--ry', ((.5 - y) * 7).toFixed(2)); c.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); c.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
});
document.addEventListener('pointerout', e => { const c = e.target.closest && e.target.closest('.mm,.cc'); if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', 0); c.style.setProperty('--ry', 0); } });
window.addEventListener('resize', () => { moveInd($('#nav'), 'a.on'); if ($('.pp-tabs')) moveInd($('.pp-tabs'), 'button.on'); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveInd($('#nav'), 'a.on'));
reveal(document);

/* ---------- drag and drop ---------- */
document.addEventListener('dragstart', e => { const r = e.target.closest('.mc,.rr'); if (r) e.dataTransfer.setData('text/plain', r.dataset.tag + '|' + (r.classList.contains('rr') ? 'r' : 'l')); });
document.addEventListener('dragover', e => { if (e.target.closest('#lpanel,#rpanel')) e.preventDefault(); });
document.addEventListener('drop', e => {
  const data = e.dataTransfer.getData('text/plain'); if (!data.includes('|')) return; const [tag, from] = data.split('|');
  const row = e.target.closest('.rr');
  if (row && from === 'r') { e.preventDefault(); if (row.dataset.tag !== tag) reorderR(tag, row.dataset.tag, e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2); return; }
  if (e.target.closest('#rpanel') && from === 'l') { e.preventDefault(); addR(tag); }
  else if (e.target.closest('#lpanel') && from === 'r') { e.preventDefault(); rmR(tag); }
});

window.addEventListener('hashchange', go);
go(); loadAll(); setInterval(loadAll, 60000);
