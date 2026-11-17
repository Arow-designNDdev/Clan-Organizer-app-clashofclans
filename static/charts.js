/* Small chart toolkit: every function returns an SVG string. Animations live in status.css. */
'use strict';
const CC = { gold: '#f0b646', green: '#46c46b', red: '#e5544d', blue: '#6aa7d8', purple: '#b98cff', teal: '#7fd1c0', dim: '#a79b82', grid: '#ffffff14' };
const nice = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v * 10) / 10);
const shortDate = d => { const p = String(d).split('-'); return p.length === 3 ? `${+p[2]}/${+p[1]}` : d; };

function chLine(pts, o = {}) {
  const W = o.w || 560, H = o.h || 210, L = 40, R = 14, T = 14, B = 28, col = o.color || CC.gold;
  if (!pts || pts.length < 2) return `<div class="empty small">${pts && pts.length === 1 ? 'Only one data point so far. The line appears as the app keeps syncing.' : 'No data yet.'}</div>`;
  const vals = pts.map(p => p.v); let lo = o.min ?? Math.min(...vals), hi = o.max ?? Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * .12; if (o.min == null) lo -= pad; if (o.max == null) hi += pad;
  const x = i => L + (W - L - R) * i / (pts.length - 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const grid = [0, .5, 1].map(f => { const v = lo + (hi - lo) * f, yy = y(v); return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${CC.grid}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="ax">${nice(v)}</text>`; }).join('');
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const dots = pts.map((p, i) => `<circle class="pt" style="--i:${i}" cx="${x(i)}" cy="${y(p.v)}" r="${pts.length > 40 ? 2 : 3.5}" fill="${p.c || col}"><title>${p.d}: ${p.v}</title></circle>`).join('');
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>${grid}
    <path class="ar" d="${d} L${x(pts.length - 1)} ${H - B} L${x(0)} ${H - B} Z" fill="url(#${gid})"/><path class="ln" pathLength="1" d="${d}" stroke="${col}"/>${dots}
    <text x="${L}" y="${H - 8}" class="ax">${shortDate(pts[0].d)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" class="ax">${shortDate(pts[pts.length - 1].d)}</text></svg>`;
}

function chBars(items, o = {}) {
  const W = o.w || 420, H = o.h || 200, L = 8, B = 34, T = 22; if (!items.length) return '<div class="empty small">No data yet.</div>';
  const hi = Math.max(1, ...items.map(i => i.value)), bw = (W - L * 2) / items.length;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img">${items.map((it, i) => {
    const h = (H - T - B) * it.value / hi, bx = L + i * bw + bw * .14, w = bw * .72;
    return `<g><rect class="bar" style="--i:${i}" x="${bx}" y="${H - B - h}" width="${w}" height="${Math.max(2, h)}" rx="5" fill="${it.color || CC.gold}"><title>${it.label}: ${it.value}${o.unit || ''}</title></rect>
      <text x="${bx + w / 2}" y="${H - B - h - 6}" text-anchor="middle" class="vl">${nice(it.value)}${o.unit || ''}</text><text x="${bx + w / 2}" y="${H - 12}" text-anchor="middle" class="ax">${it.label}</text></g>`;
  }).join('')}</svg>`;
}

function chGroup(labels, A, B, names, o = {}) {
  const W = o.w || 460, H = o.h || 200, L = 8, Bm = 34, T = 22, n = labels.length; if (!n) return '<div class="empty small">No data yet.</div>';
  const hi = Math.max(1, ...A, ...B), bw = (W - L * 2) / n;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img">${labels.map((lb, i) => [[A[i], CC.gold, 0], [B[i], CC.red, 1]].map(([v, c, k]) => {
    const h = (H - T - Bm) * v / hi, w = bw * .34, bx = L + i * bw + bw * .12 + k * (w + 3);
    return `<rect class="bar" style="--i:${i * 2 + k}" x="${bx}" y="${H - Bm - h}" width="${w}" height="${Math.max(v ? 2 : 0, h)}" rx="4" fill="${c}"><title>${names[k]} TH${lb}: ${v}</title></rect>${v ? `<text x="${bx + w / 2}" y="${H - Bm - h - 5}" text-anchor="middle" class="vl">${v}</text>` : ''}`;
  }).join('') + `<text x="${L + i * bw + bw / 2}" y="${H - 12}" text-anchor="middle" class="ax">${lb}</text>`).join('')}
    <g class="lg"><rect x="${W - 150}" y="4" width="10" height="10" rx="2" fill="${CC.gold}"/><text x="${W - 136}" y="13" class="ax">${esc(names[0])}</text><rect x="${W - 76}" y="4" width="10" height="10" rx="2" fill="${CC.red}"/><text x="${W - 62}" y="13" class="ax">${esc(names[1])}</text></g></svg>`;
}

function chDonut(parts, o = {}) {
  const S = o.size || 190, r = 38, tot = parts.reduce((a, p) => a + p.value, 0) || 1; let acc = 0;
  const segs = parts.filter(p => p.value > 0).map((p, i) => { const v = 100 * p.value / tot, seg = `<circle class="seg" style="--i:${i};stroke-dasharray:${v} ${100 - v};stroke-dashoffset:${-acc}" cx="50" cy="50" r="${r}" pathLength="100" stroke="${p.color}"><title>${p.label}: ${p.value}</title></circle>`; acc += v; return seg; }).join('');
  return `<div class="donut"><svg class="ch" viewBox="0 0 100 100" width="${S}" height="${S}" role="img"><circle cx="50" cy="50" r="${r}" fill="none" stroke="${CC.grid}" stroke-width="11"/><g transform="rotate(-90 50 50)">${segs}</g>
    <text x="50" y="49" text-anchor="middle" class="dc">${o.center ?? tot}</text><text x="50" y="61" text-anchor="middle" class="ds">${o.sub || ''}</text></svg>
    <ul class="leg">${parts.map(p => `<li><i style="background:${p.color}"></i>${p.label} <b>${p.value}</b></li>`).join('')}</ul></div>`;
}

function chRadar(labels, series, o = {}) {
  const S = o.size || 300, c = S / 2, R = c - 52, n = labels.length, ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, v) => [c + R * v / 100 * Math.cos(ang(i)), c + R * v / 100 * Math.sin(ang(i))];
  const ring = f => labels.map((_, i) => pt(i, 100 * f).map(v => v.toFixed(1)).join(',')).join(' ');
  const axes = labels.map((l, i) => { const [x, y] = pt(i, 100), [tx, ty] = pt(i, 122); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${CC.grid}"/><text x="${tx}" y="${ty + 4}" text-anchor="middle" class="ax">${l}</text>`; }).join('');
  const polys = series.map((s, k) => `<polygon class="rad" style="transform-origin:${c}px ${c}px;--i:${k}" points="${s.vals.map((v, i) => pt(i, v || 0).map(q => q.toFixed(1)).join(',')).join(' ')}" fill="${s.color}33" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round"><title>${s.name}: ${s.vals.join(', ')}</title></polygon>`).join('');
  return `<div class="radarw"><svg class="ch" viewBox="0 0 ${S} ${S}" role="img">${[.25, .5, .75, 1].map(f => `<polygon points="${ring(f)}" fill="none" stroke="${CC.grid}"/>`).join('')}${axes}${polys}</svg>
    <ul class="leg row">${series.map(s => `<li><i style="background:${s.color}"></i>${s.name}</li>`).join('')}</ul></div>`;
}

function chGauge(v, o = {}) {
  const W = 220, H = 130, r = 86, cx = W / 2, cy = 112, col = v >= 66 ? CC.red : v >= 40 ? CC.gold : CC.green, arc = `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return `<svg class="ch gauge" viewBox="0 0 ${W} ${H}" role="img"><path d="${arc}" fill="none" stroke="${CC.grid}" stroke-width="16" stroke-linecap="round"/>
    <path class="gv" pathLength="100" d="${arc}" fill="none" stroke="${col}" stroke-width="16" stroke-linecap="round" style="stroke-dasharray:${v} 100"/>
    <text x="${cx}" y="${cy - 20}" text-anchor="middle" class="gn">${v}</text><text x="${cx}" y="${cy + 2}" text-anchor="middle" class="gs">${o.label || ''}</text></svg>`;
}

const chDots = results => `<div class="wdots">${results.map((r, i) => `<span class="wd ${r.result || 'n'}" style="--i:${i}" title="${esc(r.title || '')}">${{ win: 'W', lose: 'L', tie: 'T' }[r.result] || '·'}</span>`).join('')}</div>`;
