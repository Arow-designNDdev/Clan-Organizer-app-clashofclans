/* Image renderers. To use your own design later, replace THEME and the two render functions.
   The app only calls renderRosterImage(canvas, data) and renderLeaderboardImage(canvas, data). */
'use strict';
const THEME = {
  bg1: '#241b0f', bg2: '#0c0804', gold: '#f0b646', gold2: '#ffe29a', goldDeep: '#a9741a', ink: '#f6efe0', dim: '#b3a589',
  serif: '"Playfair Display",Georgia,serif', body: '"Crimson Pro",Georgia,serif', num: '"Chakra Petch","Segoe UI",sans-serif',
  cond: '"Barlow Condensed","Arial Narrow",sans-serif', script: '"Lobster Two","Segoe Script",cursive'
};
const thColor = th => th >= 18 ? '#ff5d4a' : th >= 17 ? '#ff8a3d' : th >= 16 ? '#f0b646' : th >= 15 ? '#b57cf0' : th >= 14 ? '#5fb0e8' : th >= 13 ? '#62b985' : '#9aa5ab';
const _imgs = {};
const loadImg = src => _imgs[src] || (_imgs[src] = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(['800 20px "Playfair Display"', '700 20px "Playfair Display"', '600 20px "Crimson Pro"', '700 20px "Chakra Petch"', '700 20px "Barlow Condensed"', 'italic 700 20px "Lobster Two"']
    .map(f => document.fonts.load(f, 'Ag0').catch(() => 0)));
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function diamondPath(c, x, y, r) { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); }
function fitFont(c, text, mk, maxW, size, min = 12) { let s = size; c.font = mk(s); while (c.measureText(text).width > maxW && s > min) { s--; c.font = mk(s); } return text; }
function clipText(c, text, maxW) { if (c.measureText(text).width <= maxW) return text; while (text.length > 2 && c.measureText(text + '...').width > maxW) text = text.slice(0, -1); return text + '...'; }
function cover(c, img, W, H) { const r = Math.max(W / img.width, H / img.height), w = img.width * r, h = img.height * r; c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
function drawTH(c, th, img, cx, cy, size) {
  if (img) { const s = Math.min(size / img.width, size / img.height); c.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2, img.width * s, img.height * s); return; }
  c.save(); c.translate(cx, cy); const w = size * .8, h = size * .9; c.beginPath(); c.moveTo(0, -h / 2); c.lineTo(w / 2, -h * .38); c.lineTo(w / 2, h * .12); c.lineTo(0, h / 2); c.lineTo(-w / 2, h * .12); c.lineTo(-w / 2, -h * .38); c.closePath();
  c.fillStyle = thColor(th); c.fill(); c.strokeStyle = '#fff8'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = `700 ${size * .38}px ${THEME.num}`; c.fillText(th, 0, size * .13); c.restore();
}
function divider(c, x1, x2, y, color = 'rgba(240,182,70,.65)') {
  const m = (x1 + x2) / 2; c.strokeStyle = color; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x1, y); c.lineTo(m - 18, y); c.moveTo(m + 18, y); c.lineTo(x2, y); c.stroke();
  diamondPath(c, m, y, 7); c.fillStyle = THEME.gold; c.fill();
}

/* =================== ROSTER IMAGE =================== */
async function renderRosterImage(canvas, d) {
  await ensureFonts();
  const o = d.opts, P = d.players, W = 1200, M = 56, gap = 16, cols = o.cols, rowH = 96;
  const cw = (W - 2 * M - (cols - 1) * gap) / cols, rows = Math.max(1, Math.ceil(P.length / cols)), HEAD = 350, FOOT = 140;
  const H = HEAD + rows * (rowH + gap) + FOOT, S = 2;
  const [logo, ...icons] = await Promise.all([loadImg('assets/logo-crown.png'), ...P.flatMap(p => [loadImg(`assets/th/th${p.th}.png`), o.league && p.league ? loadImg(leagueUrl(p.league_name, p.league_icon, p.league)) : null])]);
  canvas.width = W * S; canvas.height = H * S;
  const c = canvas.getContext('2d'); c.setTransform(S, 0, 0, S, 0, 0);
  if (o.bgImg) { cover(c, o.bgImg, W, H); c.fillStyle = 'rgba(10,6,3,.72)'; c.fillRect(0, 0, W, H); }
  else {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, THEME.bg1); g.addColorStop(1, THEME.bg2); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,220,150,.03)'; c.lineWidth = 1; for (let i = -H; i < W; i += 26) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + H, H); c.stroke(); }
  }
  let rg = c.createRadialGradient(W / 2, 150, 10, W / 2, 150, 560); rg.addColorStop(0, 'rgba(240,182,70,.26)'); rg.addColorStop(1, 'rgba(240,182,70,0)'); c.fillStyle = rg; c.fillRect(0, 0, W, 700);
  rg = c.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .85); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.strokeStyle = THEME.gold; c.lineWidth = 3; rr(c, 18, 18, W - 36, H - 36, 22); c.stroke();
  c.strokeStyle = 'rgba(240,182,70,.3)'; c.lineWidth = 1; rr(c, 30, 30, W - 60, H - 60, 14); c.stroke();
  [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18]].forEach(p => { diamondPath(c, p[0], p[1], 10); c.fillStyle = THEME.gold; c.fill(); });
  if (logo) c.drawImage(logo, W / 2 - 55, 48, 110, 110 * logo.height / logo.width);
  c.textAlign = 'center'; const t = d.title || 'War roster'; fitFont(c, t, s => `800 ${s}px ${THEME.serif}`, W - 220, 64, 28);
  const tg = c.createLinearGradient(0, 170, 0, 235); tg.addColorStop(0, THEME.gold2); tg.addColorStop(.5, THEME.gold); tg.addColorStop(1, THEME.goldDeep);
  c.fillStyle = 'rgba(0,0,0,.6)'; c.fillText(t, W / 2 + 2, 232); c.fillStyle = tg; c.fillText(t, W / 2, 229);
  c.font = `600 28px ${THEME.body}`; c.fillStyle = THEME.ink; c.fillText(d.subtitle || '', W / 2, 272);
  divider(c, M + 60, W - M - 60, 296);
  const ths = {}; P.forEach(p => ths[p.th] = (ths[p.th] || 0) + 1);
  const chips = [{ t: `${P.length} / ${d.size} players`, col: THEME.ink }, { t: `Weight ${num(P.reduce((s, p) => s + p.weight, 0))}`, col: THEME.ink }]
    .concat(Object.keys(ths).sort((a, b) => b - a).slice(0, 6).map(k => ({ t: `TH${k} x${ths[k]}`, col: thColor(+k) })));
  let fs = 18; c.font = `600 ${fs}px ${THEME.body}`; let tw = chips.map(x => c.measureText(x.t).width + 30);
  while (tw.reduce((a, b) => a + b + 10, -10) > W - 2 * M - 20 && fs > 11) { fs--; c.font = `600 ${fs}px ${THEME.body}`; tw = chips.map(x => c.measureText(x.t).width + 30); }
  let cx = (W - tw.reduce((a, b) => a + b + 10, -10)) / 2;
  chips.forEach((x, i) => { c.fillStyle = 'rgba(0,0,0,.45)'; rr(c, cx, 312, tw[i], 34, 17); c.fill(); c.strokeStyle = 'rgba(240,182,70,.5)'; c.lineWidth = 1; c.stroke(); c.fillStyle = x.col; c.font = `600 ${fs}px ${THEME.body}`; c.fillText(x.t, cx + tw[i] / 2, 335); cx += tw[i] + 10; });

  P.forEach((p, i) => {
    const col = i % cols, row = Math.floor(i / cols), x = M + col * (cw + gap), y = HEAD + row * (rowH + gap), w = cw, bw = w - 60, cy = y + rowH / 2, bx = x;
    const g = c.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#1f160b'); g.addColorStop(1, '#050403');
    c.fillStyle = g; rr(c, bx, y, bw, rowH, 6); c.fill(); c.strokeStyle = 'rgba(240,182,70,.3)'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = thColor(p.th); c.fillRect(bx, y + 10, 4, rowH - 20);
    const r = rowH / 2 - 10, tx = bx + 18 + r; c.beginPath(); c.arc(tx, cy, r, 0, 7); c.fillStyle = '#0c0906'; c.fill(); c.strokeStyle = '#5a4725'; c.lineWidth = 2; c.stroke();
    drawTH(c, p.th, icons[i * 2], tx, cy, r * 1.55);
    // right side blocks
    let rx = bx + bw - 66;
    for (let k = 0; k < 3; k++) { const px = rx + k * 13; c.beginPath(); c.moveTo(px + 8, cy - 9); c.lineTo(px, cy); c.lineTo(px + 8, cy + 9); c.strokeStyle = THEME.gold; c.lineWidth = 3.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
    let reserve = 100;
    if (o.scores) { const vx = rx - 52; c.textAlign = 'center'; c.fillStyle = THEME.gold; c.font = `700 ${cols === 1 ? 32 : 28}px ${THEME.num}`; c.fillText(Math.round(p.total), vx, cy + 8); c.fillStyle = THEME.dim; c.font = `600 12px ${THEME.body}`; c.fillText('TOTAL', vx, cy + 26); rx = vx - 40; reserve += 92; }
    const lg = icons[i * 2 + 1]; if (lg) { const s = 46; c.drawImage(lg, rx - s + 4, cy - s / 2, s, s); reserve += 52; }
    const textX = tx + r + 18, maxW = bw - (textX - bx) - reserve;
    c.textAlign = 'left'; c.fillStyle = '#fff'; const nm = clipText(c, p.name, maxW); fitFont(c, p.name, s => `700 ${s}px ${THEME.serif}`, maxW, 27, 16); c.fillText(clipText(c, p.name, maxW), textX, cy - 8);
    c.font = `500 16px ${THEME.body}`; c.fillStyle = THEME.dim; c.fillText(clipText(c, [roleName(p.role), 'TH' + p.th].concat(o.tags ? [p.tag] : []).join('  |  '), maxW), textX, cy + 13);
    if (o.scores) { let sx = textX; [['A', p.activity], ['I', p.impact], ['P', p.prestige]].forEach(s => { const txt = `${s[0]} ${s[1] == null ? '-' : Math.round(s[1])}`; c.font = `700 14px ${THEME.num}`; const wdt = c.measureText(txt).width + 14; if (sx + wdt - textX > maxW) return; c.fillStyle = 'rgba(240,182,70,.12)'; rr(c, sx, cy + 21, wdt, 20, 10); c.fill(); c.fillStyle = THEME.gold; c.fillText(txt, sx + 7, cy + 36); sx += wdt + 6; }); }
    // diamond + dots
    const dx = bx + bw; diamondPath(c, dx, cy, 33); const dg = c.createLinearGradient(dx - 33, cy - 33, dx + 33, cy + 33); dg.addColorStop(0, THEME.gold2); dg.addColorStop(.6, '#e0a23a'); dg.addColorStop(1, '#b9801f'); c.fillStyle = dg; c.fill();
    c.fillStyle = '#1d1407'; c.textAlign = 'center'; c.font = `700 24px ${THEME.num}`; c.fillText(String(i + 1).padStart(2, '0'), dx, cy + 8);
    c.fillStyle = '#6b5a3a'; for (let q = dx + 42; q < x + w; q += 7) { c.beginPath(); c.arc(q, cy, 1.6, 0, 7); c.fill(); }
  });
  const fy = H - 92; divider(c, M + 60, W - M - 60, fy);
  c.textAlign = 'center'; c.font = `600 20px ${THEME.body}`; c.fillStyle = THEME.dim; c.fillText(d.footer || '', W / 2, fy + 38);
}

/* =================== LEADERBOARD IMAGE =================== */
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixc = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v * (1 - t) + B[i] * t)).join(',')})`; };
const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;
async function renderLeaderboardImage(canvas, d) {
  await ensureFonts();
  const acc = d.accent || '#f0b646', light = mixc(acc, '#ffffff', .55), R = d.rows, o = d.opts, W = 1200, M = 70, RH = 70, S = 2;
  const H = 520 + R.length * RH + 170;
  const [logo, ...imgs] = await Promise.all([loadImg('assets/logo-crown.png'), ...R.flatMap(r => [o.th ? loadImg(`assets/th/th${r.th}.png`) : null, o.league && r.league ? loadImg(leagueUrl(r.league_name, r.league_icon, r.league)) : null])]);
  canvas.width = W * S; canvas.height = H * S; const c = canvas.getContext('2d'); c.setTransform(S, 0, 0, S, 0, 0);
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, mixc(acc, '#030303', .9)); g.addColorStop(.5, mixc(acc, '#060606', .8)); g.addColorStop(1, mixc(acc, '#030303', .92)); c.fillStyle = g; c.fillRect(0, 0, W, H);
  [[160, 120, 520], [1050, 620, 560], [420, H - 260, 600], [980, 120, 360]].forEach(([x, y, r]) => { const q = c.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, rgba(acc, .22)); q.addColorStop(1, rgba(acc, 0)); c.fillStyle = q; c.fillRect(0, 0, W, H); });
  c.save(); c.globalAlpha = .07; c.fillStyle = acc; [[-100, 380, 700, 90, -.35], [500, 800, 900, 120, -.3], [200, H - 420, 800, 70, -.4], [650, 160, 600, 60, -.3]].forEach(([x, y, w, h, a]) => { c.save(); c.translate(x, y); c.rotate(a); c.fillRect(0, 0, w, h); c.restore(); }); c.restore();
  // top bar
  if (logo) c.drawImage(logo, M, 52, 54, 54 * logo.height / logo.width);
  c.textAlign = 'left'; c.fillStyle = light; c.font = `700 24px ${THEME.cond}`; if ('letterSpacing' in c) c.letterSpacing = '4px'; c.fillText('CLAN ORGANIZER', M + 68, 88);
  c.textAlign = 'right'; c.fillText((d.date || '').toUpperCase(), W - M, 88); if ('letterSpacing' in c) c.letterSpacing = '0px';
  c.strokeStyle = rgba(acc, .5); c.lineWidth = 1.5; c.strokeRect(W - M - 150, 62, 150, 38);
  // title band
  const by = 200, bh = 150, bx = 120, bw = W - 240;
  c.fillStyle = 'rgba(0,0,0,.58)'; c.fillRect(bx, by, bw, bh);
  c.fillStyle = acc; [[bx - 14, by - 14], [bx - 14, by + bh - 2], [bx + bw - 2, by - 14], [bx + bw - 2, by + bh - 2]].forEach(([x, y]) => c.fillRect(x, y, 16, 16));
  c.fillRect(bx - 7, by - 4, 2, bh + 8); c.fillRect(bx + bw + 5, by - 4, 2, bh + 8);
  c.textAlign = 'center'; const title = (d.title || 'Leaderboard').toUpperCase(); fitFont(c, title, s => `700 ${s}px ${THEME.cond}`, bw - 80, 132, 40);
  const tg = c.createLinearGradient(0, by, 0, by + bh); tg.addColorStop(0, light); tg.addColorStop(1, acc); c.fillStyle = tg; c.fillText(title, W / 2, by + bh - 36);
  c.save(); c.translate(W / 2, by + 12); c.rotate(-.045); c.font = `italic 700 66px ${THEME.script}`; c.fillStyle = 'rgba(0,0,0,.55)'; c.fillText(d.script || '', 3, 3); c.fillStyle = mixc(acc, '#ffffff', .25); c.fillText(d.script || '', 0, 0); c.restore();
  // table header
  const hy = 430, colX = [M + 55]; const pX = M + 130, mx0 = W - M - Math.max(1, d.cols.length) * 170, cw2 = (W - M - mx0) / Math.max(1, d.cols.length);
  c.font = `700 28px ${THEME.cond}`; c.fillStyle = light; if ('letterSpacing' in c) c.letterSpacing = '3px';
  c.textAlign = 'center'; c.fillText('PLACE', colX[0], hy); c.textAlign = 'left'; c.fillText('PLAYER', pX, hy);
  c.textAlign = 'center'; d.cols.forEach((cl, i) => c.fillText(cl.toUpperCase(), mx0 + cw2 * (i + .5), hy)); if ('letterSpacing' in c) c.letterSpacing = '0px';
  const ln = c.createLinearGradient(M, 0, W - M, 0); ln.addColorStop(0, rgba(acc, .9)); ln.addColorStop(1, rgba(acc, .15)); c.fillStyle = ln; c.fillRect(M, hy + 20, W - 2 * M, 2);
  // rows
  R.forEach((r, i) => {
    const y = 470 + i * RH, cy = y + RH / 2;
    if (i % 2 === 0) { c.fillStyle = 'rgba(255,255,255,.04)'; c.fillRect(M, y, W - 2 * M, RH); }
    if (i < 3) { const q = c.createLinearGradient(M, 0, W - M, 0); q.addColorStop(0, rgba(acc, .2)); q.addColorStop(1, rgba(acc, 0)); c.fillStyle = q; c.fillRect(M, y, W - 2 * M, RH); }
    c.textAlign = 'center'; c.font = `700 40px ${THEME.cond}`; c.fillStyle = i < 3 ? light : '#fff'; c.fillText(String(i + 1), colX[0], cy + 14);
    let px = pX; const th = imgs[i * 2]; if (o.th) { drawTH(c, r.th, th, px + 24, cy, 52); px += 62; }
    c.textAlign = 'left'; c.fillStyle = '#fff'; const maxN = mx0 - px - (o.league ? 70 : 20); c.font = `700 34px ${THEME.cond}`; fitFont(c, r.name, s => `700 ${s}px ${THEME.cond}`, maxN, 34, 20); const nm = clipText(c, r.name, maxN); c.fillText(nm, px, cy + 11);
    const lg = imgs[i * 2 + 1]; if (lg) { const wdt = c.measureText(nm).width; c.drawImage(lg, px + wdt + 12, cy - 22, 44, 44); }
    c.textAlign = 'center'; c.font = `700 34px ${THEME.cond}`; c.fillStyle = '#fff'; r.cells.forEach((v, k) => c.fillText(v, mx0 + cw2 * (k + .5), cy + 11));
  });
  const fy = 470 + R.length * RH + 36; c.fillStyle = ln; c.fillRect(M, fy, W - 2 * M, 1.5);
  c.textAlign = 'left'; c.fillStyle = light; c.font = `600 26px ${THEME.cond}`; if ('letterSpacing' in c) c.letterSpacing = '2px'; c.fillText((d.clanLine || '').toUpperCase(), M, fy + 50);
  c.textAlign = 'center'; c.fillStyle = rgba('#ffffff', .7); c.fillText((d.footer || '').toUpperCase(), W / 2, fy + 100); if ('letterSpacing' in c) c.letterSpacing = '0px';
  if (logo) { c.textAlign = 'right'; c.font = `700 34px ${THEME.script}`; c.fillStyle = '#fff'; c.fillText('Clan Organizer', W - M, fy + 58); const tw = c.measureText('Clan Organizer').width; c.drawImage(logo, W - M - tw - 56, fy + 22, 44, 44 * logo.height / logo.width); }
}
