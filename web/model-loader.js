export const MODEL_REVISION = "92e33df61cfc9eb820272aaa62d2ef6dcf4d950d";
export const MODEL_SIZE = 180_534_758;
export const MODEL_SHA256 = "e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077";
export const MODEL_URL = `https://huggingface.co/timcsy/demucs-web-onnx/resolve/${MODEL_REVISION}/htdemucs_embedded.onnx`;

const CACHE_NAME = `music-splitter-model-v2-${MODEL_REVISION}`;
let activeLoad;

export function validateModelSize(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error("The AI model download was not binary data.");
  if (buffer.byteLength !== MODEL_SIZE) {
    throw new Error(`The AI model download is incomplete (${buffer.byteLength} of ${MODEL_SIZE} bytes).`);
  }
  return buffer;
}

async function validateModel(buffer) {
  validateModelSize(buffer);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== MODEL_SHA256) throw new Error("The AI model checksum is invalid.");
  return buffer;
}

export function loadModel(options = {}) {
  activeLoad ||= loadModelOnce(options).catch(error => {
    activeLoad = undefined;
    throw error;
  });
  return activeLoad;
}

async function loadModelOnce({ onProgress = () => {}, onState = () => {}, signal } = {}) {
  const cache = await openCache();
  const cached = await readCache(cache, onProgress);
  if (cached) {
    onState("cached");
    return cached;
  }

  return retry(async attempt => {
      onState("downloading", attempt);
      return await downloadModel(cache, onProgress, signal);
  });
}

export async function retry(operation, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
      if (attempt < 3) await wait(attempt * 500);
    }
  }
  throw new Error(`The AI model could not be downloaded after 3 attempts. ${lastError?.message || "Try again later."}`);
}

async function openCache() {
  if (!("caches" in globalThis)) return undefined;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return undefined;
  }
}

async function readCache(cache, onProgress) {
  if (!cache) return undefined;
  try {
    const response = await cache.match(MODEL_URL);
    if (!response) return undefined;
    const buffer = await validateModel(await response.arrayBuffer());
    onProgress(buffer.byteLength, MODEL_SIZE, true);
    return buffer;
  } catch {
    await cache.delete(MODEL_URL).catch(() => {});
    return undefined;
  }
}

async function downloadModel(cache, onProgress, signal) {
  const response = await fetch(MODEL_URL, {
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`Model host returned HTTP ${response.status}.`);

  const type = response.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("Model host returned a web page instead of the AI model.");

  const declaredSize = Number(response.headers.get("content-length")) || MODEL_SIZE;
  if (declaredSize !== MODEL_SIZE) throw new Error(`Model host returned an unexpected file size (${declaredSize} bytes).`);

  cache?.put(MODEL_URL, response.clone()).catch(() => {});
  const buffer = response.body
    ? await readStream(response.body, declaredSize, onProgress)
    : await response.arrayBuffer();
  await validateModel(buffer);
  return buffer;
}

async function readStream(stream, total, onProgress) {
  const reader = stream.getReader();
  const bytes = new Uint8Array(total);
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > total) throw new Error("The AI model download was larger than expected.");
    bytes.set(value, loaded);
    loaded += value.byteLength;
    onProgress(loaded, total, false);
  }
  if (loaded !== total) throw new Error(`The AI model download stopped early (${loaded} of ${total} bytes).`);
  return bytes.buffer;
}
