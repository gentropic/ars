// ui.js — layer tree (left), toolbar (top), inspector (right). Imperative
// re-render on store change; the store is the only state that matters.

const mm = (v) => Math.round(v * 1000);
const fromMm = (v) => (Number(v) || 0) / 1000;
const deg = (v) => Math.round((v * 180 / Math.PI) * 10) / 10;
const fromDeg = (v) => (Number(v) || 0) * Math.PI / 180;

export function initUI(store, view, els) {
  const hiddenLayers = new Set();
  view.setVisibility((obj) => !hiddenLayers.has(obj.layer));

  const layers = () => store.byKind('layer');
  const activeLayer = () => {
    const ls = layers();
    return (ls.find((l) => l.id === state.activeLayer) || ls[0] || null);
  };
  const state = { activeLayer: null };

  function ensureDefaultLayer() {
    if (!layers().length) store.upsert({ id: store.newId(), kind: 'layer', name: 'layer 1' });
  }

  // ── toolbar ─────────────────────────────────────────────────────────────
  function addObject(kind, props = {}, name) {
    ensureDefaultLayer();
    const obj = store.upsert({
      id: store.newId(), kind, name: name || kind, layer: activeLayer().id,
      t: [0, 0, 0], props,
    });
    view.select(obj.id);
  }

  els.addAxes.onclick = () => addObject('axes', { size: 0.05 });
  els.addBox.onclick = () => addObject('box', { w: 0.04, d: 0.04, h: 0.04, solid: true });
  els.addLabel.onclick = () => addObject('label', { text: 'label', size: 0.02 });

  els.addMesh.onclick = () => pickFile('.stl', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await store.saveBlob(bytes);
    addObject('mesh', { blob: hash, fmt: 'stl', unit: 'mm' }, file.name.replace(/\.stl$/i, ''));
  });

  els.addImage.onclick = () => pickFile('image/*', async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await store.saveBlob(bytes);
    const img = new Image();
    img.onload = () => {
      const w = 0.1;                              // 10 cm wide, aspect-true
      addObject('image', { blob: hash, w, d: w * img.naturalHeight / img.naturalWidth },
        file.name.replace(/\.[^.]+$/, ''));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(new Blob([bytes]));
  });

  els.addLayer.onclick = () => {
    const l = store.upsert({ id: store.newId(), kind: 'layer', name: 'layer ' + (layers().length + 1) });
    state.activeLayer = l.id;
  };

  els.demo.onclick = async () => {
    const { toggleDemoScene } = await import('./demo.js');
    await toggleDemoScene(store);
  };

  els.save.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.exportProject()], { type: 'application/json' }));
    a.download = 'scene.ars.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  els.load.onclick = () => pickFile('.json', async (file) => {
    store.importProject(await file.text());
  });
  els.clear.onclick = () => {
    if (!confirm('Clear the scene? (removes every object)')) return;
    for (const o of store.all()) store.remove(o.id);
  };

  function pickFile(accept, fn) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => inp.files[0] && fn(inp.files[0]);
    inp.click();
  }

  // ── layer tree ──────────────────────────────────────────────────────────
  function renderTree() {
    const root = els.tree;
    root.textContent = '';
    for (const layer of layers()) {
      const row = el('div', 'layer-row' + (layer.id === (activeLayer() || {}).id ? ' active' : ''));
      const eye = el('span', 'eye', hiddenLayers.has(layer.id) ? '◌' : '●');
      eye.title = 'toggle visibility (local)';
      eye.onclick = (e) => {
        e.stopPropagation();
        hiddenLayers.has(layer.id) ? hiddenLayers.delete(layer.id) : hiddenLayers.add(layer.id);
        view.setVisibility((obj) => !hiddenLayers.has(obj.layer));
        renderTree();
      };
      row.append(eye, el('span', 'lname', layer.name));
      row.onclick = () => { state.activeLayer = layer.id; renderTree(); };
      root.append(row);
      for (const obj of store.all().filter((o) => o.kind !== 'layer' && o.layer === layer.id)) {
        const orow = el('div', 'obj-row' + (view.selectedId() === obj.id ? ' selected' : ''));
        orow.append(el('span', 'okind', obj.kind), el('span', '', obj.name || obj.id));
        orow.onclick = () => view.select(obj.id);
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
    if (!obj) { root.append(el('div', 'hint', 'select an object — click it in the view or the tree')); return; }

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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && view.selectedId() && document.activeElement.tagName !== 'INPUT') {
      store.remove(view.selectedId());
      view.select(null);
    }
  });

  ensureDefaultLayer();
  renderAll();
  return { renderAll };
}
