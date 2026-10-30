#!/usr/bin/env node
'use strict';
// Real-browser acceptance journey for "Inside the Neural Engine" against the frozen DOM contract.
// Usage: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/browser-exhibit.cjs [baseURL] [artifactDir]
// No baseURL: serves this repo read-only at http://127.0.0.1:8272 (Node http). A baseURL (incl. https live site)
// is used as-is; serve the build yourself. Artifacts default to /tmp/ane-independent-shots (never inside the repo).
// Exit codes: 0 all steps pass, 1 failures, 2 blocked (no app / no Playwright / bad args).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const URL_ARG = process.argv[2];
const RAW = URL_ARG || 'http://127.0.0.1:8272';
const BASE = /\.html?$/.test(RAW) ? RAW : RAW.replace(/\/*$/, '/');
const ORIGIN = new URL(BASE).origin;
const OUT = path.resolve(process.argv[3] || '/tmp/ane-independent-shots');
const STAY_MS = 4000; // window in which a paused/offscreen network must not advance
const ADVANCE_MS = 15000; // max wait for an autoplaying network to advance one stage
const STAGES = ['Input', 'Preprocessing', 'Neural layers', 'Output scores'];
const SECTIONS = ['overview', 'processors', 'network', 'coreml', 'memory', 'local-llm', 'playground', 'takeaways'];
const CONTROLS = ['#motion-toggle', 'button[data-component]', '#workload', '#network-prev', '#network-next', '#network-play',
  '#network-speed', '#math-toggle', '[data-math-row]', '#coreml-scenario', '#compute-units', '[data-memory-mode]',
  '[data-runtime]', '#model-size', '#input-size', '#concurrency', '#compatible'];
const VIEWPORTS = [['desktop', 1365, 900], ['tablet', 768, 1024], ['phone', 390, 844], ['narrow', 360, 800]];
const SHOT_SECTIONS = { overview: '#overview', network: '#math-panel', coreml: '#coreml', memory: '#memory', playground: '#playground' };

const blocked = (msg) => { console.error(`BLOCKED: ${msg}`); process.exit(2); };
const rel = path.relative(ROOT, OUT);
if (!(rel === '..' || rel.startsWith('..' + path.sep))) blocked(`artifact dir ${OUT} is inside the repo`);

const results = [], notes = [];
const issues = { console: [], pageErrors: [], internalBroken: [], thirdParty: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/−/g, '-').replace(/\s+/g, ' ').trim();
const text = async (loc) => norm(await loc.innerText());
const pressed = async (loc) => (await loc.getAttribute('aria-pressed')) === 'true';
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const dash = (s) => new RegExp(s.replace(' - ', '\\s*[—–-]\\s*'), 'i'); // contract caveats use an em dash
async function poll(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return !!(await fn()); }
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}

// --- static server (only when no URL is supplied) ---
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function serve() {
  const server = http.createServer((req, res) => {
    const deny = () => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); };
    let p;
    try { p = decodeURIComponent(new URL(req.url, ORIGIN).pathname); } catch { return deny(); }
    // no dotfiles/.git, no traversal, no NUL, read-only methods
    if (!['GET', 'HEAD'].includes(req.method) || p.includes('\0') || p.split('/').some((s) => s.startsWith('.'))) return deny();
    try {
      let file = fs.realpathSync(path.join(ROOT, p));
      if (fs.statSync(file).isDirectory()) file = fs.realpathSync(path.join(file, 'index.html'));
      if (!file.startsWith(ROOT + path.sep)) return deny();
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { deny(); }
  });
  return new Promise((ok, bad) => server.once('error', bad).listen(Number(new URL(BASE).port), '127.0.0.1', () => ok(server)));
}

// --- page helpers ---
function watch(page, label) {
  const own = (u) => u.startsWith(ORIGIN) || /^(data|blob|about):/.test(u);
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) issues.console.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => issues.pageErrors.push(`${label}: ${e.message}`));
  page.on('request', (r) => { if (!own(r.url())) issues.thirdParty.push(`${label}: requested ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400) (own(r.url()) ? issues.internalBroken : issues.thirdParty).push(`${label}: ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => { if (own(r.url())) issues.internalBroken.push(`${label}: failed ${r.url()} ${r.failure()?.errorText}`); });
}
async function open(browser, label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1365, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  watch(page, label);
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  return { ctx, page };
}
async function setGlobalPaused(page, want) {
  const t = page.locator('#motion-toggle');
  if ((await pressed(t)) !== want) await t.click();
  assert.ok(await poll(async () => (await pressed(t)) === want, 2000), `#motion-toggle aria-pressed should be ${want}`);
  assert.match(await text(t), want ? /Resume animations/ : /Pause animations/);
}
const stageOf = async (page) => { const t = await text(page.locator('#network-stage')); return STAGES.findIndex((s) => t.includes(s)); };
async function netPause(page) {
  const b = page.locator('#network-play');
  if (/Pause network/.test(await text(b))) await b.click();
  assert.match(await text(b), /Play network/, 'network should read "Play network" once paused');
}
async function netReset(page) {
  await page.locator('#network').scrollIntoViewIfNeeded();
  await netPause(page);
  const prev = page.locator('#network-prev');
  for (let i = 0; i < 4 && (await prev.isEnabled()); i++) await prev.click();
  assert.equal(await stageOf(page), 0, 'network should clamp at Input');
}
async function scrollSettle(page) { let last = -1; for (let i = 0; i < 40; i++) { const y = await page.evaluate(() => scrollY); if (y === last) return; last = y; await sleep(120); } }
// Layout/animation inspection only: running CSS/WAAPI animations and unpaused SMIL roots.
const motionState = (page) => page.evaluate(() => ({
  running: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || 'animation').slice(0, 5),
  smil: [...document.querySelectorAll('svg')].filter((s) => s.querySelector('animate,animateTransform,animateMotion,set') && !s.animationsPaused()).length,
}));
// Route state from [data-route] (cpu/gpu/ane by name): active = visible, ≥0.5 cumulative opacity, no inactive-style class/state.
const routeState = (sec) => sec.evaluate((root) => {
  const els = [...root.querySelectorAll('[data-route]')];
  if (!els.length) return null;
  const on = (el) => {
    const s = `${el.getAttribute('class') || ''} ${el.dataset.state || ''} ${el.dataset.active || ''} ${el.getAttribute('aria-disabled') === 'true' ? 'disabled' : ''}`;
    if (/\b(inactive|disabled|blocked|disallowed|excluded|off|dim|dimmed|false)\b/i.test(s)) return false;
    let o = 1;
    for (let n = el; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; o *= +cs.opacity; }
    return o >= 0.5;
  };
  const out = {};
  for (const el of els) { const r = el.dataset.route; const k = /ane|neural/i.test(r) ? 'ane' : /gpu/i.test(r) ? 'gpu' : /cpu/i.test(r) ? 'cpu' : null; if (k) out[k] = out[k] || on(el); }
  return out;
});

async function desktopJourney(browser) {
  const { ctx, page } = await open(browser, 'desktop');
  const toggle = page.locator('#motion-toggle'), play = page.locator('#network-play');
  try {
    await step('structure: 8 sections, hero, in-page anchors, sources, affiliation', async () => {
      for (const id of SECTIONS) assert.equal(await page.locator(`#${id}`).count(), 1, `#${id} missing`);
      assert.equal(await text(page.locator('#overview h1')), 'Inside the Neural Engine');
      assert.equal(await page.locator('#explore').getAttribute('href'), '#processors');
      const dead = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))));
      assert.deepEqual(dead, [], 'in-page anchors without targets');
      const hrefs = (await page.locator('#sources a[href^="https://"]').evaluateAll((as) => as.map((a) => a.href))).join(' ');
      for (const s of ['neural-engine-transformers', 'documentation/coreml', 'mlcomputeunits', 'coremltools', 'ml-explore/mlx', 'ml-explore.github.io/mlx', 'mlx-lm', 'llama.cpp', 'developer.apple.com/metal', 'apple-unleashes-m1', 'jundot/omlx']) assert.ok(hrefs.includes(s), `#sources lacks ${s}`);
      assert.match(norm(await page.locator('body').textContent()), /not affiliated with Apple/i);
      assert.equal(await pressed(toggle), false, 'motion starts unpaused without reduced-motion');
    });

    await step('chip: 4 components update panel, aria-pressed, dimming', async () => {
      await setGlobalPaused(page, true); // freeze pulses so opacity signatures reflect selection only
      const sec = page.locator('#overview'); // frozen contract: chip, caption and component buttons live in the hero
      await sec.scrollIntoViewIfNeeded();
      assert.match(norm(await sec.textContent()), dash('Conceptual diagram - not a literal die layout'));
      const details = new Set(), sigs = new Set();
      for (const [c, label] of [['cpu', /CPU/], ['gpu', /GPU/], ['ane', /Neural Engine/i], ['memory', /Unified memory/i]]) {
        const btn = sec.locator(`button[data-component="${c}"]`).first();
        assert.match(norm(`${await btn.getAttribute('aria-label') || ''} ${await btn.textContent()}`), label);
        await btn.click();
        await sleep(450);
        for (const b of await sec.locator('button[data-component]').all()) assert.equal(await pressed(b), (await b.getAttribute('data-component')) === c, `aria-pressed after selecting ${c}`);
        details.add(await text(page.locator('#component-detail')));
        sigs.add(await sec.evaluate((s) => [...s.querySelectorAll('svg *')].map((e) => { const cs = getComputedStyle(e); return `${cs.opacity}|${cs.filter}`; }).join(',')));
        assert.ok(await btn.evaluate((el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o >= 0.9; }), `selected ${c} stays fully legible`);
      }
      assert.equal(details.size, 4, '#component-detail should differ per component');
      assert.equal(sigs.size, 4, 'SVG dimming should differ per selected component');
      await setGlobalPaused(page, false);
    });

    await step('workload: 4 options update #workload-detail (CPU/GPU/ANE roles)', async () => {
      const seen = new Set();
      for (const v of ['image', 'speech', 'video', 'llm']) {
        await page.selectOption('#workload', v);
        const d = await text(page.locator('#workload-detail'));
        for (const re of [/CPU/, /GPU/, /Neural Engine|ANE/]) assert.match(d, re, `${v} detail`);
        seen.add(d);
      }
      assert.equal(seen.size, 4);
    });

    await step('network: manual stepping clamped 0..3, speeds, stage labels', async () => {
      await netReset(page);
      const prev = page.locator('#network-prev'), next = page.locator('#network-next');
      assert.ok(await prev.isDisabled(), 'prev disabled at Input');
      for (let i = 1; i < 4; i++) { await next.click(); assert.equal(await stageOf(page), i); }
      assert.ok(await next.isDisabled(), 'next disabled at Output scores');
      if (await page.locator('#network-status').count()) assert.match(await text(page.locator('#network-status')), /4\D+4/);
      await prev.click();
      assert.equal(await stageOf(page), 2);
      for (const s of ['0.5', '1', '2']) { await page.selectOption('#network-speed', s); assert.equal(await page.locator('#network-speed').inputValue(), s); }
    });

    await step('math panel: toggle semantics and 4 computed cells', async () => {
      const tog = page.locator('#math-toggle'), panel = page.locator('#math-panel');
      assert.equal(await tog.getAttribute('aria-expanded'), 'false');
      assert.ok(await panel.isHidden(), '#math-panel hidden when closed');
      await tog.click();
      assert.equal(await tog.getAttribute('aria-expanded'), 'true');
      assert.ok(await panel.isVisible());
      const EXP = { '00': [1, 0.8, 0.5, 0.2, 0.9], '01': [1, -0.4, 0.5, 0.9, 0.05], '10': [0.25, 0.8, 1, 0.2, 0.4], '11': [0.25, -0.4, 1, 0.9, 0.8] };
      for (const [rc, exp] of Object.entries(EXP)) {
        const cell = panel.locator(`[data-math-row="${rc[0]}"][data-math-col="${rc[1]}"]`);
        await cell.click();
        const expr = await text(page.locator('#math-expression'));
        const nums = (expr.match(/-?\d*\.?\d+/g) || []).map(Number);
        for (const e of exp) assert.ok(nums.some((n) => Math.abs(n - e) < 0.006), `cell ${rc}: expression "${expr}" lacks ${e}`);
        assert.match(expr, /row/i); assert.match(expr, /col/i); assert.match(expr, /sum|\+|Σ/i);
        const label = norm(`${await cell.getAttribute('aria-label') || ''} ${await cell.textContent()}`);
        assert.ok((label.match(/-?\d*\.?\d+/g) || []).map(Number).some((n) => Math.abs(n - exp[4]) < 0.006), `cell ${rc} label shows ${exp[4]}`);
        const states = await panel.locator('[data-math-row]').evaluateAll((els) => els.map((el) => `${el.dataset.mathRow}${el.dataset.mathCol}:${['aria-pressed', 'aria-selected', 'aria-current'].some((a) => el.getAttribute(a) === 'true')}`));
        assert.deepEqual(states.filter((s) => s.endsWith('true')), [`${rc}:true`], `only cell ${rc} selected (aria-pressed/selected/current)`);
      }
      await tog.click();
      assert.equal(await tog.getAttribute('aria-expanded'), 'false');
      assert.ok(await panel.isHidden());
    });

    await step('network autoplay advances; manual step pauses with no stale timer', async () => {
      await setGlobalPaused(page, false);
      await netReset(page);
      await page.selectOption('#network-speed', '2');
      await play.click();
      assert.match(await text(play), /Pause network/);
      assert.ok(await poll(async () => (await stageOf(page)) > 0, ADVANCE_MS), 'autoplay did not advance while visible and unpaused');
      const btn = (await page.locator('#network-next').isEnabled()) ? page.locator('#network-next') : page.locator('#network-prev');
      await btn.click();
      assert.match(await text(play), /Play network/, 'manual step should pause autoplay');
      const s = await stageOf(page);
      await sleep(STAY_MS);
      assert.equal(await stageOf(page), s, 'stale timer advanced stage after manual step');
    });

    await step('global pause halts network clock, CSS/SVG animations, and visuals', async () => {
      await netReset(page);
      await play.click();
      await setGlobalPaused(page, true);
      await sleep(600);
      const s = await stageOf(page);
      const m = await motionState(page);
      assert.deepEqual(m.running, [], 'CSS/WAAPI animations still running while paused');
      assert.equal(m.smil, 0, 'SVG SMIL animations not paused');
      for (const id of ['#network', '#processors']) {
        await page.locator(id).scrollIntoViewIfNeeded(); await scrollSettle(page); await frames(page);
        const a = await page.screenshot(); await sleep(700); await frames(page);
        assert.ok(a.equals(await page.screenshot()), `${id} still visually animating while paused`);
      }
      await page.locator('#network').scrollIntoViewIfNeeded();
      await sleep(STAY_MS);
      assert.equal(await stageOf(page), s, 'network advanced while globally paused');
      const before = await stageOf(page);
      await page.locator(before < 3 ? '#network-next' : '#network-prev').click();
      assert.notEqual(await stageOf(page), before, 'manual step must work while globally paused');
    });

    await step('network play while globally paused is never a silent no-op', async () => {
      await netReset(page);
      const before = await text(page.locator('#network'));
      await play.click();
      await sleep(300);
      if (/Pause network/.test(await text(play))) assert.ok(await poll(async () => (await stageOf(page)) > 0, ADVANCE_MS), '"Pause network" shown but stage never advances under global pause');
      else assert.notEqual(await text(page.locator('#network')), before, 'play click under global pause neither plays nor explains');
      notes.push(`play under global pause: global now ${(await pressed(toggle)) ? 'paused' : 'resumed'}, button "${await text(play)}"`);
    });

    await step('global resume does not restart a manually paused network', async () => {
      await setGlobalPaused(page, true);
      await netReset(page);
      await setGlobalPaused(page, false);
      await sleep(STAY_MS);
      assert.match(await text(play), /Play network/);
      assert.equal(await stageOf(page), 0);
    });

    await step('network pauses offscreen and in a hidden tab', async () => {
      await setGlobalPaused(page, false);
      await netReset(page);
      await page.selectOption('#network-speed', '1');
      await play.click();
      await page.locator('#takeaways').scrollIntoViewIfNeeded(); await scrollSettle(page); await sleep(600);
      const s = await stageOf(page);
      await sleep(STAY_MS);
      assert.equal(await stageOf(page), s, 'network advanced while offscreen');
      await page.locator('#network').scrollIntoViewIfNeeded();
      assert.ok(await poll(async () => (await stageOf(page)) !== s, ADVANCE_MS), 'network did not resume when visible again');
      const other = await ctx.newPage();
      await other.bringToFront();
      if ((await page.evaluate(() => document.visibilityState)) === 'hidden') {
        const h = await stageOf(page); await sleep(STAY_MS);
        assert.equal(await stageOf(page), h, 'network advanced in hidden tab');
      } else notes.push('hidden-tab check skipped: this browser kept the background page visible');
      await other.close(); await page.bringToFront();
      await netPause(page);
    });

    await step('Core ML: 3 scenarios x 4 compute-unit permissions, routes and caveats', async () => {
      const sec = page.locator('#coreml');
      await sec.scrollIntoViewIfNeeded();
      assert.match(norm(await sec.textContent()), dash('Illustrative execution paths - not live telemetry or a prediction of Core ML scheduling'));
      let positive = false;
      for (const scen of ['compatible', 'mixed', 'restricted']) {
        await page.selectOption('#coreml-scenario', scen);
        const seen = new Set();
        for (const unit of ['all', 'cpuOnly', 'cpuAndGPU', 'cpuAndNeuralEngine']) {
          await page.selectOption('#compute-units', unit);
          await sleep(400);
          const d = await text(page.locator('#coreml-detail')), id = `${scen}/${unit}`;
          seen.add(d);
          assert.match(d, /permi|allow/i, `${id} detail should frame compute units as permission`);
          assert.doesNotMatch(d.replace(/\b(not|no|never|doesn't|does not|isn't)\b[^.]{0,30}guarantee\w*/gi, ''), /\bguarantee[sd]?\b|\bwill always run\b/i, `${id} promises placement`);
          if (unit === 'cpuAndNeuralEngine') assert.doesNotMatch(d, /\b(ANE|Neural Engine)[- ]only\b|\bonly (on )?the (ANE|Neural Engine)\b/i, 'cpuAndNeuralEngine is CPU+ANE, not ANE-only');
          const r = await routeState(sec);
          if (r) {
            if (unit === 'cpuOnly') assert.ok(!r.gpu && !r.ane, `${id}: GPU/ANE route drawn active`);
            if (unit === 'cpuAndGPU') assert.ok(!r.ane, `${id}: ANE route drawn active`);
            if (unit === 'cpuAndNeuralEngine') assert.ok(!r.gpu, `${id}: GPU route drawn active`);
            if (scen === 'compatible' && unit === 'all') positive = !!r.ane;
          } else if (unit !== 'all') assert.match(d, /\b(not|no|excluded|never|without)\b/i, `${id} should say which units are excluded`);
        }
        assert.equal(seen.size, 4, `${scen}: detail should change per compute-unit setting`);
      }
      if (await sec.locator('[data-route]').count()) assert.ok(positive, '[data-route] ANE path never active even for compatible/all (route signal unreadable)');
      else notes.push('Core ML: no [data-route] elements; route checks used #coreml-detail text');
    });

    await step('memory: separate vs unified diagram, detail, aria, labels', async () => {
      await setGlobalPaused(page, true);
      const sec = page.locator('#memory');
      await sec.scrollIntoViewIfNeeded(); await scrollSettle(page);
      const shots = [], details = [];
      for (const m of ['separate', 'unified']) {
        await sec.locator(`[data-memory-mode="${m}"]`).click();
        await sleep(600);
        for (const b of await sec.locator('[data-memory-mode]').all()) assert.equal(await pressed(b), (await b.getAttribute('data-memory-mode')) === m);
        details.push(await text(page.locator('#memory-detail')));
        shots.push(await sec.screenshot({ mask: [page.locator('#memory-detail'), sec.locator('[data-memory-mode]')] }));
      }
      assert.notEqual(details[0], details[1]);
      assert.ok(!shots[0].equals(shots[1]), 'memory diagram did not visibly change between modes');
      const all = norm(await sec.textContent());
      for (const re of [/weights/i, /activations/i, /outputs?/i, /synchroni[sz]/i]) assert.match(all, re);
      assert.doesNotMatch(details[1], /\bno (synchroni[sz]ation|sync|transfers?|data movement)\b|\bzero[- ]copy everywhere\b/i);
      await setGlobalPaused(page, false);
    });

    await step('local LLM runtimes: MLX / llama.cpp / Core ML explanations and routes', async () => {
      const sec = page.locator('#local-llm');
      await sec.scrollIntoViewIfNeeded();
      const seen = new Set();
      for (const [rt, res, ane] of [['mlx', [/GPU/], false], ['llama', [/Metal/, /GPU/], false], ['coreml', [/Neural Engine|ANE/], true]]) {
        await sec.locator(`[data-runtime="${rt}"]`).click();
        await sleep(400);
        for (const b of await sec.locator('[data-runtime]').all()) assert.equal(await pressed(b), (await b.getAttribute('data-runtime')) === rt);
        const d = await text(page.locator('#runtime-detail'));
        for (const re of res) assert.match(d, re, `${rt} detail`);
        seen.add(d);
        const r = await routeState(sec);
        if (r) assert.equal(!!r.ane, ane, `${rt}: ANE route highlight should be ${ane}`);
      }
      assert.equal(seen.size, 3);
      const all = norm(await sec.textContent());
      for (const s of ['MLX-LM', 'oMLX', 'llama.cpp', 'Metal', 'Core ML', 'Qwen']) assert.ok(all.includes(s), `#local-llm lacks ${s}`);
      assert.match(all, /MLX[^.]{0,80}\b(framework|software|library)\b/i);
      assert.match(all, /Metal[^.]{0,80}\bGPU\b/i);
      for (const sent of all.split(/(?<=[.!?])\s+/).filter((x) => /Qwen/.test(x) && /ANE|Neural Engine/.test(x))) assert.match(sent, /\b(not|no|doesn't|does not|isn't|without|rather than)\b/i, `Qwen sentence implies ANE: "${sent}"`);
    });

    await step('playground: ranges min/max + checkbox change results, deterministic restore', async () => {
      const sec = page.locator('#playground'), res = () => text(page.locator('#playground-results'));
      await sec.scrollIntoViewIfNeeded();
      assert.match(norm(await sec.textContent()), dash('Illustrative simulation - not hardware benchmarks'));
      const reqs = []; const onReq = (r) => reqs.push(r.url()); page.on('request', onReq);
      const orig = await res();
      for (const re of [/latency/i, /memory/i, /throughput/i, /energy/i]) assert.match(orig, re);
      for (const [id, min, max] of [['#model-size', 1, 5], ['#input-size', 1, 5], ['#concurrency', 1, 8]]) {
        const r = page.locator(id), start = Number(await r.inputValue());
        assert.equal(Number(await r.getAttribute('min')), min); assert.equal(Number(await r.getAttribute('max')), max);
        await r.focus(); await page.keyboard.press('Home');
        assert.equal(Number(await r.inputValue()), min); const lo = await res();
        await page.keyboard.press('End');
        assert.equal(Number(await r.inputValue()), max); const hi = await res();
        assert.notEqual(lo, hi, `${id} min vs max should change results`);
        await page.keyboard.press('Home');
        for (let i = min; i < start; i++) await page.keyboard.press('ArrowRight');
        assert.equal(Number(await r.inputValue()), start);
      }
      const cb = page.locator('#compatible');
      assert.ok(await cb.isChecked(), '#compatible initially checked');
      await cb.click(); const off = await res(); await cb.click();
      assert.notEqual(off, orig, 'compatibility toggle should change results');
      assert.equal(await res(), orig, 'restoring inputs should restore original results');
      assert.doesNotMatch(orig + off, /\d\s*(ms|tok\/s|tokens?\/s|TPS|TOPS|W|watts?)\b|\d\s*[x×]\s*(faster|speed)/i, 'numeric hardware performance in results');
      page.off('request', onReq);
      assert.deepEqual(reqs, [], 'playground made network requests');
    });

    await step('glossary: 11 terms, native details operable by keyboard', async () => {
      const sec = page.locator('#takeaways');
      const all = norm(await sec.textContent());
      for (const re of [/NPU/, /inference/i, /tensor/i, /matrix multiplication/i, /weights/i, /activations/i, /quantization/i, /unified memory/i, /Core ML/, /MLX/, /Metal/]) assert.match(all, re);
      const details = await sec.locator('details').all();
      if (!details.length) notes.push('no <details> in #takeaways');
      for (const d of details) {
        const open0 = await d.evaluate((el) => el.open);
        await d.locator('summary').first().focus();
        await page.keyboard.press('Enter');
        assert.ok(await poll(() => d.evaluate((el) => el.open !== open0), 1000), 'Enter toggles <details>');
        await page.keyboard.press('Space');
        assert.ok(await poll(() => d.evaluate((el) => el.open === open0), 1000), 'Space toggles <details>');
      }
    });

    await step('keyboard: Tab order has visible focus; Space selects chip; native fields focus-visible', async () => {
      await page.reload({ waitUntil: 'load' });
      const ring = (el) => { const cs = getComputedStyle(el); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'; };
      const noRing = [];
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await page.keyboard.press('Tab');
        const f = page.locator(':focus');
        if (!(await f.evaluate(ring))) noRing.push(await f.evaluate((el) => el.id || el.tagName + (el.getAttribute('href') || '')));
        reached = await f.evaluate((el) => el.matches('#overview button[data-component]'));
      }
      assert.ok(reached, 'Tab never reached a chip component button');
      assert.deepEqual(noRing, [], 'focused elements without visible focus indicator');
      const chip = page.locator('#overview button[data-component]:focus');
      const was = await pressed(chip);
      await page.keyboard.press('Space');
      assert.ok(await pressed(chip) || was, 'Space should select the focused chip component');
      for (const id of ['#workload', '#network-speed', '#compute-units', '#model-size', '#compatible']) {
        await page.locator(id).focus();
        assert.ok(await page.locator(id).evaluate(ring), `${id} lacks visible focus`);
      }
      const cb = page.locator('#compatible'); await page.keyboard.press('Space');
      assert.equal(await cb.isChecked(), false, 'Space toggles #compatible'); await page.keyboard.press('Space');
    });
  } finally { await ctx.close(); }
}

async function responsive(browser, [name, width, height]) {
  const touch = width < 1024;
  const { ctx, page } = await open(browser, name, { viewport: { width, height }, hasTouch: touch, isMobile: width < 500 });
  try {
    await step(`${name} ${width}x${height}: no overflow, 44px controls inside panels, no hover-only controls`, async () => {
      const tog = page.locator('#math-toggle');
      if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.click();
      const bad = await page.evaluate((sels) => {
        const out = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}`);
        for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
          const t = el.type === 'checkbox' ? el.closest('label') || el : el, r = t.getBoundingClientRect(), id = el.id || `${sel}`;
          let o = 1, hidden = false;
          for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); o *= +cs.opacity; hidden ||= cs.display === 'none' || cs.visibility === 'hidden'; }
          if (hidden || o < 0.5) { out.push(`${id} not visible at rest`); continue; }
          if (r.width < 43.5 || r.height < 43.5) out.push(`${id} target ${Math.round(r.width)}x${Math.round(r.height)}`);
          const sec = el.closest('section') || document.body, s = sec.getBoundingClientRect();
          if (r.left < Math.max(0, s.left) - 1 || r.right > Math.min(innerWidth, s.right) + 1) out.push(`${id} outside its panel/viewport`);
        }
        return out;
      }, CONTROLS);
      assert.deepEqual(bad, []);
      if (width >= 1024) {
        const ok = await page.locator('#overview').evaluate((s) => { const h = s.querySelector('h1').getBoundingClientRect(); const svg = [...s.querySelectorAll('svg')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]; if (!svg) return false; const g = svg.getBoundingClientRect(); return g.left + g.width / 2 > h.left + h.width / 2; });
        assert.ok(ok, 'desktop hero: headline left, chip diagram right');
      }
    });

    await step(`${name}: chip choice panel by ${touch ? 'tap' : 'click'} not clipped`, async () => {
      const btn = page.locator('#overview button[data-component="gpu"]').first();
      await btn.scrollIntoViewIfNeeded();
      await (touch ? btn.tap() : btn.click());
      assert.ok(await pressed(btn));
      const det = page.locator('#component-detail');
      await det.scrollIntoViewIfNeeded();
      assert.ok(await det.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1 && r.height > 0; }), '#component-detail clipped');
    });

    await step(`${name}: nav anchors scroll each section heading clear of sticky header`, async () => {
      const covered = [];
      for (const id of SECTIONS.slice(1)) {
        let link = page.locator(`header a[href="#${id}"], nav a[href="#${id}"]`).first();
        assert.ok(await link.count(), `no nav link to #${id}`);
        if (!(await link.isVisible())) {
          const menu = page.locator('header [aria-expanded]:not(#motion-toggle), nav [aria-expanded]').first();
          if (await menu.count()) await (touch ? menu.tap() : menu.click());
        }
        assert.ok(await link.isVisible(), `nav link to #${id} unreachable`);
        await (touch ? link.tap() : link.click());
        await scrollSettle(page);
        const g = await page.evaluate((sid) => {
          const sec = document.getElementById(sid), r = (sec.querySelector('h1,h2') || sec).getBoundingClientRect();
          let cover = 0;
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
            const b = el.getBoundingClientRect(); if (b.top <= 1 && b.bottom > 0 && b.width > innerWidth / 2 && b.height < innerHeight / 2) cover = Math.max(cover, b.bottom);
          }
          return { top: r.top, cover, vh: innerHeight };
        }, id);
        if (g.top < g.cover - 1 || g.top > g.vh) covered.push(`#${id} heading top ${Math.round(g.top)} (header ${Math.round(g.cover)})`);
      }
      assert.deepEqual(covered, []);
    });

    await step(`${name}: viewport screenshots`, async () => {
      for (const [label, sel] of Object.entries(SHOT_SECTIONS)) {
        if (label === 'overview') await page.evaluate(() => scrollTo(0, 0));
        else await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await scrollSettle(page);
        await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}-${label}.png`) });
      }
    });
  } finally { await ctx.close(); }
}

async function reducedMotion(browser) {
  const { ctx, page } = await open(browser, 'reduced-motion', { reducedMotion: 'reduce' });
  try {
    await step('reduced motion: starts globally paused, no autoplay, manual steps work, explicit resume', async () => {
      const t = page.locator('#motion-toggle');
      assert.equal(await pressed(t), true); assert.match(await text(t), /Resume animations/);
      await page.locator('#network').scrollIntoViewIfNeeded();
      const s = await stageOf(page); await sleep(STAY_MS);
      assert.equal(await stageOf(page), s, 'network advanced under reduced motion');
      const m = await motionState(page);
      assert.deepEqual(m.running, []); assert.equal(m.smil, 0);
      await netReset(page);
      await page.locator('#network-next').click();
      assert.equal(await stageOf(page), 1);
      await setGlobalPaused(page, false);
    });
  } finally { await ctx.close(); }
}

async function noJs(browser) {
  const { ctx, page } = await open(browser, 'no-js', { javaScriptEnabled: false });
  try {
    await step('JS disabled: sections, caveats, glossary readable; SVGs named', async () => {
      assert.equal(await text(page.locator('#overview h1')), 'Inside the Neural Engine');
      const hidden = await page.evaluate((ids) => ids.filter((id) => {
        const s = document.getElementById(id); if (!s || norm(s.textContent).length < 40) return true;
        for (let n = s; n; n = n.parentElement) { const cs = getComputedStyle(n); if (+cs.opacity < 0.5 || cs.visibility === 'hidden' || cs.display === 'none') return true; }
        return false;
        function norm(x) { return (x || '').replace(/\s+/g, ' ').trim(); }
      }), SECTIONS);
      assert.deepEqual(hidden, [], 'sections hidden or empty without JS');
      const body = norm(await page.locator('body').textContent());
      for (const c of ['Conceptual diagram - not a literal die layout', 'Illustrative execution paths - not live telemetry or a prediction of Core ML scheduling', 'Illustrative simulation - not hardware benchmarks']) assert.match(body, dash(c));
      for (const re of [/matrix multiplication/i, /quantization/i, /unified memory/i]) assert.match(body, re);
      const unnamed = await page.evaluate(() => [...document.querySelectorAll('main svg, section svg')].filter((s) => !s.closest('[aria-hidden="true"]') && !s.parentElement.closest('svg'))
        .filter((s) => !(s.getAttribute('aria-label') || s.getAttribute('aria-labelledby') || s.querySelector(':scope > title'))).map((s) => s.closest('section')?.id || '?'));
      assert.deepEqual(unnamed, [], 'non-decorative SVGs without accessible name (sections listed)');
      await page.screenshot({ path: path.join(OUT, 'nojs-1365x900-overview.png') });
    });
  } finally { await ctx.close(); }
}

async function main() {
  let server, browser;
  if (!URL_ARG) {
    if (!fs.existsSync(path.join(ROOT, 'index.html'))) blocked(`no index.html in ${ROOT}; app not present, journey not executed`);
    server = await serve().catch((e) => blocked(`cannot serve on ${ORIGIN}: ${e.message}`));
  } else {
    const r = await fetch(BASE).catch((e) => ({ status: e.message }));
    if (r.status !== 200) blocked(`${BASE} responded ${r.status}`);
  }
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (e) { blocked(`Playwright not loadable: ${e.message}`); }
  fs.mkdirSync(OUT, { recursive: true });
  const watchdog = setTimeout(async () => { console.error('TIMEOUT: journey exceeded 10 minutes'); await browser?.close().catch(() => {}); server?.closeAllConnections(); server?.close(); process.exit(1); }, 10 * 60e3);
  try {
    browser = await chromium.launch();
    console.log(`Journey against ${BASE} -> artifacts ${OUT}`);
    await desktopJourney(browser);
    await reducedMotion(browser);
    for (const vp of VIEWPORTS) await responsive(browser, vp);
    await noJs(browser);
  } finally {
    clearTimeout(watchdog);
    await browser?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
  }
  for (const [k, v] of Object.entries(issues)) { if (v.length) results.push({ name: `no ${k}`, ok: false, error: [...new Set(v)].slice(0, 10).join('\n') }); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, notes, issues }, null, 2));
  for (const [k, v] of Object.entries(issues)) if (v.length) console.log(`FAIL ${k}:\n  ${[...new Set(v)].slice(0, 10).join('\n  ')}`);
  for (const n of notes) console.log(`NOTE ${n}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed; report ${path.join(OUT, 'report.json')}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
