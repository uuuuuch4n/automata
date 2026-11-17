import {
  EPSILON, createModel, addState, removeState, addTransition, removeTransition,
  parseSymbols, simulate, tokenize, validate, isDeterministic, alphabet, toJSON, fromJSON,
} from './automaton.js';

const R = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'automaton-editor:model';

let model = load() ?? createModel();
let tool = 'select';
let selected = null; // { type: 'state'|'transition', id }
let pendingFrom = null; // state id while drawing a transition
let drag = null;
let sim = null; // { trace, accepted, stuckAt, step }

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const gEdges = svg.querySelector('#edges');
const gNodes = svg.querySelector('#nodes');

function el(name, attrs = {}, text) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? fromJSON(raw) : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, toJSON(model)); } catch { /* ignore */ }
}

function point(evt) {
  const p = svg.createSVGPoint();
  p.x = evt.clientX; p.y = evt.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}

const stateById = (id) => model.states.find((s) => s.id === id);

// ---------- rendering ----------

function edgeGeometry(t) {
  const a = stateById(t.from), b = stateById(t.to);
  if (t.from === t.to) {
    return {
      d: `M ${a.x - 12} ${a.y - R * 0.9} C ${a.x - 45} ${a.y - R - 48} ${a.x + 45} ${a.y - R - 48} ${a.x + 12} ${a.y - R * 0.9}`,
      lx: a.x, ly: a.y - R - 40,
    };
  }
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const curved = model.transitions.some((o) => o.from === t.to && o.to === t.from);
  const off = curved ? 34 : 0;
  const cx = (a.x + b.x) / 2 + nx * off * 2, cy = (a.y + b.y) / 2 + ny * off * 2;
  const trim = (s, tx, ty) => {
    const ux = tx - s.x, uy = ty - s.y, l = Math.hypot(ux, uy) || 1;
    return [s.x + (ux / l) * R, s.y + (uy / l) * R];
  };
  const [x1, y1] = trim(a, cx, cy);
  const [x2, y2] = trim(b, cx, cy);
  const mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2, my = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
  const side = off >= 0 ? 1 : -1;
  return {
    d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
    lx: mx + nx * 14 * side * (curved ? 1 : 1),
    ly: my + ny * 14 * side - 2,
  };
}

function render() {
  gEdges.replaceChildren();
  gNodes.replaceChildren();
  const active = sim ? sim.trace[sim.step] : new Set();

  for (const t of model.transitions) {
    const g = geometry(t);
    const isSel = selected?.type === 'transition' && selected.id === t.id;
    const grp = el('g', { class: `edge${isSel ? ' selected' : ''}`, 'data-id': t.id });
    grp.append(el('path', { d: g.d, class: 'hit' }));
    grp.append(el('path', { d: g.d, class: 'line', 'marker-end': 'url(#arrow)' }));
    grp.append(el('text', { x: g.lx, y: g.ly, class: 'label' }, t.symbols.join(', ')));
    gEdges.append(grp);
  }

  for (const s of model.states) {
    const isSel = selected?.type === 'state' && selected.id === s.id;
    const cls = ['node', isSel && 'selected', active.has(s.id) && 'active', pendingFrom === s.id && 'pending']
      .filter(Boolean).join(' ');
    const grp = el('g', { class: cls, 'data-id': s.id, transform: `translate(${s.x} ${s.y})` });
    grp.append(el('circle', { r: R }));
    if (s.accepting) grp.append(el('circle', { r: R - 5, class: 'inner' }));
    if (s.initial) {
      grp.append(el('line', { x1: -R - 34, y1: 0, x2: -R - 2, y2: 0, class: 'start', 'marker-end': 'url(#arrow)' }));
    }
    grp.append(el('text', { y: 5, class: 'name' }, s.name));
    gNodes.append(grp);
  }
  renderPanel();
  renderSim();
  $('hint').textContent = {
    select: '状態をドラッグで移動 / 選択して編集',
    state: 'キャンバスをクリックして状態を追加',
    transition: pendingFrom === null ? '遷移元の状態をクリック' : '遷移先の状態をクリック(自己ループも可)',
    delete: '削除したい状態・遷移をクリック',
  }[tool];
}
const geometry = edgeGeometry;

function renderPanel() {
  const panel = $('props');
  panel.replaceChildren();
  const warn = validate(model);
  const info = document.createElement('p');
  info.className = 'info';
  info.textContent = `${model.states.length} 状態 / ${model.transitions.length} 遷移 / Σ={${alphabet(model).join(',')}} / ${isDeterministic(model) ? 'DFA' : 'NFA'}`;
  panel.append(info);
  for (const w of warn) {
    const p = document.createElement('p');
    p.className = 'warn'; p.textContent = `⚠ ${w}`;
    panel.append(p);
  }
  if (!selected) return;

  if (selected.type === 'state') {
    const s = stateById(selected.id);
    if (!s) return;
    panel.append(field('名前', textInput(s.name, (v) => { s.name = v || s.name; commit(false); })));
    panel.append(field('初期状態', checkbox(s.initial, (v) => { s.initial = v; commit(); })));
    panel.append(field('受理状態', checkbox(s.accepting, (v) => { s.accepting = v; commit(); })));
  } else {
    const t = model.transitions.find((e) => e.id === selected.id);
    if (!t) return;
    const input = textInput(t.symbols.join(','), (v) => {
      const symbols = parseSymbols(v);
      if (symbols.length) { t.symbols = symbols; commit(); }
    });
    input.placeholder = 'a,b,ε';
    panel.append(field(`記号 (${stateById(t.from).name} → ${stateById(t.to).name})`, input));
    const eps = document.createElement('button');
    eps.textContent = 'ε を追加';
    eps.onclick = () => { if (!t.symbols.includes(EPSILON)) t.symbols.push(EPSILON); commit(); };
    panel.append(eps);
  }
}

function field(label, control) {
  const l = document.createElement('label');
  l.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  l.append(span, control);
  return l;
}
function textInput(value, onchange) {
  const i = document.createElement('input');
  i.type = 'text'; i.value = value;
  i.onchange = () => onchange(i.value.trim());
  return i;
}
function checkbox(value, onchange) {
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = value;
  i.onchange = () => onchange(i.checked);
  return i;
}

function renderSim() {
  const out = $('simResult');
  if (!sim) { out.textContent = ''; out.className = ''; return; }
  const { trace, step, accepted, stuckAt } = sim;
  const names = (set) => [...set].map((id) => stateById(id)?.name).filter(Boolean).join(', ') || '∅';
  const lines = trace.map((set, i) => `${i === step ? '▶' : ' '} ${i}: {${names(set)}}`);
  const done = step === trace.length - 1;
  let verdict = '';
  if (done) verdict = accepted ? '\n✔ 受理' : stuckAt >= 0 ? `\n✘ 拒否(${stuckAt}文字目で遷移先なし)` : '\n✘ 拒否';
  out.textContent = lines.join('\n') + verdict;
  out.className = done ? (accepted ? 'ok' : 'ng') : '';
}

function commit(rerender = true) {
  save();
  if (sim) sim = null;
  if (rerender) render();
}

// ---------- interaction ----------

svg.addEventListener('pointerdown', (e) => {
  const nodeEl = e.target.closest('.node');
  const edgeEl = e.target.closest('.edge');
  const p = point(e);

  if (tool === 'state' && !nodeEl) {
    const s = addState(model, Math.round(p.x), Math.round(p.y));
    if (model.states.length === 1) s.initial = true;
    selected = { type: 'state', id: s.id };
    commit();
    return;
  }
  if (nodeEl) {
    const id = Number(nodeEl.dataset.id);
    if (tool === 'delete') { removeState(model, id); selected = null; commit(); return; }
    if (tool === 'transition') {
      if (pendingFrom === null) { pendingFrom = id; render(); return; }
      const symbols = prompt('遷移記号をカンマ区切りで入力(ε は eps でも可)', 'a');
      const from = pendingFrom;
      pendingFrom = null;
      if (symbols !== null) {
        const t = addTransition(model, from, id, parseSymbols(symbols));
        if (t) selected = { type: 'transition', id: t.id };
      }
      commit();
      return;
    }
    selected = { type: 'state', id };
    const s = stateById(id);
    drag = { id, dx: p.x - s.x, dy: p.y - s.y };
    svg.setPointerCapture(e.pointerId);
    render();
    return;
  }
  if (edgeEl) {
    const id = Number(edgeEl.dataset.id);
    if (tool === 'delete') { removeTransition(model, id); selected = null; commit(); return; }
    selected = { type: 'transition', id };
    render();
    return;
  }
  selected = null;
  pendingFrom = null;
  render();
});

svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = point(e);
  const s = stateById(drag.id);
  s.x = Math.round(p.x - drag.dx);
  s.y = Math.round(p.y - drag.dy);
  render();
});
svg.addEventListener('pointerup', () => { if (drag) { drag = null; save(); } });

window.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    if (selected.type === 'state') removeState(model, selected.id);
    else removeTransition(model, selected.id);
    selected = null; commit();
  } else if (e.key === 'Escape') {
    pendingFrom = null; selected = null; render();
  } else {
    const map = { v: 'select', s: 'state', t: 'transition', d: 'delete' };
    if (map[e.key]) setTool(map[e.key]);
  }
});

function setTool(t) {
  tool = t;
  pendingFrom = null;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  svg.dataset.tool = t;
  render();
}
document.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });

// ---------- simulation ----------

function startSim() {
  const text = $('input').value;
  const input = tokenize(model, text);
  sim = { ...simulate(model, input), step: 0 };
  render();
}
$('run').onclick = () => { startSim(); sim.step = sim.trace.length - 1; render(); };
$('stepBtn').onclick = () => {
  if (!sim) startSim();
  else if (sim.step < sim.trace.length - 1) sim.step++;
  render();
};
$('reset').onclick = () => { sim = null; render(); };

// ---------- file I/O ----------

$('exportBtn').onclick = () => {
  const url = URL.createObjectURL(new Blob([toJSON(model)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'automaton.json'; a.click();
  URL.revokeObjectURL(url);
};
$('exportSvg').onclick = () => {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  const style = el('style', {}, document.getElementById('svgStyle').textContent);
  clone.prepend(style);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'automaton.svg'; a.click();
  URL.revokeObjectURL(url);
};
$('importBtn').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    model = fromJSON(await f.text());
    selected = null; commit();
  } catch (err) { alert(`読み込みに失敗しました: ${err.message}`); }
  e.target.value = '';
};
$('clear').onclick = () => {
  if (!confirm('すべて削除しますか?')) return;
  model = createModel(); selected = null; commit();
};

setTool('select');
