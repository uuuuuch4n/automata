// Pure automaton model + simulation logic (no DOM). Supports DFA / NFA / ε-NFA.

export const EPSILON = 'ε';

export function createModel() {
  return { states: [], transitions: [], nextId: 0 };
}

export function addState(model, x, y) {
  const id = model.nextId++;
  const state = { id, name: `q${id}`, x, y, initial: false, accepting: false };
  model.states.push(state);
  return state;
}

export function removeState(model, id) {
  model.states = model.states.filter((s) => s.id !== id);
  model.transitions = model.transitions.filter((t) => t.from !== id && t.to !== id);
}

/** Normalise "a, b,eps" -> ['a','b','ε'] (deduplicated, order kept). */
export function parseSymbols(text) {
  const out = [];
  for (const raw of String(text).split(',')) {
    let s = raw.trim();
    if (s === '' ) continue;
    if (s === 'eps' || s === 'epsilon' || s === 'ε') s = EPSILON;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Add symbols to the edge from->to, merging with an existing edge. */
export function addTransition(model, from, to, symbols) {
  if (symbols.length === 0) return null;
  let t = model.transitions.find((e) => e.from === from && e.to === to);
  if (t) {
    for (const s of symbols) if (!t.symbols.includes(s)) t.symbols.push(s);
  } else {
    t = { id: model.nextId++, from, to, symbols: [...symbols] };
    model.transitions.push(t);
  }
  return t;
}

export function removeTransition(model, id) {
  model.transitions = model.transitions.filter((t) => t.id !== id);
}

export function alphabet(model) {
  const set = new Set();
  for (const t of model.transitions) for (const s of t.symbols) if (s !== EPSILON) set.add(s);
  return [...set].sort();
}

export function epsilonClosure(model, ids) {
  const seen = new Set(ids);
  const stack = [...ids];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of model.transitions) {
      if (t.from === cur && t.symbols.includes(EPSILON) && !seen.has(t.to)) {
        seen.add(t.to);
        stack.push(t.to);
      }
    }
  }
  return seen;
}

export function move(model, ids, symbol) {
  const out = new Set();
  for (const t of model.transitions) {
    if (ids.has(t.from) && t.symbols.includes(symbol)) out.add(t.to);
  }
  return epsilonClosure(model, out);
}

/**
 * Run `input` (array of symbols) through the automaton.
 * Returns { trace: Set<id>[] (length input.length+1), accepted, stuckAt }.
 * stuckAt is the index of the first step with no active state, or -1.
 */
export function simulate(model, input) {
  const starts = model.states.filter((s) => s.initial).map((s) => s.id);
  let current = epsilonClosure(model, starts);
  const trace = [current];
  let stuckAt = current.size === 0 ? 0 : -1;
  for (let i = 0; i < input.length; i++) {
    current = move(model, current, input[i]);
    trace.push(current);
    if (current.size === 0 && stuckAt === -1) stuckAt = i + 1;
  }
  const accepting = new Set(model.states.filter((s) => s.accepting).map((s) => s.id));
  const accepted = [...current].some((id) => accepting.has(id));
  return { trace, accepted, stuckAt };
}

/** Split a string into symbols. Multi-character symbols are matched greedily. */
export function tokenize(model, text, separator = '') {
  if (separator) return text.split(separator).filter((s) => s !== '');
  const symbols = alphabet(model).sort((a, b) => b.length - a.length);
  const out = [];
  let i = 0;
  while (i < text.length) {
    const hit = symbols.find((s) => text.startsWith(s, i));
    const sym = hit ?? text[i];
    out.push(sym);
    i += sym.length;
  }
  return out;
}

/** Returns a list of human-readable warnings about the automaton. */
export function validate(model) {
  const warnings = [];
  const initial = model.states.filter((s) => s.initial);
  if (initial.length === 0) warnings.push('初期状態がありません');
  if (!model.states.some((s) => s.accepting)) warnings.push('受理状態がありません');
  return warnings;
}

export function isDeterministic(model) {
  if (model.states.filter((s) => s.initial).length > 1) return false;
  const seen = new Set();
  for (const t of model.transitions) {
    for (const s of t.symbols) {
      if (s === EPSILON) return false;
      const key = `${t.from}|${s}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

export function toJSON(model) {
  return JSON.stringify(
    { version: 1, states: model.states, transitions: model.transitions },
    null,
    2,
  );
}

export function fromJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.states) || !Array.isArray(data.transitions)) {
    throw new Error('不正なファイル形式です');
  }
  const model = createModel();
  const ids = new Set();
  for (const s of data.states) {
    if (!Number.isInteger(s.id) || ids.has(s.id)) throw new Error('状態IDが不正です');
    ids.add(s.id);
    model.states.push({
      id: s.id,
      name: String(s.name ?? `q${s.id}`),
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      initial: !!s.initial,
      accepting: !!s.accepting,
    });
  }
  for (const t of data.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) throw new Error('遷移が存在しない状態を参照しています');
    model.transitions.push({
      id: Number.isInteger(t.id) ? t.id : 0,
      from: t.from,
      to: t.to,
      symbols: parseSymbols((t.symbols ?? []).join(',')),
    });
  }
  const maxId = Math.max(-1, ...model.states.map((s) => s.id), ...model.transitions.map((t) => t.id));
  model.nextId = maxId + 1;
  return model;
}
