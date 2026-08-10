// menu.js — micro's menu kit (auditable/tools/micro), ported: one primitive
// serves the menubar dropdowns AND every context menu. Items:
//   { label, action }            — click runs it, menu closes
//   { label, kbd }               — right-aligned shortcut hint
//   { label, submenu: [...]|fn } — hover-opened nested menu, edge-flipped
//   { sep: true }                — separator
//   { label, checked }           — leading ✓ (state rows)
// menuXY(x, y, items) at a point (context menus); menuAt(anchorEl, items)
// under an element (menubar). Dismiss on outside pointerdown or Escape.

let chain = [];                                 // root → open submenu → …
let docListener = null;

export function closeMenu() {
  for (const m of chain) m.remove();
  chain = [];
  if (docListener) { removeEventListener('pointerdown', docListener); docListener = null; }
}

function buildMenu(items) {
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); continue; }
    const d = document.createElement('div');
    d.className = 'item' + (it.disabled ? ' disabled' : '');
    d._item = it;
    const lab = document.createElement('span');
    lab.textContent = (it.checked ? '✓ ' : '') + it.label;
    d.appendChild(lab);
    if (it.submenu) { const c = document.createElement('span'); c.className = 'kbd'; c.textContent = '▸'; d.appendChild(c); }
    else if (it.kbd) { const kb = document.createElement('span'); kb.className = 'kbd'; kb.textContent = it.kbd; d.appendChild(kb); }
    m.appendChild(d);
  }
  return m;
}

function placeMenu(m, x, y) {
  document.body.appendChild(m);
  m.style.zIndex = 100 + chain.length;
  const mw = m.offsetWidth || 180, mh = m.offsetHeight || 40;
  m.style.left = Math.max(2, Math.min(x, innerWidth - mw - 4)) + 'px';
  m.style.top = Math.max(2, Math.min(y, innerHeight - mh - 4)) + 'px';
}

function closeDeeperThan(level) { while (chain.length > level + 1) chain.pop().remove(); }

function wireMenu(m, level) {
  m.querySelectorAll('.item').forEach((d) => {
    const it = d._item;
    d.addEventListener('mouseenter', () => {
      if (chain[level + 1] && chain[level + 1]._forItem === d) return;
      closeDeeperThan(level);                   // hovering a sibling closes the old submenu
      if (!it || !it.submenu) return;
      const items = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
      if (!items || !items.length) return;
      const sub = buildMenu(items);
      sub._forItem = d;
      const r = d.getBoundingClientRect();
      chain.push(sub);
      placeMenu(sub, r.right - 3, r.top - 5);
      const sw = sub.offsetWidth || 180;
      if (r.right - 3 + sw > innerWidth - 4) sub.style.left = Math.max(2, r.left - sw + 3) + 'px';
      wireMenu(sub, level + 1);
    });
    d.addEventListener('click', (e) => {
      if (it && it.disabled) { e.stopPropagation(); return; }
      if (it && it.submenu && !it.action) { e.stopPropagation(); d.dispatchEvent(new Event('mouseenter')); return; }
      closeMenu();
      if (it && it.action) it.action();
    });
  });
}

export function menuXY(x, y, items, onCancel) {
  closeMenu();
  const m = buildMenu(items);
  chain.push(m);
  placeMenu(m, x, y);
  wireMenu(m, 0);
  setTimeout(() => {
    if (chain[0] !== m) return;
    docListener = (e) => {
      if (!chain.some((mm) => mm.contains(e.target))) { closeMenu(); if (onCancel) onCancel(); }
    };
    addEventListener('pointerdown', docListener);
  }, 0);
}

export function menuAt(anchor, items) {
  const r = anchor.getBoundingClientRect();
  menuXY(r.left, r.bottom + 2, items);
}

addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
