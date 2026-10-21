import * as ort from "onnxruntime-web/webgpu";
import { CONSTANTS, DemucsProcessor } from "demucs-web";
import { encodeStereoWav, formatBytes, formatDuration } from "./audio.js";
import { loadModel, MODEL_SIZE } from "./model-loader.js";

ort.env.logLevel = "error";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_DURATION = 3 * 60;
const STEMS = ["vocals", "drums", "bass", "other"];
const forceWasm = new URLSearchParams(location.search).get("backend") === "wasm";

const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const sourceCard = document.querySelector("#source-card");
const sourceAudio = document.querySelector("#source-audio");
const separateButton = document.querySelector("#separate-button");
const progressCard = document.querySelector("#progress-card");
const progressStage = document.querySelector("#progress-stage");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressDetail = document.querySelector("#progress-detail");
const errorMessage = document.querySelector("#error-message");
const cpuRetryButton = document.querySelector("#cpu-retry");
const results = document.querySelector("#results");
const stemGrid = document.querySelector("#stem-grid");
const engineBadge = document.querySelector("#engine-badge");
const modelState = document.querySelector("#model-state");

let selectedFile;
let sourceUrl;
let processor;
let processorLoad;
let resultUrls = [];
let webGpuAvailable = false;
let activeBackend;

document.querySelector("#year").textContent = new Date().getFullYear();
detectEngine();

fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", event => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  selectFile(event.dataTransfer.files[0]);
});
separateButton.addEventListener("click", separateTrack);
cpuRetryButton.addEventListener("click", () => location.assign(`${location.pathname}?backend=wasm#splitter`));
window.addEventListener("pagehide", releaseObjectUrls);

async function detectEngine() {
  try {
    webGpuAvailable = Boolean(!forceWasm && isSecureContext && navigator.gpu && await navigator.gpu.requestAdapter());
  } catch {
    webGpuAvailable = false;
  }
  engineBadge.textContent = webGpuAvailable ? "WebGPU available · verifies on start" : forceWasm ? "CPU mode selected · slower" : "CPU fallback available · slower";
  engineBadge.classList.toggle("fallback", !webGpuAvailable);
}

function selectFile(file) {
  hideError();
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) return showError("That file is over 50 MB. Choose a smaller track.");
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
    return showError("Choose an MP3, WAV, M4A, AAC, OGG, or FLAC audio file.");
  }

  selectedFile = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  sourceAudio.src = sourceUrl;
  document.querySelector("#file-name").textContent = file.name;
  document.querySelector("#file-details").textContent = `${formatBytes(file.size)} · ready to separate`;
  sourceCard.hidden = false;
  progressCard.hidden = true;
  clearResults();
  sourceCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function separateTrack() {
  if (!selectedFile) return;
  hideError();
  clearResults();
  separateButton.disabled = true;
  separateButton.textContent = "Separating…";
  progressCard.hidden = false;
  const startedAt = performance.now();

  try {
    setProgress(2, "Reading audio", "Decoding your track locally…");
    const audioContext = new AudioContext({ sampleRate: CONSTANTS.SAMPLE_RATE });
    let decoded;
    try {
      decoded = await audioContext.decodeAudioData(await selectedFile.arrayBuffer());
    } finally {
      await audioContext.close();
    }

    if (decoded.duration > MAX_DURATION) throw new Error("For reliable browser memory use, choose a track under 3 minutes.");
    if (decoded.sampleRate !== CONSTANTS.SAMPLE_RATE) throw new Error("The browser could not resample this track to 44.1 kHz.");

    const left = new Float32Array(decoded.getChannelData(0));
    const right = decoded.numberOfChannels > 1 ? new Float32Array(decoded.getChannelData(1)) : new Float32Array(left);
    document.querySelector("#file-details").textContent = `${formatBytes(selectedFile.size)} · ${formatDuration(decoded.duration)} · ${decoded.numberOfChannels > 1 ? "stereo" : "mono"}`;

    const activeProcessor = await getProcessor();
    setProgress(25, "Separating stems", `Processing with ${activeBackend === "hybrid" ? "WebGPU + WASM" : "CPU (WASM — slower)"}…`);
    const separated = await activeProcessor.separate(left, right);

    setProgress(96, "Creating downloads", "Encoding four stereo WAV files…");
    renderStems(separated, selectedFile.name.replace(/\.[^.]+$/, ""));
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    document.querySelector("#elapsed").textContent = `Finished in ${formatDuration(elapsedSeconds)}`;
    setProgress(100, "Complete", "Four stems are ready to preview and download.");
    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    showError(friendlyError(error));
    progressCard.hidden = true;
  } finally {
    separateButton.disabled = false;
    separateButton.textContent = "Separate this track";
  }
}

async function getProcessor() {
  if (processor) return processor;
  processorLoad ||= initializeProcessor().catch(error => {
    processorLoad = undefined;
    setModelState("Error", "error");
    throw error;
  });
  return processorLoad;
}

async function initializeProcessor() {
  setModelState("Downloading", "loading");
  const model = await loadModel({
    onState: state => {
      if (state === "cached") {
        setModelState("Cached · loading", "loading");
        setProgress(20, "Loading cached AI model", "Preparing the saved model for this browser session…");
      }
    },
    onProgress: (loaded, total, cached) => {
      const ratio = total ? loaded / total : 0;
      setProgress(5 + ratio * 15, cached ? "Loading cached AI model" : "Downloading AI model", `${formatBytes(loaded)} of ${formatBytes(total || MODEL_SIZE)}`);
    }
  });

  if (webGpuAvailable) {
    try {
      setProgress(21, "Initializing WebGPU", "Creating the AI inference session…");
      processor = await createProcessor("webgpu", model);
      activeBackend = "hybrid";
    } catch (error) {
      console.warn("WebGPU initialization failed; retrying with WASM.", error);
      processor = undefined;
      if (error?.code === "INIT_TIMEOUT") throw error;
      setProgress(21, "WebGPU unavailable", "Retrying with the CPU (WASM) fallback…");
    }
  }

  if (!processor) {
    processor = await createProcessor("wasm", model);
    activeBackend = "wasm";
  }

  engineBadge.textContent = activeBackend === "hybrid" ? "Processing with WebGPU + WASM" : "Processing with CPU · slower";
  engineBadge.classList.toggle("fallback", activeBackend !== "hybrid");
  setModelState("Ready", "ready");
  return processor;
}

async function createProcessor(backend, model) {
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 4) : 1;
  const candidate = new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
      graphOptimizationLevel: "basic",
      enableCpuMemArena: false,
      enableMemPattern: false
    },
    onProgress: ({ progress, currentSegment, totalSegments }) => {
      setProgress(25 + progress * 70, "Separating stems", `Segment ${currentSegment} of ${totalSegments} · ${backend === "webgpu" ? "WebGPU + WASM" : "CPU/WASM"}`);
    }
  });
  try {
    await withTimeout(candidate.loadModel(model), backend === "webgpu" ? 180_000 : 240_000);
    return candidate;
  } catch (error) {
    await candidate.session?.release?.().catch(() => {});
    throw error;
  }
}

async function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("AI backend initialization timed out. Reload the page or retry in CPU mode.");
      error.code = "INIT_TIMEOUT";
      reject(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function renderStems(separated, baseName) {
  resultUrls.forEach(URL.revokeObjectURL);
  resultUrls = [];
  stemGrid.replaceChildren();

  for (const name of STEMS) {
    const blob = encodeStereoWav(separated[name].left, separated[name].right, CONSTANTS.SAMPLE_RATE);
    const url = URL.createObjectURL(blob);
    resultUrls.push(url);

    const card = document.createElement("article");
    card.className = `stem-card ${name}`;
    const heading = document.createElement("h3");
    heading.textContent = name;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    const download = document.createElement("a");
    download.className = "download-link";
    download.href = url;
    download.download = `${baseName}-${name}.wav`;
    download.textContent = "Download WAV ↓";
    card.append(heading, audio, download);
    stemGrid.append(card);
  }
}

function setProgress(percent, stage, detail) {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  progressStage.textContent = stage;
  progressPercent.textContent = `${rounded}%`;
  progressBar.style.width = `${rounded}%`;
  progressDetail.textContent = detail;
}

function clearResults() {
  resultUrls.forEach(URL.revokeObjectURL);
  resultUrls = [];
  stemGrid.replaceChildren();
  results.hidden = true;
}

function setModelState(label, state) {
  modelState.textContent = label;
  modelState.dataset.state = state;
}

function releaseObjectUrls() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  resultUrls.forEach(URL.revokeObjectURL);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  cpuRetryButton.hidden = !/initialization timed out/i.test(message);
}

function hideError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
  cpuRetryButton.hidden = true;
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|out of bounds/i.test(message)) return "This track exceeded the browser's available memory. Try a shorter file or close other tabs.";
  if (/decode/i.test(message)) return "The browser could not decode that audio file. Try MP3 or WAV.";
  if (/fetch|network|download|HTTP|model host/i.test(message)) return `${message} Check your connection and try again.`;
  if (/webgpu|wasm|session|backend/i.test(message)) return "Neither WebGPU nor the CPU fallback could start. Update Chrome or Edge, then try again.";
  return message || "Separation failed. Try a shorter MP3 or WAV file.";
}
