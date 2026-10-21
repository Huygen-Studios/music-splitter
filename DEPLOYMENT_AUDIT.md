# Music Splitter deployment audit

The audited app already produced a Vite build; the blockers below affected reliable production operation rather than basic compilation.

## Confirmed original blockers

1. **Unverified backend label:** the UI called WebGPU “ready” after finding an adapter, before ONNX session creation. A GPU-session failure had no explicit fresh CPU retry.
2. **Fragile model loading:** `demucs-web` fetched the model directly without checking `response.ok`, retrying, validating the binary, pinning a revision, or persisting a versioned cache.
3. **Overstated input limit:** 100 MB / ten minutes described compressed input, not decoded and inference memory, and had not been tested. Ten minutes can require multiple gigabytes.
4. **Incomplete deployment metadata:** Vercel was configured as no framework, Vite had no explicit root-deployment base, and the Node engine range allowed versions too old for the installed Vite.
5. **Unrelated source upload:** the inherited SteamKit tree is unrelated to Music Splitter and needlessly enlarged CLI deployment input.

## Resolutions

- Added `web/model-loader.js` with a commit-pinned URL, exact-size and SHA-256 validation, HTTP/content checks, three retries, one shared in-flight request, real byte progress, and non-blocking Cache Storage persistence.
- WebGPU is now a candidate until ONNX creates the required hybrid WebGPU/WASM session. Failure creates a new WASM-only processor from the already downloaded model. The UI reports the backend actually in use.
- Backend initialization has a bounded timeout. A hanging GPU compile offers a reload into explicit CPU mode rather than leaving the UI permanently busy.
- WASM is pinned to one thread because ONNX Runtime 1.23.2's Emscripten pthread worker resolves to the Vite application bundle and crashes with `document is not defined`. Vite emits the version-matched WASM asset into `dist/assets`.
- Set the guard to 50 MB / five minutes, added 44.1 kHz verification, guaranteed `AudioContext` cleanup, rejected non-finite WAV samples, and releases object URLs on page exit.
- Set Vite `root: web`, `base: /`, and output `../dist`; set Vercel's framework to Vite and added immutable hashed-asset caching plus COOP/COEP security headers.
- Disabled Vite's SPA fallback because Music Splitter has no client-side routes; missing WASM/assets now return 404 instead of `index.html`.
- Added `.vercelignore` for unrelated SteamKit and test sources.

## Verified working components

- Vite production build creates `dist/index.html`, hashed JavaScript/CSS, and a version-matched ONNX WASM binary.
- No production bundle reference points to localhost, `127.0.0.1`, a Windows drive, or a filesystem URL.
- Hugging Face responds with HTTP 200, `application/octet-stream`, wildcard CORS, byte ranges, and exactly 180,534,758 bytes.
- Audio is decoded by a 44.1 kHz `AudioContext`; mono input is duplicated to stereo. `demucs-web` performs its existing segment/overlap-add algorithm.
- PCM WAV header and sample validation are covered by unit tests.

## Modified files

- `web/app.js`: verified backend states, hybrid-to-WASM fallback, bounded initialization, safer audio lifecycle, realistic limits, and model-state UX.
- `web/model-loader.js`: pinned, validated, retried, deduplicated, progressively downloaded, version-cached model loading.
- `web/audio.js`: rejects invalid non-finite output samples.
- `web/index.html`, `web/styles.css`: model state, backend state, CPU retry, and corrected limits.
- `tests/*.test.mjs`: WAV validation, invalid-sample, model-size, retry, and abort tests.
- `vite.config.js`: explicit root/base/output, static MPA behavior, and matching local isolation headers.
- `vercel.json`: Vite build/output, production isolation/security headers, and immutable hashed-asset caching.
- `package.json`, `package-lock.json`: exact dependency lock and Vite-compatible Node engine.
- `.vercelignore`: excludes the unrelated inherited SteamKit tree from CLI deployments.
- `readme.md`: architecture, deployment settings, model identity, browser/runtime limits, and troubleshooting.

## Verification performed

- `npm ci`: passed from the lockfile after stopping the running development server that held a Windows native-module file lock.
- `npm test`: 7/7 tests passed.
- `npm run build`: passed with Vite 8.3.4; output is four files totaling 25,645,981 bytes. The model is not in `dist`.
- `npm audit`: zero vulnerabilities.
- Production preview: HTML 200; COOP `same-origin`; COEP `require-corp`; ONNX WASM 200 with `application/wasm`; missing WASM 404.
- Model host: HTTP 200, CORS `*`, `application/octet-stream`, 180,534,758 bytes; Git LFS SHA-256 pinned in the loader.
- A 33-second stereo MP3 completed real four-stem WebGPU + WASM inference in 39 seconds from the production build after disabling the broken pthread path. All four WAV previews and downloads were generated.
- Vercel CLI 64.7.0 reported `Logged out`; no public deployment was attempted or claimed.

## Production behavior differences

- Vite development and preview servers add COOP/COEP through `vite.config.js`; Vercel adds the same headers through `vercel.json`.
- Production assets are hashed and cached immutably. HTML is not given an immutable cache rule.
- The public model remains external in both environments and is never part of the Vercel bundle.

## Remaining limitations

- Codec support follows the browser/OS; accepting an extension does not guarantee decoding.
- Active ONNX inference cannot be cancelled safely through `demucs-web` 1.0.2.
- Long audio remains memory-intensive and WASM may be impractically slow.
- Persistent model caching depends on browser quota/privacy mode and is not an offline guarantee.
- Only an authenticated Vercel deployment can prove the final public URL and its edge response headers.
- The final in-app-browser inference rerun did not complete during the test window; test the production URL in a fresh desktop Chrome/Edge process before launch.
- The public model repository currently has no declared model-card license; verify the weight license before commercial use or mirroring.
