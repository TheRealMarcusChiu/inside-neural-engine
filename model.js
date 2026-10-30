// Deterministic teaching math. Weights are hand-chosen by the educator, not trained.

export function matmul(A, B) {
  if (!A.length || !B.length || A[0].length !== B.length) {
    throw new Error('matmul: inner dimensions must match');
  }
  return A.map((row) =>
    B[0].map((_, j) => row.reduce((sum, a, k) => sum + a * B[k][j], 0))
  );
}

export const RAW_IMAGE = [[100, 50], [25, 100]];
export const WEIGHTS = [[0.8, -0.4], [0.2, 0.9]];
export const READOUT = [[1.2, -0.5, 0.2], [-0.4, 1.1, 0.2]];
export const CLASSES = ['Diagonal', 'Bar', 'Other'];

const relu = (M) => M.map((row) => row.map((v) => Math.max(0, v)));
const softmax = (v) => {
  const m = Math.max(...v);
  const e = v.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
};

export function toyForward() {
  const input = RAW_IMAGE.map((row) => row.map((v) => v / 100));
  const preActivation = matmul(input, WEIGHTS);
  const hidden = relu(preActivation);
  const pooled = hidden[0].map((_, j) => hidden.reduce((s, row) => s + row[j], 0) / hidden.length);
  const logits = matmul([pooled], READOUT)[0];
  return {
    raw: RAW_IMAGE,
    input,
    weights: WEIGHTS,
    preActivation,
    hidden,
    pooled,
    readout: READOUT,
    logits,
    scores: softmax(logits),
    classes: CLASSES,
  };
}

// Qualitative playground. Slider levels are unitless inputs; outputs are words, never measurements.
export const LEVELS = ['Low', 'Moderate', 'High', 'Very high'];
const level = (n) => LEVELS[Math.min(3, Math.floor(Math.max(0, Math.min(1, n)) * 4))];
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));

export function evaluatePlayground(config = {}) {
  const m = clampInt(config.modelSize ?? 3, 1, 5);
  const i = clampInt(config.inputSize ?? 3, 1, 5);
  const c = clampInt(config.concurrency ?? 1, 1, 8);
  const compatible = config.compatible !== false;

  const work = (m * i - 1) / 24;
  // Bigger models and inputs fill the parallel hardware with fewer simultaneous requests.
  const saturation = Math.min(8, Math.max(2, 9 - m - Math.floor(i / 2)));
  const busy = Math.min(c, saturation);
  const queued = Math.max(0, c - saturation);
  const memory = (2 * m + i + (c - 1) * (0.4 * i + 0.2 * m) - 3) / 33;
  const latency = 0.75 * work + 0.25 * (queued / 6) + (memory > 0.8 ? 0.15 : 0);
  const throughput = (busy / 8) * (1 - 0.55 * work) + 0.1;
  const energy = (0.55 * work + 0.35 * (busy / 8)) * (compatible ? 0.85 : 1) + 0.05;

  const notes = [];
  notes.push(queued > 0
    ? 'Concurrency is past the saturation point: extra requests mostly wait in line, so throughput flattens while latency climbs.'
    : 'Batching more requests together still finds idle parallel lanes, so combined throughput can rise.');
  if (memory > 0.6) notes.push('Weights plus per-request activations are crowding memory; larger models and longer inputs both add pressure.');
  notes.push(compatible
    ? 'The model uses operations a specialized unit supports, so Core ML has the option to place them there. That is an opportunity, not a guaranteed speedup.'
    : 'Some operations are unsupported by the specialized unit, so this work stays on general-purpose CPU or GPU paths, or the model may need conversion.');

  return {
    inputs: { modelSize: m, inputSize: i, concurrency: c, compatible },
    saturated: queued > 0,
    metrics: {
      latency: level(latency),
      memoryPressure: level(memory),
      throughput: level(throughput),
      energyDemand: level(energy),
    },
    eligibility: compatible ? 'Eligible for specialized placement' : 'General-purpose paths only',
    notes,
  };
}
