// SSE framing and normalization for the Interactions audio stream.
//
// Google's seven documented event types are interaction.created, step.start, step.delta,
// step.stop, interaction.completed, interaction.status_update, and error. Only the four
// that carry information this app acts on are forwarded; the rest are dropped rather than
// passed through, so the browser sees a small, closed event vocabulary.

export type NormalizedTtsStreamEvent =
  | { event: 'meta'; data: { interactionId: string | null; model: string | null } }
  | { event: 'audio'; data: { data: string; mimeType: string; sampleRate: number; channels: 1 } }
  | { event: 'complete'; data: { status: string } }
  | { event: 'error'; data: { error: string } };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_AUDIO_CHARS = 1_500_000;

/** Reassembles SSE frames across arbitrary network chunk boundaries. */
export class SseFrameDecoder {
  private buffer = '';

  push(chunk: string) {
    this.buffer = `${this.buffer}${chunk}`.replace(/\r\n/g, '\n');
    const frames: string[] = [];
    for (let boundary = this.buffer.indexOf('\n\n'); boundary >= 0; boundary = this.buffer.indexOf('\n\n')) {
      frames.push(this.buffer.slice(0, boundary));
      this.buffer = this.buffer.slice(boundary + 2);
    }
    return frames;
  }

  finish() {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining ? [remaining] : [];
  }
}

function frameData(frame: string) {
  return frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

/** Parses this app's own normalized SSE, in the browser. */
export function parseNormalizedTtsSseFrame(frame: string): NormalizedTtsStreamEvent | null {
  const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
  const raw = frameData(frame);
  if (!event || !raw) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('The server returned an invalid streaming event.');
  }

  if (event === 'meta') {
    return {
      event,
      data: {
        interactionId: typeof data.interactionId === 'string' ? data.interactionId : null,
        model: typeof data.model === 'string' ? data.model : null,
      },
    };
  }
  if (event === 'audio') {
    if (typeof data.data !== 'string' || typeof data.mimeType !== 'string'
      || !Number.isInteger(data.sampleRate) || data.channels !== 1) {
      throw new Error('The server returned an invalid audio event.');
    }
    return { event, data: { data: data.data, mimeType: data.mimeType, sampleRate: Number(data.sampleRate), channels: 1 } };
  }
  if (event === 'complete') {
    return { event, data: { status: typeof data.status === 'string' ? data.status : 'completed' } };
  }
  if (event === 'error') {
    return { event, data: { error: typeof data.error === 'string' ? data.error : 'The audio stream stopped.' } };
  }
  return null;
}

/** Validates and narrows one upstream Gemini frame. */
export function normalizeGeminiTtsSseFrame(frame: string): NormalizedTtsStreamEvent | 'done' | null {
  const data = frameData(frame);
  if (!data) return null;
  if (data === '[DONE]') return 'done';

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error('Gemini returned an invalid streaming event.');
  }
  const eventType = typeof value.event_type === 'string' ? value.event_type : '';

  if (eventType === 'interaction.created') {
    const interaction = value.interaction && typeof value.interaction === 'object'
      ? (value.interaction as Record<string, unknown>)
      : {};
    return {
      event: 'meta',
      data: {
        interactionId: typeof interaction.id === 'string' ? interaction.id : null,
        model: typeof interaction.model === 'string' ? interaction.model : null,
      },
    };
  }

  if (eventType === 'step.delta') {
    const delta = value.delta && typeof value.delta === 'object'
      ? (value.delta as Record<string, unknown>)
      : {};
    if (delta.type !== 'audio') return null;
    const audio = typeof delta.data === 'string' ? delta.data : '';
    const mimeType = typeof delta.mime_type === 'string' ? delta.mime_type : '';
    // `rate` is deprecated in the 2.24.0 schema and explicitly ignored; only sample_rate counts.
    const sampleRate = Number(delta.sample_rate);
    const channels = Number(delta.channels);
    if (!audio || audio.length > MAX_AUDIO_CHARS || !BASE64.test(audio)) {
      throw new Error('Gemini returned invalid streaming audio.');
    }
    if (!/^audio\/(?:l16|pcm)$/i.test(mimeType) || !Number.isInteger(sampleRate)
      || sampleRate < 8_000 || sampleRate > 192_000 || channels !== 1) {
      throw new Error('Gemini returned an unsupported streaming audio format.');
    }
    return { event: 'audio', data: { data: audio, mimeType, sampleRate, channels: 1 } };
  }

  if (eventType === 'interaction.completed') {
    const interaction = value.interaction && typeof value.interaction === 'object'
      ? (value.interaction as Record<string, unknown>)
      : {};
    return { event: 'complete', data: { status: typeof interaction.status === 'string' ? interaction.status : 'completed' } };
  }

  if (eventType === 'error') return { event: 'error', data: { error: 'Gemini stopped the audio stream.' } };

  // step.start, step.stop, interaction.status_update: no action needed.
  return null;
}

export function encodeSseEvent(value: NormalizedTtsStreamEvent) {
  return `event: ${value.event}\ndata: ${JSON.stringify(value.data)}\n\n`;
}

/** Upstream Gemini SSE → this app's normalized SSE, as a stream transform. */
export function normalizeTtsInteractionStream(source: ReadableStream<Uint8Array>) {
  const reader = source.getReader();
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  const frames = new SseFrameDecoder();
  let stopped = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitFrame = (frame: string) => {
        const normalized = normalizeGeminiTtsSseFrame(frame);
        if (normalized === 'done') {
          stopped = true;
          return;
        }
        if (normalized) controller.enqueue(textEncoder.encode(encodeSseEvent(normalized)));
      };
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const frame of frames.push(textDecoder.decode(value, { stream: true }))) emitFrame(frame);
        }
        if (!stopped) {
          for (const frame of frames.push(textDecoder.decode())) emitFrame(frame);
          for (const frame of frames.finish()) emitFrame(frame);
        }
      } catch {
        controller.enqueue(textEncoder.encode(encodeSseEvent({
          event: 'error',
          data: { error: 'The audio stream ended unexpectedly.' },
        })));
      } finally {
        controller.close();
        await reader.cancel().catch(() => undefined);
      }
    },
    async cancel(reason) {
      stopped = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
