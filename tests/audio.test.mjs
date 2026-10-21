import assert from "node:assert/strict";
import test from "node:test";
import { encodeStereoWav, formatBytes, formatDuration } from "../web/audio.js";

test("encodeStereoWav writes a valid stereo PCM header", async () => {
  const blob = encodeStereoWav(new Float32Array([-1, 0.5]), new Float32Array([1, -0.5]));
  const view = new DataView(await blob.arrayBuffer());
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 32767);
});

test("audio helpers format user-facing values", () => {
  assert.equal(formatBytes(1_572_864), "1.5 MB");
  assert.equal(formatDuration(125.4), "2:05");
});

test("encodeStereoWav rejects unequal channels", () => {
  assert.throws(() => encodeStereoWav(new Float32Array(1), new Float32Array(2)), /equal lengths/);
});

test("encodeStereoWav rejects invalid samples", () => {
  assert.throws(() => encodeStereoWav(new Float32Array([Number.NaN]), new Float32Array(1)), /invalid sample/);
});
