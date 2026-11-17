'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n).toLocaleString('en');
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };

const S = {
  clan: localStorage.getItem('clan') || '', clans: [], configured: true, members: [], boards: [], hd: 0, days: 14, st: {},
  roster: [], size: 15, rsort: 'weight', lsort: 'weight', q: '', on: { activity: true, impact: true, prestige: true }, loaded: false
};
/* Writes (add clan, remove clan, set join date) can be password protected when the app is hosted. */
async function authFetch(url, opts = {}) {
  const send = pw => fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'X-Admin': pw || '' } });
  let r = await send(localStorage.getItem('adminpw'));
  if (r.status === 401) {
    const pw = window.prompt('This site is protected. Enter the password to make changes:');
    if (pw == null) return r;
    r = await send(pw); if (r.status !== 401) localStorage.setItem('adminpw', pw); else toast('Wrong password.');
  }
  return r;
}
const cu = p => p + (p.includes('?') ? '&' : '?') + 'clan=' + encodeURIComponent(S.clan);
const store = (k, v) => localStorage.setItem(k + ':' + S.clan, JSON.stringify(v));
const recall = (k, d) => { try { return JSON.parse(localStorage.getItem(k + ':' + S.clan)) ?? d; } catch { return d; } };
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------- metrics ---------- */
const SCORE_KEYS = ['total', 'activity', 'impact', 'prestige'];
const METRICS = {
  total: ['Total value', 'TOTAL'], activity: ['Activity score', 'ACTIVITY'], impact: ['Impact', 'IMPACT'], prestige: ['Prestige', 'PRESTIGE'],
  weight: ['War weight', 'WEIGHT'], trophies: ['Trophies', 'TROPHIES'], don_delta: ['Donations', 'DONATED'], upg_delta: ['Upgrades', 'UPGRADES'],
  threes: ['3-stars', '3-STARS'], missed: ['Missed attacks', 'MISSED'], capital_delta: ['Capital gold given', 'GIVEN'], raid_month: ['Raided this month', 'RAIDED'], games_delta: ['Clan games points', 'GAMES']
};
const fmtM = (k, m) => { const v = m[k]; if (v == null) return '-'; return SCORE_KEYS.includes(k) ? String(Math.round(v)) : num(v); };

function mix(m) { const k = Object.keys(S.on).filter(x => S.on[x]); return k.length ? k.reduce((s, x) => s + (m[x] ?? 0), 0) / k.length : 0; }
const nl = k => (a, b) => (b[k] ?? -1) - (a[k] ?? -1);
const SORTS = {
  weight: (a, b) => b.weight - a.weight || b.th - a.th, total: nl('total'), th: (a, b) => b.th - a.th || b.weight - a.weight,
  trophies: nl('trophies'), activity: nl('activity'), impact: nl('impact'), prestige: nl('prestige'), mix: (a, b) => mix(b) - mix(a) || b.weight - a.weight,
  hero: nl('hero_total'), donations: nl('donations'), war_stars: nl('war_stars'), name: (a, b) => a.name.localeCompare(b.name)
};
const SORT_LABEL = {
  weight: 'War weight (town hall included)', total: 'Total value', mix: 'Score mix (use toggles)', th: 'Town hall, then weight', trophies: 'Trophies',
  activity: 'Activity score', impact: 'Impact', prestige: 'Prestige', hero: 'Hero levels', donations: 'Donations this season', war_stars: 'Lifetime war stars', name: 'Name'
};
const sortOpts = (sel, extra = '') => Object.keys(SORT_LABEL).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${SORT_LABEL[k]}</option>`).join('') + extra;

/* ---------- icons ---------- */
const thBadge = th => `<span class="thbadge" title="TH${th}">${th}</span>`;
const thImg = (th, cls = '') => `<img class="th ${cls}" src="assets/th/th${th}.png" alt="TH${th}" loading="lazy" onerror="this.outerHTML=thBadge(${th})">`;
const leagueUrl = (name, u, tier) => `/league-icon?name=${encodeURIComponent(name || '')}&tier=${tier || 0}&u=${encodeURIComponent(u || '')}`;
const leagueImg = (m, cls = '') => m.league ? `<img class="lg ${cls}" src="${leagueUrl(m.league_name, m.league_icon, m.league)}" title="${esc(m.league_name)}" alt="" loading="lazy" onerror="this.remove()">` : '';
const roleName = r => ({ leader: 'Leader', coLeader: 'Co-leader', admin: 'Elder', member: 'Member' }[r] || r);
const IC = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 16l1-4 7-7 3 3-7 7z"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V5M4 20h16M8 15l3-4 3 2 5-6"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-4 3-6 6.5-6s6.5 2 6.5 6M16 5a3.5 3.5 0 010 7M18 14c2.5.6 3.5 2.6 3.5 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M20 4H4a1 1 0 00-1 1v11a1 1 0 001 1h4l4 4 4-4h4a1 1 0 001-1V5a1 1 0 00-1-1z"/><path d="M8 9h8M8 12.5h5"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 21h8M10 18h4"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5h4.5a1.8 1.8 0 010 3.5H9.5a1.8 1.8 0 000 3.5H15"/></svg>',
  filter: '<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>', left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  shield: '<svg viewBox="0 0 64 70"><path d="M32 3l26 8v22c0 17-11 28-26 34C17 61 6 50 6 33V11z" fill="#2a2113" stroke="#f0b646" stroke-width="3.5" stroke-linejoin="round"/><path d="M19 35l9 9 18-20" fill="none" stroke="#f0b646" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5zM12 15v3"/></svg>',
  cwl: '<svg viewBox="0 0 24 24"><path d="M4 20L16 8M20 20L8 8M14 4h6v6M4 4h6v6"/></svg>',
  hist: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2"/></svg>',
  swipe: '<svg viewBox="0 0 30 20"><path d="M3 4l7 6-7 6M14 4l7 6-7 6"/></svg>'
};
const CHEV = '<svg class="chev" viewBox="0 0 44 22"><g fill="none" stroke="#e8b44c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L3 11l7 8"/><path d="M23 3l-7 8 7 8"/><path d="M36 3l-7 8 7 8"/></g></svg>';

/* ---------- CWL banner ---------- */
function cwlBanner() {
  const d = new Date(); let m = d.getMonth(), y = d.getFullYear();
  if (d.getDate() >= 12) { m++; if (m > 11) { m = 0; y++; } }
  const name = new Date(y, m, 1).toLocaleString('en', { month: 'long' }).toUpperCase();
  const key = `${y}-${String(m + 1).padStart(2, '0')}`, c = S.st.cwl;
  if (c && c.season === key) return c.state === 'ended' ? `${name} CWL COMPLETE` : `${name} CWL, ROUND ${Math.max(1, c.round || 1)} OF 7`;
  return `${name} CWL LOADING.....`;
}
const byTag = () => Object.fromEntries(S.members.map(m => [m.tag, m]));
