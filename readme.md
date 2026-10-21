# Music Splitter

Music Splitter is a free, private music stem splitter. Vercel serves a static Vite site; the user's browser downloads a pinned HTDemucs ONNX model and separates the selected song into vocals, drums, bass, and other. The song never leaves the device.

There is no backend, account, database, API key, or paid GPU service.

## Architecture

- **Vercel:** serves `dist/index.html`, versioned JavaScript/CSS, and ONNX Runtime's version-matched WASM asset.
- **Hugging Face:** serves the pinned 180,534,758-byte `htdemucs_embedded.onnx` model directly to the browser.
- **Browser:** decodes to 44.1 kHz stereo, initializes WebGPU or WASM, runs Demucs, previews the results, and exports stereo PCM WAV files.
- **Browser Cache Storage:** stores the versioned model when quota and privacy settings allow. Cache failure is non-fatal.

## Local development

Requirements: Node.js 20.19 or newer and a current desktop Chrome or Edge browser.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. The first separation downloads the approximately 172 MiB model. A successful hybrid WebGPU/WASM session is reported only after ONNX initializes it; otherwise Music Splitter retries with CPU/WASM.

## Test and production build

```powershell
npm test
npm run build
npm run preview
```

The build output is `dist/`. The ONNX model is not copied into it; the browser fetches the model at runtime from the pinned Hugging Face revision.

## Deploy to Vercel

Push this project to your own Git repository, then import it in Vercel with:

- Root Directory: repository root (`.`)
- Framework Preset: Vite
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js: 20.x or newer

The committed `vercel.json` already contains the build/output settings, immutable asset caching, and the COOP/COEP headers used for multithreaded WASM. No environment variables are required.

CLI deployment, after signing in:

```powershell
npx vercel
npx vercel --prod
```

## Model and runtime behavior

- Model source: `timcsy/demucs-web-onnx`, revision `92e33df61cfc9eb820272aaa62d2ef6dcf4d950d`.
- Expected model size: 180,534,758 bytes; SHA-256: `e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077`. Music Splitter rejects HTTP errors, HTML responses, truncated files, unexpected sizes, and checksum mismatches.
- Downloads retry up to three times and concurrent callers share one load.
- The cache key includes the model revision. Private browsing or low quota can disable persistent caching; separation still works for that session.
- ONNX Runtime Web 1.23.2 is bundled with its matching WASM binary by Vite. Missing asset requests are not rewritten to HTML.
- WebGPU is attempted only in a secure context with an adapter. The model uses ONNX's hybrid WebGPU/WASM provider list because some operators require CPU fallback; a failed hybrid session is discarded and recreated as WASM-only.
- WASM uses multiple threads only when `crossOriginIsolated` is true; otherwise it uses one thread.
- Backend initialization is bounded (three minutes for hybrid mode, four for CPU-only) so a driver/runtime hang becomes an actionable error instead of a permanent loading screen.

## Audio support and limits

Browser codec support varies. Current Chrome/Edge reliably handle common MP3 and WAV files; M4A/AAC/OGG/FLAC availability depends on the browser and operating system. Music Splitter reports decode failures and recommends MP3 or WAV instead of silently accepting an unsupported codec.

Music Splitter applies a 50 MB compressed-file guard and a three-minute decoded-duration guard. Compressed size is not a memory estimate: a three-minute job may still need well over 1 GB once the model, decoded input, inference tensors, four stereo stems, and WAV outputs coexist. Start with a short clip, close memory-heavy tabs, and use a 64-bit desktop browser. CPU/WASM can be much slower than WebGPU.

Active ONNX inference cannot be safely interrupted through `demucs-web` 1.0.2. Music Splitter therefore prevents concurrent jobs instead of pretending active inference is cancellable.

## Troubleshooting

- **Model download fails:** confirm the Hugging Face URL is reachable, disable strict network filtering for the site, and retry.
- **Neither backend starts:** update desktop Chrome/Edge, enable hardware acceleration, or try another device.
- **Out of memory:** use a shorter track and close other tabs.
- **Audio will not decode:** convert it to MP3 or WAV.
- **Model downloads every visit:** browser Cache Storage is unavailable, full, cleared, or disabled by private mode.
- **WASM is very slow:** WebGPU is unavailable or failed initialization; this is expected on unsupported hardware.
- **Force the CPU fallback:** open the site with `?backend=wasm` to skip WebGPU for diagnosis.

## Source and license

The separator uses the MIT-licensed [`demucs-web`](https://github.com/timcsy/demucs-web) package and ONNX Runtime Web. The pre-existing SteamKit source is unrelated to Music Splitter and is excluded from Vercel uploads by `.vercelignore`; it remains in this checkout only for the original repository history and licensing.

The public model repository does not currently declare a model-card license. Music Splitter fetches the weights from that repository and does not redistribute them; confirm the weight license before commercial use or mirroring the model to your own storage.
