# Sources

Primary sources, checked on 2026-10-29. Each entry lists only what the exhibit relies on that source for.

| Source | Used for |
| --- | --- |
| [Apple ML Research: Deploying Transformers on the Apple Neural Engine](https://machinelearning.apple.com/research/neural-engine-transformers) | The ANE is specialized ML-inference hardware, distinct from the CPU and GPU, and transformers can be optimized to run on it. Qualitative principles only, with no chip counts or benchmarks. |
| [Core ML](https://developer.apple.com/documentation/coreml) ([JSON](https://developer.apple.com/tutorials/data/documentation/coreml.json)) | Core ML uses the CPU, GPU and Neural Engine. The JSON is the evidence, not the page's JavaScript shell. |
| [MLComputeUnits](https://developer.apple.com/documentation/coreml/mlcomputeunits) ([JSON](https://developer.apple.com/tutorials/data/documentation/coreml/mlcomputeunits.json); cases `/all.json`, `/cpuonly.json`, `/cpuandgpu.json`, `/cpuandneuralengine.json`) | `.all` lets the OS pick the best unit, including the ANE if available. `.cpuOnly` is the CPU only. `.cpuAndGPU` is the CPU and GPU, not the ANE. `.cpuAndNeuralEngine` is the CPU and ANE, not the GPU, and is not ANE-only. |
| [Core ML Tools: model prediction](https://apple.github.io/coremltools/docs-guides/source/model-prediction.html) | `compute_units` restricts which processors are allowed. |
| [Core ML NeuralNetwork format](https://apple.github.io/coremltools/mlmodel/Format/NeuralNetwork.html) | Definitions of ReLU `max(0, x)`, batched matrix multiplication and softmax. |
| [Apple Newsroom: M1 (2020)](https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/) | The unified memory concept: units share one pool and avoid multiple copies. Historical concept only, with no current specs. |
| [MLX: unified memory](https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html) | CPU and GPU share arrays, and dependent operations wait. |
| [MLX](https://github.com/ml-explore/mlx) / [docs](https://ml-explore.github.io/mlx/build/html/index.html) | MLX is a software framework. On Apple silicon its documented devices are the CPU and GPU (`mx.cpu`, `mx.gpu`), not the ANE. |
| [MLX-LM](https://github.com/ml-explore/mlx-lm) | Text generation and fine-tuning of LLMs on Apple silicon with MLX; includes a Qwen example. |
| [oMLX](https://github.com/jundot/omlx) | Uses MLX and MLX-LM; its README also describes an optional separate Metal engine. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) / [build guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md) | "Using Metal makes the computation run on the GPU"; hybrid CPU and GPU execution. |
| [Metal](https://developer.apple.com/metal/) | Metal is Apple's GPU graphics and compute API. |

## Deliberately not claimed

The exhibit makes no claims about ANE ISA, caches or floorplan; core counts; TOPS; latency, energy or speedup figures; GPU "neural accelerator" internals; universal zero-copy; or guaranteed fallback for unsupported operations.
