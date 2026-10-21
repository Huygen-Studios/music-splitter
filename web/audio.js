export function encodeStereoWav(left, right, sampleRate = 44100) {
  if (left.length !== right.length) throw new Error("Stem channels must have equal lengths.");

  const buffer = new ArrayBuffer(44 + left.length * 4);
  const view = new DataView(buffer);
  const writeText = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));

  writeText(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, left.length * 4, true);

  let offset = 44;
  for (let index = 0; index < left.length; index += 1) {
    for (const sample of [left[index], right[index]]) {
      if (!Number.isFinite(sample)) throw new Error("Stem audio contains an invalid sample.");
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
