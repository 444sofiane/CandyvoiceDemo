
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function interleave(left, right) {
  const length = left.length + right.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index] = left[inputIndex];
    result[index + 1] = right[inputIndex];
    index += 2;
    inputIndex += 1;
  }
  return result;
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

export function audioBufferToWavBlob(audioBuffer) {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;

  const samples = numChannels === 2
    ? interleave(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1))
    : audioBuffer.getChannelData(0);

  const bytesPerSample = bitDepth / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Decodes `file` with the Web Audio API and re-encodes it as a WAV File.
 * @param {File} file
 * @param {{ onProgress?: (stage: 'decoding' | 'encoding') => void }} [options]
 * @returns {Promise<File>}
 */
export async function convertFileToWav(file, { onProgress } = {}) {
  const isWavFile = file.type === 'audio/wav' || /\.wav$/i.test(file.name);
  if (isWavFile) {
    return file;
  }

  const arrayBuffer = await file.arrayBuffer();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio API is not supported in this browser, so files cannot be converted.');
  }

  const decodeCtx = new AudioContextClass();
  let audioBuffer;
  try {
    if (onProgress) onProgress('decoding');
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    throw new Error(`Could not decode "${file.name}". This format may not be supported by your browser.`);
  } finally {
    decodeCtx.close().catch(() => {});
  }

  if (onProgress) onProgress('encoding');
  const wavBlob = audioBufferToWavBlob(audioBuffer);

  const baseName = file.name.replace(/\.[^.]+$/u, '') || 'audio';
  return new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });
}
