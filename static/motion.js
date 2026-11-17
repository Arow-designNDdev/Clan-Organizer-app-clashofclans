/* Motion helpers: page transitions, staggers, FLIP moves, count-ups, scroll reveals, animated dialogs. */
'use strict';
const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EASE = 'cubic-bezier(.2,.8,.2,1)';

function stagger(root, sel, cap = 12) { $$(sel, root).forEach((n, i) => n.style.setProperty('--i', Math.min(i, cap))); }
function playIn(el, ms = 1800) { if (!el) return; el.classList.add('anim'); clearTimeout(el._pt); el._pt = setTimeout(() => el.classList.remove('anim'), ms); }

function countUp(root = document) {
  $$('.cu', root).forEach(el => {
    const to = parseFloat(el.dataset.to); if (isNaN(to)) return;
    const dec = +(el.dataset.dec || 0), fmt = v => v.toLocaleString('en', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 850 + Math.min(700, Math.log10(Math.abs(to) + 1) * 120);
    el.textContent = fmt(0);
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to); };
    requestAnimationFrame(step);
  });
}
function animateBars(root = document) {
  $$('[data-w]', root).forEach(el => { const w = el.dataset.w; el.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = w + '%'; })); });
  $$('.ring .v', root).forEach(c => { const v = Math.max(0, Math.min(100, +c.dataset.v || 0)); c.style.strokeDashoffset = 264; requestAnimationFrame(() => requestAnimationFrame(() => { c.style.strokeDashoffset = 264 * (1 - v / 100); })); });
}

/* FLIP: remember positions, re-render, then glide every item from its old spot to its new one */
const rectKey = el => el.dataset.tag + '|' + (el.closest('#right') ? 'r' : 'l');
function snap(sel) { const m = new Map(); $$(sel).forEach(el => m.set(rectKey(el), el.getBoundingClientRect())); return m; }
function flip(before, sel) {
  if (reduced || !before.size) return;
  $$(sel).forEach(el => {
    const a = before.get(rectKey(el));
    if (a) {
      const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 480, easing: EASE });
    } else if (el.classList.contains('rr')) el.classList.add('pop');
  });
}

let _io;
function reveal(root = document) {
  const els = $$('.rv:not(.vis)', root);
  if (!('IntersectionObserver' in window) || reduced) { els.forEach(e => e.classList.add('vis')); return; }
  _io = _io || new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); _io.unobserve(e.target); } }), { threshold: .12 });
  els.forEach(e => _io.observe(e));
}

/* Dialogs animate in and out instead of popping */
function openDlg(d) { d.classList.remove('closing'); if (!d.open) d.showModal(); }
function closeDlg(d) {
  if (!d.open || d.classList.contains('closing')) return;
  if (reduced) { d.close(); return; }
  d.classList.add('closing');
  d.addEventListener('animationend', function f(e) { if (e.target !== d) return; d.removeEventListener('animationend', f); d.close(); d.classList.remove('closing'); });
}
function moveInd(nav, activeSel, cls = 'ind') {
  const a = $(activeSel, nav); if (!a) return; let ind = $('.' + cls, nav);
  if (!ind) { ind = document.createElement('span'); ind.className = cls; nav.prepend(ind); }
  ind.style.width = a.offsetWidth + 'px'; ind.style.left = a.offsetLeft + 'px';
}
