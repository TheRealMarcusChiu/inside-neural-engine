import test from 'node:test';
import assert from 'node:assert/strict';
import { matmul, toyForward, evaluatePlayground, LEVELS } from '../model.js';

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const closeAll = (A, B) => A.flat().forEach((v, i) => close(v, B.flat()[i]));

test('matmul multiplies and validates shapes', () => {
  assert.deepEqual(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]]);
  assert.deepEqual(matmul([[1, 2, 3]], [[1], [1], [1]]), [[6]]);
  assert.throws(() => matmul([[1, 2]], [[1, 2]]), /inner dimensions/);
});

test('toyForward matches the frozen teaching values', () => {
  const r = toyForward();
  for (const k of ['input', 'weights', 'hidden', 'pooled', 'logits', 'scores']) assert.ok(k in r, k);
  closeAll(r.input, [[1, 0.5], [0.25, 1]]);
  closeAll(r.weights, [[0.8, -0.4], [0.2, 0.9]]);
  closeAll(r.hidden, [[0.9, 0.05], [0.4, 0.8]]);
  closeAll(r.pooled, [0.65, 0.425]);
  closeAll(r.logits, [0.61, 0.1425, 0.215]);
  closeAll(r.scores, [0.4347359656918727, 0.2723910918779322, 0.2928729424301951]);
  close(r.scores.reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(r.classes, ['Diagonal', 'Bar', 'Other']);
});

test('hidden cells equal the hand-worked row·column products', () => {
  const { input: X, weights: W, preActivation: H } = toyForward();
  close(H[0][0], 1 * 0.8 + 0.5 * 0.2);
  close(H[0][1], 1 * -0.4 + 0.5 * 0.9);
  close(H[1][0], 0.25 * 0.8 + 1 * 0.2);
  close(H[1][1], 0.25 * -0.4 + 1 * 0.9);
  closeAll(H, matmul(X, W));
});

const ev = (o) => evaluatePlayground({ modelSize: 3, inputSize: 3, concurrency: 1, compatible: true, ...o });
const rank = (v) => LEVELS.indexOf(v);

test('playground outputs are qualitative words with no numbers', () => {
  for (let m = 1; m <= 5; m++) for (let c = 1; c <= 8; c++) for (const compatible of [true, false]) {
    const r = ev({ modelSize: m, concurrency: c, compatible });
    Object.values(r.metrics).forEach((v) => assert.ok(LEVELS.includes(v), v));
    [r.eligibility, ...r.notes].forEach((t) => assert.doesNotMatch(t, /\d/));
  }
});

test('bigger models and inputs never reduce work or memory pressure', () => {
  for (let m = 1; m < 5; m++) {
    assert.ok(rank(ev({ modelSize: m + 1 }).metrics.memoryPressure) >= rank(ev({ modelSize: m }).metrics.memoryPressure));
    assert.ok(rank(ev({ modelSize: m + 1 }).metrics.latency) >= rank(ev({ modelSize: m }).metrics.latency));
    assert.ok(rank(ev({ inputSize: m + 1 }).metrics.memoryPressure) >= rank(ev({ inputSize: m }).metrics.memoryPressure));
  }
  assert.equal(ev({ modelSize: 1, inputSize: 1 }).metrics.memoryPressure, 'Low');
  assert.equal(ev({ modelSize: 5, inputSize: 5, concurrency: 8 }).metrics.memoryPressure, 'Very high');
});

test('concurrency raises throughput until saturation, then latency pays', () => {
  const small = (c) => ev({ modelSize: 1, inputSize: 1, concurrency: c });
  assert.ok(rank(small(8).metrics.throughput) > rank(small(1).metrics.throughput));
  const big = (c) => ev({ modelSize: 5, inputSize: 5, concurrency: c });
  assert.equal(big(2).saturated, false);
  assert.equal(big(8).saturated, true);
  assert.equal(big(8).metrics.throughput, big(2).metrics.throughput);
  assert.ok(rank(big(8).metrics.latency) >= rank(big(2).metrics.latency));
  assert.match(big(8).notes[0], /saturation/);
});

test('compatibility changes eligibility, not a promised speedup', () => {
  const yes = ev({ compatible: true });
  const no = ev({ compatible: false });
  assert.notEqual(yes.eligibility, no.eligibility);
  assert.equal(yes.metrics.latency, no.metrics.latency);
  assert.equal(yes.metrics.throughput, no.metrics.throughput);
  assert.ok(yes.notes.some((n) => /not a guaranteed speedup/.test(n)));
});

test('inputs are clamped to slider ranges', () => {
  assert.deepEqual(evaluatePlayground({ modelSize: 99, inputSize: -3, concurrency: 'x' }).inputs,
    { modelSize: 5, inputSize: 1, concurrency: 1, compatible: true });
});
