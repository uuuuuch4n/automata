import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModel, addState, addTransition, removeState, parseSymbols, simulate, tokenize,
  isDeterministic, toJSON, fromJSON, EPSILON,
} from '../src/automaton.js';

// DFA over {a,b} accepting strings that end in "ab"
function endsInAb() {
  const m = createModel();
  const [q0, q1, q2] = [0, 0, 0].map((_, i) => addState(m, i * 100, 0));
  q0.initial = true; q2.accepting = true;
  addTransition(m, q0.id, q1.id, ['a']);
  addTransition(m, q0.id, q0.id, ['b']);
  addTransition(m, q1.id, q1.id, ['a']);
  addTransition(m, q1.id, q2.id, ['b']);
  addTransition(m, q2.id, q1.id, ['a']);
  addTransition(m, q2.id, q0.id, ['b']);
  return m;
}

test('parseSymbols normalises and dedupes', () => {
  assert.deepEqual(parseSymbols(' a, b ,a,eps,,'), ['a', 'b', EPSILON]);
});

test('DFA accepts / rejects', () => {
  const m = endsInAb();
  assert.equal(isDeterministic(m), true);
  assert.equal(simulate(m, tokenize(m, 'aab')).accepted, true);
  assert.equal(simulate(m, tokenize(m, 'aba')).accepted, false);
  assert.equal(simulate(m, []).accepted, false);
});

test('missing transition is reported as stuck', () => {
  const m = endsInAb();
  const r = simulate(m, ['c']);
  assert.equal(r.accepted, false);
  assert.equal(r.stuckAt, 1);
});

test('NFA with epsilon transitions', () => {
  // q0 -ε-> q1 -a-> q2(accept)
  const m = createModel();
  const q0 = addState(m, 0, 0), q1 = addState(m, 1, 0), q2 = addState(m, 2, 0);
  q0.initial = true; q2.accepting = true;
  addTransition(m, q0.id, q1.id, [EPSILON]);
  addTransition(m, q1.id, q2.id, ['a']);
  assert.equal(isDeterministic(m), false);
  assert.equal(simulate(m, ['a']).accepted, true);
  assert.equal(simulate(m, []).accepted, false);
});

test('addTransition merges edges between the same states', () => {
  const m = createModel();
  const a = addState(m, 0, 0), b = addState(m, 1, 0);
  addTransition(m, a.id, b.id, ['x']);
  addTransition(m, a.id, b.id, ['y', 'x']);
  assert.equal(m.transitions.length, 1);
  assert.deepEqual(m.transitions[0].symbols, ['x', 'y']);
});

test('removeState drops incident transitions', () => {
  const m = endsInAb();
  removeState(m, 1);
  assert.equal(m.states.length, 2);
  assert.ok(m.transitions.every((t) => t.from !== 1 && t.to !== 1));
});

test('tokenize prefers longest multi-character symbol', () => {
  const m = createModel();
  const a = addState(m, 0, 0);
  addTransition(m, a.id, a.id, ['ab', 'a']);
  assert.deepEqual(tokenize(m, 'aab'), ['a', 'ab']);
});

test('JSON round trip and validation', () => {
  const m = endsInAb();
  const copy = fromJSON(toJSON(m));
  assert.deepEqual(copy.states, m.states);
  assert.deepEqual(copy.transitions, m.transitions);
  assert.ok(copy.nextId > Math.max(...copy.states.map((s) => s.id)));
  assert.throws(() => fromJSON('{"states":[],"transitions":[{"from":1,"to":2}]}'));
  assert.throws(() => fromJSON('{}'));
});
