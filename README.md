# Inside the Neural Engine

An interactive, static exhibit about the Apple Neural Engine (ANE), the CPU and GPU, Core ML compute units, unified memory, and running local language models. Plain HTML, CSS and native ES modules: no build step, no dependencies, no network calls at runtime.

An independent educational project, not affiliated with Apple.

## Run

```sh
python3 -m http.server 8271 --bind 127.0.0.1   # or: npm run serve
# open http://127.0.0.1:8271/
```

ES modules need an HTTP server; opening `index.html` from disk shows the static content only.

## Test

```sh
npm test
```

This uses Node's built-in test runner (Node 20 or newer), with no installs:

- `tests/model.test.mjs` checks the toy forward pass against the hand-worked values, plus the playground's qualitative rules.
- `tests/static.test.mjs` checks syntax (`node --check`), the frozen DOM contract (IDs, values, button semantics), the source list, that asset paths are relative, and that no telemetry or storage is used.

Browser journey tests live in `scripts/browser-exhibit.cjs`, which is maintained separately.

## What the numbers mean

- **Math.** `model.js` runs a real 2×2 forward pass: pixels ÷ 100, then `ReLU(X·W)`, column means, readout and softmax. The weights were picked by hand for teaching. It is not a trained classifier and not the ANE's internal dataflow.
- **Routes.** The Core ML and runtime diagrams are illustrative execution paths, not live telemetry or a prediction of Core ML scheduling. Compute units are a permission mask. They don't guarantee placement, and they don't make unsupported operations compatible.
- **Playground.** The sliders are unitless levels and the outputs are qualitative words. It is an illustrative simulation, not a hardware benchmark, and nothing in the browser is measured.

Sources and what each one supports: [docs/sources.md](docs/sources.md).

## Deploying to GitHub Pages

Every path is relative, so the site works from a repository subpath. In the repository settings, enable Pages for this branch's root folder. `.nojekyll` is included.

## License

The code is MIT (see `LICENSE`). Barlow Condensed and Public Sans are self-hosted latin subsets under the SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`).
