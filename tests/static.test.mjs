import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { toyForward } from '../model.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// Opening tag that carries the given attribute fragment.
const tag = (frag) => {
  const m = html.match(new RegExp(`<[a-z]+[^>]*${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`));
  assert.ok(m, `missing element with ${frag}`);
  return m[0];
};
const options = (id) => {
  const block = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`));
  assert.ok(block, `missing select #${id}`);
  return [...block[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
};

test('JavaScript files pass node --check', () => {
  for (const f of ['app.js', 'model.js']) {
    const r = spawnSync(process.execPath, ['--check', new URL(f, root).pathname], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
});

test('eight sections in order, with real chapter links', () => {
  const ids = ['overview', 'processors', 'network', 'coreml', 'memory', 'local-llm', 'playground', 'takeaways'];
  const found = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(found, ids);
  ids.forEach((id) => assert.match(html, new RegExp(`<a href="#${id}">`)));
  assert.match(tag('id="explore"'), /href="#processors"/);
  assert.match(html, /<h1 id="overview-title">Inside the Neural Engine<\/h1>/);
});

test('hero leads with a short lede, CTA, then the chip; primer is optional and later', () => {
  const hero = html.match(/<section id="overview"[\s\S]*?<\/section>/)[0];
  assert.match(hero, /id="explore"[^>]*>Explore how it works</);
  const lede = hero.match(/<p class="lede">([^<]+)</)[1];
  assert.ok(lede.split(/\s+/).length <= 25, `lede too long: ${lede}`);
  const chipAt = hero.indexOf('data-component="cpu"');
  assert.ok(hero.indexOf('id="explore"') < chipAt, 'CTA before chip');
  assert.ok(hero.indexOf('<details class="hero-more">') > chipAt, 'primer after chip');
  assert.match(hero, /<details class="hero-more">[\s\S]*neural-engine-transformers/);
});

test('Core ML figure labels the app and Core ML, with packet groups and legend', () => {
  const fig = html.match(/<figure class="plate routes"[\s\S]*?<\/figure>/)[0];
  assert.match(fig, />Application</);
  assert.match(fig, />Core ML</);
  for (const u of ['cpu', 'gpu', 'ane']) assert.match(fig, new RegExp(`data-packets="${u}"`));
  assert.match(fig, /One possible example, not the runtime's plan/);
  assert.match(fig, /Permitted route/);
  assert.match(css, /html\[data-motion="paused"\] \.packets \.pkt \{ animation: none; \}/);
  assert.match(css, /html\[data-page-hidden="true"\] \*/);
  assert.match(css, /html\[data-motion="paused"\] \{ scroll-behavior: auto; \}/);
});

test('global motion toggle starts in the running state', () => {
  const t = tag('id="motion-toggle"');
  assert.match(t, /<button/);
  assert.match(t, /aria-pressed="false"/);
  assert.match(html, /id="motion-toggle"[^>]*>Pause animations</);
  assert.match(app, /'Resume animations'/);
});

test('chip components are real pressed-state buttons with labels', () => {
  const labels = { cpu: 'CPU', gpu: 'GPU', ane: 'Neural Engine', memory: 'Unified memory' };
  for (const [id, label] of Object.entries(labels)) {
    const t = tag(`data-component="${id}"`);
    assert.match(t, /^<button/);
    assert.match(t, /aria-pressed="(true|false)"/);
    assert.match(html, new RegExp(`data-component="${id}"[^>]*>\\s*<span class="hit-name">${label}</span>`));
  }
  assert.equal((html.match(/data-component=/g) || []).length, 4);
  assert.match(text, /Conceptual diagram—not a literal die layout/);
  assert.match(html, /id="component-detail"/);
});

test('form controls expose the frozen values', () => {
  assert.deepEqual(options('workload'), ['image', 'speech', 'video', 'llm']);
  assert.deepEqual(options('network-speed'), ['0.5', '1', '2']);
  assert.deepEqual(options('coreml-scenario'), ['compatible', 'mixed', 'restricted']);
  assert.deepEqual(options('compute-units'), ['all', 'cpuOnly', 'cpuAndGPU', 'cpuAndNeuralEngine']);
  for (const id of ['network-prev', 'network-next', 'network-play', 'math-toggle']) assert.match(tag(`id="${id}"`), /^<button/);
  assert.match(html, /id="network-play"[^>]*>Play network</);
  assert.match(html, /<span id="network-stage">Input</);
  assert.match(tag('id="math-toggle"'), /aria-expanded="false"/);
  assert.match(tag('id="math-panel"'), /\shidden[\s>]/);
  for (const r of [0, 1]) for (const c of [0, 1]) assert.match(tag(`data-math-row="${r}" data-math-col="${c}"`), /^<button/);
  for (const id of ['workload-detail', 'network-status', 'math-expression', 'coreml-detail', 'memory-detail', 'runtime-detail', 'playground-results']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const m of ['separate', 'unified']) assert.match(tag(`data-memory-mode="${m}"`), /^<button[^>]*aria-pressed/);
  for (const r of ['mlx', 'llama', 'coreml']) assert.match(tag(`data-runtime="${r}"`), /^<button[^>]*aria-pressed/);
  assert.equal((html.match(/data-runtime=/g) || []).length, 3, 'data-runtime only on buttons');
});

test('playground ranges, checkbox, outputs and caveat', () => {
  const ranges = { 'model-size': [1, 5], 'input-size': [1, 5], concurrency: [1, 8] };
  for (const [id, [min, max]] of Object.entries(ranges)) {
    const t = tag(`id="${id}" type="range"`);
    assert.match(t, new RegExp(`min="${min}"`));
    assert.match(t, new RegExp(`max="${max}"`));
  }
  assert.match(tag('id="compatible"'), /type="checkbox"[^>]*checked/);
  for (const k of ['latency', 'memoryPressure', 'throughput', 'energyDemand']) assert.match(html, new RegExp(`<output data-metric="${k}">`));
  assert.match(text, /Illustrative simulation—not hardware benchmarks/);
  assert.match(text, /Illustrative execution paths—not live telemetry or a prediction of Core ML scheduling/);
});

test('no performance numbers or overclaims in visible copy', () => {
  assert.doesNotMatch(text, /\bTOPS\b|\d\s?(ms|W|watts?|tok\/s|tokens\/s|GB\/s)\b|speedup of|\d+-core|\d+ cores/i);
  assert.doesNotMatch(text, /ANE-only|transformers cannot/i);
  assert.match(app, /explicitly not the GPU/);
  assert.match(app, /explicitly not the Neural Engine/);
  assert.match(app, /may fail/);
  assert.match(text, /not affiliated with or endorsed by Apple/);
});

test('static network numbers agree with the computed model', () => {
  const r = toyForward();
  const fmt = (v) => v.toFixed(2).replace('-', '−');
  const val = (k) => html.match(new RegExp(`data-val="${k}">([^<]+)<`))[1];
  r.input.forEach((row, i) => row.forEach((v, j) => assert.equal(val(`x-${i}-${j}`), fmt(v))));
  r.hidden.forEach((row, i) => row.forEach((v, j) => assert.equal(val(`h-${i}-${j}`), fmt(v))));
  r.pooled.forEach((v, i) => assert.equal(val(`p-${i}`), fmt(v)));
  r.scores.forEach((v, i) => assert.equal(val(`s-${i}`), fmt(v)));
});

test('glossary covers all eleven terms', () => {
  const terms = [...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  const want = ['NPU / ANE', 'Inference', 'Tensor', 'Matrix multiplication', 'Model weights', 'Activations', 'Quantization', 'Unified memory', 'Core ML', 'MLX', 'Metal'];
  want.forEach((w) => assert.ok(terms.includes(w), w));
});

test('sources list exactly the audited primary URLs', () => {
  const block = html.match(/<ol id="sources"[\s\S]*?<\/ol>/)[0];
  const urls = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, [
    'https://apple.github.io/coremltools/docs-guides/source/model-prediction.html',
    'https://apple.github.io/coremltools/mlmodel/Format/NeuralNetwork.html',
    'https://developer.apple.com/documentation/coreml',
    'https://developer.apple.com/documentation/coreml/mlcomputeunits',
    'https://developer.apple.com/metal/',
    'https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md',
    'https://github.com/jundot/omlx',
    'https://github.com/ml-explore/mlx',
    'https://github.com/ml-explore/mlx-lm',
    'https://machinelearning.apple.com/research/neural-engine-transformers',
    'https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html',
    'https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/',
  ]);
  const allLinks = new Set([...html.matchAll(/href="(https:[^"]+)"/g)].map((m) => m[1]));
  allLinks.forEach((u) => assert.ok(urls.includes(u), `inline citation not in #sources: ${u}`));
});

test('all assets are local relative paths that exist (GitHub Pages subpath safe)', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('https://'));
  refs.forEach((u) => {
    assert.doesNotMatch(u, /^\/|^http:/, u);
    assert.ok(existsSync(new URL(u, root)), `missing ${u}`);
  });
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/);
  [...css.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:')).forEach((u) => {
    assert.doesNotMatch(u, /^\/|^https?:/);
    assert.ok(existsSync(new URL(u, root)), `missing ${u}`);
  });
  for (const f of ['assets/fonts/OFL-BarlowCondensed.txt', 'assets/fonts/OFL-PublicSans.txt', '.nojekyll', 'LICENSE']) assert.ok(existsSync(new URL(f, root)), f);
});

test('no network calls, storage or telemetry in app code', () => {
  assert.doesNotMatch(app, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|WebSocket|navigator\.gpu/);
  assert.match(app, /from '\.\/model\.js'/);
});

test('CSS gates motion and keeps targets large', () => {
  assert.match(css, /html\[data-motion="paused"\][^{]*\{\s*animation-play-state: paused !important/);
  assert.match(css, /\.is-offscreen \*/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 599px\)/);
  assert.match(css, /\.no-js \.needs-js/);
});
