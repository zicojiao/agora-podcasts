const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** mono PCM16LE bytes → float samples in [-1, 1]. */
export function decodePcm16Le(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.byteLength || bytes.byteLength % 2 !== 0) throw new Error('Invalid PCM audio length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    samples[index] = value < 0 ? value / 32_768 : value / 32_767;
  }
  return samples;
}

/** base64 mono PCM16LE → float samples in [-1, 1]. */
export function decodePcm16LeBase64(data: string) {
  if (!data || !BASE64.test(data)) throw new Error('Invalid PCM audio encoding.');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return decodePcm16Le(bytes);
}

/**
 * Linear resample. Gemini delivers 24 kHz; the AudioContext usually runs at 48 kHz, and the
 * two must match before samples reach the worklet.
 */
export function resampleLinear(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate) || sourceRate <= 0 || targetRate <= 0) {
    throw new Error('Invalid audio sample rate.');
  }
  if (!samples.length || sourceRate === targetRate) return samples.slice();
  const outputLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const scale = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * scale;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] + (samples[right] - samples[left]) * fraction;
  }
  return output;
}
