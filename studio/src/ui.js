// ui.js — the studio chrome, on micro's grammar: commands live in MENUS
// (menubar dropdowns + context menus, one kit — menu.js), knobs live in the
// permanent panes. Left pane: the tree — layers (groups of items, with
// collapse carets and group eyes) and items (each with ITS OWN eye; effective
// visibility = both, micro's "children keep their own eyes"). Right pane:
// the inspector. Visibility is document state: hidden here is hidden on the
// phone. dblclick / F2 rename, Delete deletes, h toggles the selected eye,
// right-click anywhere for the object's menu.

import { Menu, MenuBar } from '../../vendor/gcu-menu/index.js';
import { effectiveHidden } from './store.js';

// actions are CLOSURES: Menu.show resolves the item's action value, we run it
async function popup(items, x, y) {
  const a = await Menu.show(items, { x, y });
  if (typeof a === 'function') a();
}

const mm = (v) => Math.round(v * 1000);
const fromMm = (v) => (Number(v) || 0) / 1000;
const deg = (v) => Math.round((v * 180 / Math.PI) * 10) / 10;
const fromDeg = (v) => (Number(v) || 0) * Math.PI / 180;

export function initUI(store, view, els) {
  const state = { activeLayer: null, collapsed: new Set() };

  const layers = () => store.byKind('layer');
  const itemsOf = (lid) => store.all().filter((o) => o.kind !== 'layer' && o.layer === lid);
  const activeLayer = () => layers().find((l) => l.id === state.activeLayer) || layers()[0] || null;
  const ensureDefaultLayer = () => {
    if (!layers().length) store.upsert({ id: store.newId(), kind: 'layer', name: 'layer 1' });
  };

  // ── actions ─────────────────────────────────────────────────────────────
  function addObject(kind, props = {}, name, at) {
    ensureDefaultLayer();
    const obj = store.upsert({
      id: store.newId(), kind, name: name || kind, layer: activeLayer().id,
      t: at ? [at[0], at[1], 0] : [0, 0, 0], props,
    });
    view.select(obj.id);
    return obj;
  }

  function pickFile(accept, fn) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => inp.files[0] && fn(inp.files[0]);
    inp.click();
  }

  const addMesh = (at) => pickFile('.stl', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await store.saveBlob(bytes);
    addObject('mesh', { blob: hash, fmt: 'stl', unit: 'mm' }, file.name.replace(/\.stl$/i, ''), at);
  });

  const addImage = (at) => pickFile('image/*', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await store.saveBlob(bytes);
    const img = new Image();
    img.onload = () => {
      const w = 0.1;
      addObject('image', { blob: hash, w, d: w * img.naturalHeight / img.naturalWidth },
        file.name.replace(/\.[^.]+$/, ''), at);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(new Blob([bytes]));
  });

  const addBlocks = (at) => pickFile('.csv,.txt,.dm', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dm = /\.dm$/i.test(file.name);
    const { discoverBlockModel } = await import('./blocks.js');
    let d;
    try { d = await discoverBlockModel(bytes, { dm }); }
    catch (e) { alert('block model: ' + e.message); return; }
    if (!d.gridded) { alert('no regular grid detected — sub-blocked / irregular models are not supported yet'); return; }
    const hash = await store.saveBlob(bytes);
    addObject('blocks', {
      blob: hash, dm, chan: d.chan, cols: d.cols, dims: d.dims, count: d.count,
      ramp: 'viridis', cutoff: 0, edges: true, footprint: 0.12,
    }, file.name.replace(/\.[^.]+$/, ''), at);
  });

  const addItems = (at) => [
    { label: 'axes', action: () => addObject('axes', { size: 0.05 }, null, at) },
    { label: 'box', action: () => addObject('box', { w: 0.04, d: 0.04, h: 0.04, solid: true }, null, at) },
    { label: 'label', action: () => addObject('label', { text: 'label', size: 0.02 }, null, at) },
    '---',
    { label: 'mesh (stl)…', action: () => addMesh(at) },
    { label: 'image…', action: () => addImage(at) },
    { label: 'blocks (csv/dm)…', action: () => addBlocks(at) },
  ];

  async function rename(obj) {
    const v = prompt('name', obj.name || '');
    if (v != null && v.trim()) store.upsert({ id: obj.id, name: v.trim() });
  }
  function toggleHidden(obj) { store.upsert({ id: obj.id, hidden: !obj.hidden }); }
  function duplicate(obj) {
    const copy = store.upsert({ ...structuredClone({ ...obj, stamp: undefined }), id: store.newId(),
      name: (obj.name || obj.kind) + ' copy', t: [obj.t[0] + 0.02, obj.t[1] - 0.02, obj.t[2]] });
    view.select(copy.id);
  }
  function removeLayerDeep(layer) {
    if (!confirm(`delete layer "${layer.name}" and its ${itemsOf(layer.id).length} item(s)?`)) return;
    for (const o of itemsOf(layer.id)) store.remove(o.id);
    store.remove(layer.id);
  }

  // ── context menus ───────────────────────────────────────────────────────
  function itemMenu(obj, x, y) {
    popup([
      { label: obj.hidden ? 'show' : 'hide', shortcut: 'h', action: () => toggleHidden(obj) },
      { label: 'rename…', shortcut: 'F2', action: () => rename(obj) },
      { label: 'duplicate', action: () => duplicate(obj) },
      { label: 'zoom to', action: () => view.lookAt(obj.t) },
      { label: 'move to layer', children: () => layers().map((l) => ({
          label: l.name, checked: obj.layer === l.id,
          action: () => store.upsert({ id: obj.id, layer: l.id }) })) },
      '---',
      { label: 'delete', shortcut: 'Del', danger: true,
        action: () => { store.remove(obj.id); view.select(null); } },
    ], x, y);
  }
  function layerMenu(layer, x, y) {
    popup([
      { label: layer.hidden ? 'show layer' : 'hide layer', action: () => toggleHidden(layer) },
      { label: 'rename…', shortcut: 'F2', action: () => rename(layer) },
      { label: 'add here', children: () => {
          state.activeLayer = layer.id;
          return addItems();
        } },
      '---',
      { label: 'delete layer…', danger: true, action: () => removeLayerDeep(layer) },
    ], x, y);
  }

  // ── menubar (@gcu/menu MenuBar — sections with factory items, so checked/
  // disabled states re-evaluate every time a menu opens) ───────────────────
  const bar = new MenuBar(els.menubar, [
    { label: 'file', items: () => [
      { label: 'new scene…', action: () => {
          if (!confirm('Clear the scene? (removes every object)')) return;
          for (const o of store.all()) store.remove(o.id);
        } },
      '---',
      { label: 'open project…', action: () => pickFile('.json', async (f) => store.importProject(await f.text())) },
      { label: 'save project', action: () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([store.exportProject()], { type: 'application/json' }));
          a.download = 'scene.ars.json';
          a.click();
          URL.revokeObjectURL(a.href);
        } },
      '---',
      { label: 'demo scene', checked: layers().some((l) => l.name === 'demo'),
        action: async () => { const { toggleDemoScene } = await import('./demo.js'); await toggleDemoScene(store); } },
    ] },
    { label: 'add', items: () => [
      ...addItems(),
      '---',
      { label: 'layer', action: () => {
          const l = store.upsert({ id: store.newId(), kind: 'layer', name: 'layer ' + (layers().length + 1) });
          state.activeLayer = l.id;
        } },
    ] },
    { label: 'view', items: () => [
      { label: 'zoom to mat', action: () => view.lookAt([0, 0, 0]) },
      { label: 'zoom to selection', disabled: !view.selectedId(),
        action: () => { const o = store.get(view.selectedId()); if (o) view.lookAt(o.t); } },
    ] },
  ]);
  bar.on('action', (a) => { if (typeof a === 'function') a(); });

  // ── the tree ────────────────────────────────────────────────────────────
  function eyeEl(obj) {
    const eye = el('span', 'eye' + (obj.hidden ? ' off' : ''), obj.hidden ? '◌' : '●');
    eye.title = obj.kind === 'layer' ? 'layer visibility — items keep their own eyes' : 'visibility';
    eye.onclick = (e) => { e.stopPropagation(); toggleHidden(obj); };
    return eye;
  }

  function renderTree() {
    const root = els.tree;
    root.textContent = '';
    for (const layer of layers()) {
      const collapsed = state.collapsed.has(layer.id);
      const items = itemsOf(layer.id);
      const row = el('div', 'layer-row' + (layer.id === (activeLayer() || {}).id ? ' active' : '')
                              + (layer.hidden ? ' hidden-row' : ''));
      const caret = el('span', 'caret', collapsed ? '▸' : '▾');
      caret.onclick = (e) => {
        e.stopPropagation();
        collapsed ? state.collapsed.delete(layer.id) : state.collapsed.add(layer.id);
        renderTree();
      };
      row.append(caret, eyeEl(layer), el('span', 'lname', layer.name),
                 el('span', 'lcount', String(items.length)));
      row.onclick = () => { state.activeLayer = layer.id; renderTree(); };
      row.ondblclick = () => rename(layer);
      row.oncontextmenu = (e) => { e.preventDefault(); layerMenu(layer, e.clientX, e.clientY); };
      root.append(row);
      if (collapsed) continue;
      for (const obj of items) {
        const orow = el('div', 'obj-row' + (view.selectedId() === obj.id ? ' selected' : '')
                                 + (effectiveHidden(store, obj) ? ' hidden-row' : ''));
        orow.append(eyeEl(obj), el('span', 'okind', obj.kind),
                    el('span', 'oname', obj.name || obj.id));
        orow.onclick = () => view.select(obj.id);
        orow.ondblclick = () => rename(obj);
        orow.oncontextmenu = (e) => { e.preventDefault(); itemMenu(obj, e.clientX, e.clientY); };
        root.append(orow);
      }
    }
  }

  // ── inspector ───────────────────────────────────────────────────────────
  function renderInspector() {
    const root = els.inspector;
    root.textContent = '';
    const id = view.selectedId();
    const obj = id && store.get(id);
    if (!obj) { root.append(el('div', 'hint', 'select an item — click it in the view or the tree; right-click for actions')); return; }

    root.append(field('name', obj.name || '', (v) => store.upsert({ id, name: v })));
    root.append(selectField('layer', obj.layer, layers().map((l) => [l.id, l.name]),
      (v) => store.upsert({ id, layer: v })));
    root.append(field('x (mm)', mm(obj.t[0]), (v) => store.upsert({ id, t: [fromMm(v), obj.t[1], obj.t[2]] })));
    root.append(field('y (mm)', mm(obj.t[1]), (v) => store.upsert({ id, t: [obj.t[0], fromMm(v), obj.t[2]] })));
    root.append(field('z (mm)', mm(obj.t[2]), (v) => store.upsert({ id, t: [obj.t[0], obj.t[1], fromMm(v)] })));
    root.append(field('rot z (°)', deg(obj.rz || 0), (v) => store.upsert({ id, rz: fromDeg(v) })));
    root.append(field('scale', obj.s ?? 1, (v) => store.upsert({ id, s: Number(v) || 1 })));

    const prop = (k, label, conv = Number) =>
      root.append(field(label, obj.props[k] ?? '', (v) => store.upsert({ id, props: { [k]: conv(v) } })));
    if (obj.kind === 'box') {
      prop('w', 'w (m)'); prop('d', 'd (m)'); prop('h', 'h (m)');
      root.append(selectField('style', String(obj.props.solid ?? true),
        [['true', 'solid'], ['false', 'wire']],
        (v) => store.upsert({ id, props: { solid: v === 'true' } })));
    }
    if (obj.kind === 'label') { prop('text', 'text', String); prop('size', 'size (m)'); }
    if (obj.kind === 'axes') prop('size', 'size (m)');
    if (obj.kind === 'mesh') root.append(selectField('unit', obj.props.unit || 'mm',
      [['mm', 'mm'], ['m', 'm']], (v) => store.upsert({ id, props: { unit: v } })));
    if (obj.kind === 'image') { prop('w', 'w (m)'); prop('d', 'd (m)'); }
    if (obj.kind === 'blocks') {
      if (obj.props.blob && obj.props.cols && obj.props.cols.length) {
        root.append(selectField('color by', String(obj.props.chan),
          obj.props.cols.map((c) => [String(c.i), c.name]),
          (v) => store.upsert({ id, props: { chan: Number(v) } })));
      }
      root.append(selectField('ramp', obj.props.ramp || 'viridis',
        ['viridis', 'spectral', 'magma', 'turbo', 'greys'].map((r) => [r, r]),
        (v) => store.upsert({ id, props: { ramp: v } })));
      prop('cutoff', 'cutoff');
      prop('footprint', 'span (m)');
      if (!obj.props.blob) prop('seed', 'seed');
      if (obj.props.count) root.append(el('div', 'hint',
        obj.props.count.toLocaleString() + ' blocks' + (obj.props.dm ? ' · .dm' : '')));
      root.append(selectField('edges', String(obj.props.edges !== false),
        [['true', 'on'], ['false', 'off']],
        (v) => store.upsert({ id, props: { edges: v === 'true' } })));
    }

    const del = el('button', 'danger', 'delete');
    del.onclick = () => { store.remove(id); view.select(null); };
    root.append(del);
  }

  function field(label, value, commit) {
    const wrap = el('label', 'field');
    wrap.append(el('span', '', label));
    const inp = document.createElement('input');
    inp.value = value;
    inp.onchange = () => commit(inp.value);
    wrap.append(inp);
    return wrap;
  }
  function selectField(label, value, options, commit) {
    const wrap = el('label', 'field');
    wrap.append(el('span', '', label));
    const sel = document.createElement('select');
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = text; o.selected = v === value;
      sel.append(o);
    }
    sel.onchange = () => commit(sel.value);
    wrap.append(sel);
    return wrap;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  let raf = 0;
  const renderAll = () => { renderTree(); renderInspector(); };
  store.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderAll); });
  view.onSelect = renderAll;

  // right-click in the viewport: item menu on an object, add-menu on the mat
  view.onContextMenu = (id, matPoint, x, y) => {
    if (id) { const o = store.get(id); if (o) { view.select(id); itemMenu(o, x, y); } }
    else popup([{ label: 'add at this spot', children: addItems(matPoint) },
                { label: 'zoom to mat', action: () => view.lookAt([0, 0, 0]) }], x, y);
  };

  window.addEventListener('keydown', (e) => {
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const id = view.selectedId();
    const obj = id && store.get(id);
    if (e.key === 'Delete' && obj) { store.remove(id); view.select(null); }
    else if (e.key === 'h' && obj) toggleHidden(obj);
    else if (e.key === 'F2' && obj) { e.preventDefault(); rename(obj); }
  });

  ensureDefaultLayer();
  renderAll();
  return { renderAll, addObject };
}
