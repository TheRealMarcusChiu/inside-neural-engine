import { toyForward, evaluatePlayground, LEVELS } from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
root.classList.replace('no-js', 'js');

const fmt = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace('-', '−');
const press = (buttons, isOn) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(isOn(b))));

/* Global motion ------------------------------------------------------ */
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const motionBtn = $('#motion-toggle');
const motionStatus = $('#motion-status');
let globallyPaused = false;

function setMotion(paused, status) {
  globallyPaused = paused;
  root.dataset.motion = paused ? 'paused' : 'running';
  motionBtn.setAttribute('aria-pressed', String(paused));
  motionBtn.textContent = paused ? 'Resume animations' : 'Pause animations';
  motionStatus.textContent = status || (paused ? 'All animations paused' : 'Animations running');
  syncNetwork();
}
motionBtn.addEventListener('click', () => setMotion(!globallyPaused));

/* Chip ---------------------------------------------------------------- */
const COMPONENTS = {
  cpu: ['CPU', 'General-purpose cores for control flow, preprocessing, scheduling and any work another unit can\'t take. Neural networks run here too, with fewer parallel lanes than the GPU.'],
  gpu: ['GPU', 'Many parallel lanes suited to large, uniform math such as batched matrix multiplication. Apps program it through Metal; MLX and llama.cpp\'s Metal build run models here.'],
  ane: ['Neural Engine', 'Specialized hardware for running trained neural networks. Core ML can place supported operations here when the model and the app\'s allowed compute units permit it.'],
  memory: ['Unified memory', 'One pool the CPU, GPU and other units can all access, which avoids many explicit copies. Shared access still needs synchronization and has bandwidth limits.'],
};
const chip = $('.chip');
const chipButtons = $$('[data-component]');
const componentTitle = $('#component-detail .detail-title');
const componentText = $('#component-detail p');
chipButtons.forEach((b) => b.addEventListener('click', () => {
  const id = b.dataset.component;
  press(chipButtons, (x) => x === b);
  chip.dataset.selected = id;
  [componentTitle.textContent, componentText.textContent] = COMPONENTS[id];
}));

/* Workloads ----------------------------------------------------------- */
const WORKLOADS = {
  image: {
    cpu: ['Decode', 'Resize', 'App logic'], gpu: 'Same filter across many pixel tiles',
    ane: ['Convolution', 'Activation', 'Pooling', 'Classifier'],
    text: 'Photo tagging: the CPU decodes and resizes the photo, the GPU can push many pixel tiles through one filter at once, and the Neural Engine can run the supported layers of a Core ML vision model.',
  },
  speech: {
    cpu: ['Capture', 'Framing', 'Transcript'], gpu: 'Same transform across many audio frames',
    ane: ['Encoder', 'Attention', 'Feed-forward', 'Decoder'],
    text: 'Speech to text: the CPU captures audio and assembles the transcript, the GPU can transform many audio frames in parallel, and the Neural Engine can run the supported layers of an on-device speech model.',
  },
  video: {
    cpu: ['Schedule', 'Decode', 'Compose'], gpu: 'Same effect on every pixel of every frame',
    ane: ['Convolution', 'Activation', 'Upsample', 'Mask'],
    text: 'Video effects: the CPU schedules frames and composes the result, the GPU can apply one effect to every pixel at once, and the Neural Engine can run the supported layers of a per-frame segmentation model.',
  },
  llm: {
    cpu: ['Tokenize', 'Sample', 'Stream text'], gpu: 'Same matrix math for a batch of tokens',
    ane: ['Embedding', 'Attention', 'Feed-forward', 'Logits'],
    text: 'Local language model: the CPU tokenizes and samples, and runtimes such as MLX and llama.cpp do the heavy matrix math on the GPU. The Neural Engine is an option only for models converted to Core ML whose operations it supports.',
  },
};
const workload = $('#workload');
workload.addEventListener('change', () => {
  const w = WORKLOADS[workload.value];
  $('.lanes').dataset.workload = workload.value;
  w.cpu.forEach((t, i) => { $(`[data-lane-text="cpu-${i}"]`).textContent = t; });
  w.ane.forEach((t, i) => { $(`[data-lane-text="ane-${i}"]`).textContent = t; });
  $('[data-lane-text="gpu-0"]').textContent = w.gpu;
  $('#workload-detail').textContent = w.text;
});

/* Network ------------------------------------------------------------- */
const net = toyForward();
const STAGES = ['Input', 'Preprocessing', 'Neural layers', 'Output scores'];
const STAGE_TEXT = [
  `A 2×2 grayscale image. Each pixel is an intensity from 0 (black) to 100 (white): ${net.raw.flat().join(', ').replace(/, (\d+)$/, ' and $1')}.`,
  `Divide every pixel by 100 so values sit between 0 and 1. This normalized grid is the input matrix X.`,
  `Multiply X by the weight matrix W, apply ReLU (negatives become 0), then average each column: pooled = [${net.pooled.map(fmt).join(', ')}].`,
  `Multiply the pooled values by a readout matrix and apply softmax, so the three scores sum to 1. ${net.classes.map((c, i) => `${c} ${fmt(net.scores[i])}`).join(', ')}.`,
];
// Phone view zooms the viewBox onto the current stage so labels stay legible.
const STAGE_VIEW = ['16 0 240 330', '256 0 240 330', '496 0 240 330', '720 0 240 330'];
const narrow = matchMedia('(max-width: 599px)');
const netFig = $('.network');
const netSvg = $('svg', netFig);
const prevBtn = $('#network-prev');
const nextBtn = $('#network-next');
const playBtn = $('#network-play');
const speedSel = $('#network-speed');
const hint = $('#network-hint');
const clock = $('.clock');
let stage = 0;
let playing = false;
let timer = 0;
let networkVisible = true;
const WAITING = 'Waiting: animations are paused for the whole page. Resume animations to continue, or step manually.';

// Fill every value from the computed model rather than trusting the static markup.
const put = (key, v) => { $(`[data-val="${key}"]`, netFig).textContent = v; };
net.raw.forEach((row, r) => row.forEach((v, c) => {
  put(`raw-${r}-${c}`, v);
  const g = Math.round((v / 100) * 255);
  $(`[data-px="${r * 2 + c}"]`, netFig).setAttribute('fill', `rgb(${g},${g},${g})`);
}));
net.input.forEach((row, r) => row.forEach((v, c) => put(`x-${r}-${c}`, fmt(v))));
net.hidden.forEach((row, r) => row.forEach((v, c) => put(`h-${r}-${c}`, fmt(v))));
net.pooled.forEach((v, i) => put(`p-${i}`, fmt(v)));
net.scores.forEach((v, i) => {
  put(`s-${i}`, fmt(v));
  $(`[data-score="${i}"]`, netFig).setAttribute('width', (v * 160).toFixed(1));
});

function renderNetwork() {
  netFig.dataset.stage = stage;
  $('#network-stage').textContent = STAGES[stage];
  $('#network-status').textContent = `${stage + 1} of 4`;
  $('#network-text').textContent = STAGE_TEXT[stage];
  prevBtn.disabled = stage === 0;
  nextBtn.disabled = stage === 3;
  playBtn.textContent = playing ? 'Pause network' : 'Play network';
  playBtn.dataset.playing = String(playing);
  netSvg.setAttribute('viewBox', narrow.matches ? STAGE_VIEW[stage] : '0 0 960 330');
}

// Single source of truth for the autoplay timer: always cleared, rescheduled only when allowed.
function syncNetwork() {
  clearTimeout(timer);
  timer = 0;
  clock.classList.remove('is-ticking');
  if (playing && globallyPaused) hint.textContent = WAITING;
  else if (hint.textContent === WAITING) hint.textContent = '';
  if (!playing || globallyPaused || !networkVisible || document.hidden || stage >= 3) return;
  const ms = 2600 / Number(speedSel.value);
  clock.style.setProperty('--tick', `${ms}ms`);
  void clock.offsetWidth; // restart the CSS clock from empty
  clock.classList.add('is-ticking');
  timer = setTimeout(() => { timer = 0; goTo(stage + 1); }, ms);
}

function goTo(n) {
  stage = Math.max(0, Math.min(3, n));
  if (stage === 3 && playing) {
    playing = false;
    hint.textContent = 'Reached the output scores. Play again to restart from the input.';
  }
  renderNetwork();
  syncNetwork();
}

prevBtn.addEventListener('click', () => goTo(stage - 1));
nextBtn.addEventListener('click', () => goTo(stage + 1));
speedSel.addEventListener('change', syncNetwork);
narrow.addEventListener('change', renderNetwork);
playBtn.addEventListener('click', () => {
  hint.textContent = '';
  if (playing) {
    playing = false;
  } else {
    if (stage === 3) stage = 0;
    playing = true;
    if (globallyPaused) {
      // Playing is an explicit request for motion, so resume globally and say so.
      setMotion(false, 'Animations resumed to play the network');
      hint.textContent = 'Animations were paused, so pressing Play resumed them for the whole page.';
    }
  }
  renderNetwork();
  syncNetwork();
});

/* Matrix panel -------------------------------------------------------- */
const mathToggle = $('#math-toggle');
const mathPanel = $('#math-panel');
mathToggle.addEventListener('click', () => {
  const open = mathPanel.hidden;
  mathPanel.hidden = !open;
  mathToggle.setAttribute('aria-expanded', String(open));
  mathToggle.textContent = open ? 'Hide the matrix multiplication' : 'Show the matrix multiplication';
});
const mathCells = $$('[data-math-row]');
function selectCell(r, c) {
  press(mathCells, (b) => +b.dataset.mathRow === r && +b.dataset.mathCol === c);
  $$('[data-x], [data-w]', mathPanel).forEach((el) => {
    const [i, j] = (el.dataset.x || el.dataset.w).split('-').map(Number);
    el.classList.toggle('is-hot', el.dataset.x ? i === r : j === c);
  });
  const a = net.input[r];
  const w = net.weights.map((row) => row[c]);
  const p = a.map((v, k) => v * w[k]);
  const expr = $('#math-expression');
  expr.textContent = '';
  expr.append(
    `Row ${r + 1} of X with column ${c + 1} of W: ${fmt(a[0])} × ${fmt(w[0])} = ${fmt(p[0])}, plus ${fmt(a[1])} × ${fmt(w[1])} = ${fmt(p[1])}. `,
    Object.assign(document.createElement('b'), { textContent: `Sum = ${fmt(net.preActivation[r][c])}` }),
  );
}
mathCells.forEach((b) => {
  const [r, c] = [+b.dataset.mathRow, +b.dataset.mathCol];
  b.textContent = fmt(net.preActivation[r][c]);
  b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ${fmt(net.preActivation[r][c])}`);
  b.addEventListener('click', () => selectCell(r, c));
});
$$('[data-x]', mathPanel).forEach((el) => { const [i, j] = el.dataset.x.split('-'); el.textContent = fmt(net.input[i][j]); });
$$('[data-w]', mathPanel).forEach((el) => { const [i, j] = el.dataset.w.split('-'); el.textContent = fmt(net.weights[i][j]); });
selectCell(0, 0);

/* Core ML ------------------------------------------------------------- */
const MASKS = { all: ['cpu', 'gpu', 'ane'], cpuOnly: ['cpu'], cpuAndGPU: ['cpu', 'gpu'], cpuAndNeuralEngine: ['cpu', 'ane'] };
const SCENARIO_TEXT = {
  compatible: 'Every layer uses widely supported operations.',
  mixed: 'Some layers (hollow, dashed) use operations the Neural Engine can\'t run.',
  restricted: 'The app narrows the allowed compute units, for example to keep the GPU free for graphics.',
};
const UNIT_TEXT = {
  all: '.all allows every available unit, and the system picks the best one, which can include the Neural Engine.',
  cpuOnly: '.cpuOnly allows only the CPU, so the GPU and Neural Engine routes are cut.',
  cpuAndGPU: '.cpuAndGPU allows the CPU and GPU, and explicitly not the Neural Engine.',
  cpuAndNeuralEngine: '.cpuAndNeuralEngine allows the CPU and the Neural Engine, and explicitly not the GPU. It is not "Neural Engine only": the CPU stays available.',
};
const scenarioSel = $('#coreml-scenario');
const unitsSel = $('#compute-units');
const routesFig = $('.routes');
function renderCoreML() {
  const s = scenarioSel.value;
  const u = unitsSel.value;
  const allowed = MASKS[u];
  routesFig.dataset.scenario = s;
  routesFig.dataset.units = u;
  ['cpu', 'gpu', 'ane'].forEach((id) => {
    const ok = allowed.includes(id);
    $(`[data-route="${id}"]`, routesFig).classList.toggle('is-blocked', !ok);
    $(`[data-route="${id}"]`, routesFig).classList.toggle('is-active', ok);
    const node = $(`[data-unit="${id}"]`, routesFig);
    node.classList.toggle('is-blocked', !ok);
    $('.unit-state', node).textContent = !ok ? 'Not allowed'
      : s === 'mixed' && id === 'ane' ? 'Allowed, supported layers' : 'Allowed, any layer';
  });
  const parts = [SCENARIO_TEXT[s], UNIT_TEXT[u]];
  if (s === 'mixed') {
    if (allowed.includes('ane')) parts.push('Supported layers may run on the Neural Engine; the rest need an allowed CPU or GPU path.');
    parts.push('Permission doesn\'t make an operation compatible: a model with operations no allowed unit supports may need conversion or adaptation, or may fail.');
  }
  if (s === 'restricted') {
    parts.push('The setting is a filter, not a placement order: the system still chooses within what is left.');
    if (u === 'all') parts.push('Pick a narrower setting to see the filter cut routes.');
  }
  if (s === 'compatible') parts.push('Which allowed unit actually runs each layer is decided at run time and depends on the model, OS and hardware.');
  $('#coreml-detail').replaceChildren(Object.assign(document.createElement('p'), { textContent: parts.join(' ') }));
}
scenarioSel.addEventListener('change', renderCoreML);
unitsSel.addEventListener('change', renderCoreML);

/* Memory -------------------------------------------------------------- */
const MEMORY_TEXT = {
  separate: 'With separate pools, weights and inputs are prepared in CPU memory, then copied into GPU memory before the GPU can start. Results often travel back the same way, and both copies take space.',
  unified: 'Weights, activations and outputs live in one pool. Each unit reads the same data, but work that depends on another unit\'s result still has to wait for it to finish.',
};
const memButtons = $$('[data-memory-mode]');
memButtons.forEach((b) => b.addEventListener('click', () => {
  press(memButtons, (x) => x === b);
  $('.mem').dataset.mode = b.dataset.memoryMode;
  $('#memory-detail p').textContent = MEMORY_TEXT[b.dataset.memoryMode];
}));

/* Runtimes ------------------------------------------------------------ */
const RUNTIMES = {
  mlx: {
    name: 'MLX / MLX-LM / oMLX', paths: ['cpu', 'metal', 'metal-gpu'], hw: { cpu: 'Possible', gpu: 'Via Metal', ane: 'Not used' },
    text: $('#runtime-detail p').textContent,
  },
  llama: {
    name: 'llama.cpp, Metal build', paths: ['cpu', 'metal', 'metal-gpu'], hw: { cpu: 'Hybrid layers', gpu: 'Via Metal', ane: 'Not used' },
    text: 'llama.cpp\'s build guide says that using Metal makes the computation run on the GPU, and it can split work between CPU and GPU. Offloading to the GPU through Metal is not offloading to the Neural Engine.',
  },
  coreml: {
    name: 'Core ML', paths: ['cpu', 'gpu-direct', 'ane'], hw: { cpu: 'Possible', gpu: 'Possible', ane: 'If supported' },
    text: 'Core ML is the route in this exhibit that can reach the Neural Engine. A converted model may use the CPU, GPU or Neural Engine, depending on the allowed compute units and which operations each supports.',
  },
};
const runtimeButtons = $$('[data-runtime]');
const stack = $('.stack');
runtimeButtons.forEach((b) => b.addEventListener('click', () => {
  const rt = RUNTIMES[b.dataset.runtime];
  press(runtimeButtons, (x) => x === b);
  stack.dataset.stack = b.dataset.runtime;
  $('#stack-fw').textContent = rt.name;
  $$('.sp', stack).forEach((p) => p.classList.toggle('is-active', rt.paths.includes(p.dataset.path)));
  $$('.hw', stack).forEach((h) => {
    h.classList.toggle('is-active', rt.hw[h.dataset.hw] !== 'Not used');
    $('.hw-state', h).textContent = rt.hw[h.dataset.hw];
  });
  $('#runtime-detail p').textContent = rt.text;
}));

/* Playground ---------------------------------------------------------- */
const pgForm = $('#playground-form');
const pgInputs = { modelSize: $('#model-size'), inputSize: $('#input-size'), concurrency: $('#concurrency') };
function renderPlayground() {
  const r = evaluatePlayground({
    modelSize: +pgInputs.modelSize.value,
    inputSize: +pgInputs.inputSize.value,
    concurrency: +pgInputs.concurrency.value,
    compatible: $('#compatible').checked,
  });
  Object.values(pgInputs).forEach((el) => { $(`[data-range-for="${el.id}"]`).textContent = `${el.value} of ${el.max}`; });
  Object.entries(r.metrics).forEach(([k, v]) => {
    $(`output[data-metric="${k}"]`).textContent = v;
    $(`[data-meter="${k}"]`).dataset.level = LEVELS.indexOf(v);
  });
  $('output[data-metric="eligibility"]').textContent = r.eligibility;
  $('[data-notes]').replaceChildren(...r.notes.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
}
pgForm.addEventListener('input', renderPlayground);
pgForm.addEventListener('change', renderPlayground);
pgForm.addEventListener('submit', (e) => e.preventDefault());

/* Visibility: offscreen sections stop animating, nav tracks position --- */
const navLinks = $$('.chapters a');
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  e.target.classList.toggle('is-offscreen', !e.isIntersecting);
  if (e.target.id === 'network') { networkVisible = e.isIntersecting; syncNetwork(); }
}), { rootMargin: '80px 0px' });
const spy = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) navLinks.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${e.target.id}`)));
}), { rootMargin: '-45% 0px -50% 0px' });
$$('main > section').forEach((s) => { io.observe(s); spy.observe(s); });
document.addEventListener('visibilitychange', syncNetwork);

/* Initial state ------------------------------------------------------- */
renderNetwork();
renderCoreML();
renderPlayground();
$('[data-runtime="mlx"]').click();
setMotion(reduced.matches, reduced.matches ? 'Paused for your reduced-motion setting' : undefined);
