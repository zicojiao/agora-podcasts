import {
  HOST_NAME_MAX_LENGTH,
  SEGMENT_MAX_TEXT_LENGTH,
  STYLE_MAX_LENGTH,
  TURNS_PER_SEGMENT_MAX,
  TURN_TEXT_MAX_LENGTH,
  TURN_TEXT_MIN_LENGTH,
  isPodcastVoice,
  segmentTextLength,
  type Host,
  type HostId,
  type Turn,
} from '@/lib/episode';

export type SpeechRequest = {
  hosts: [Host, Host];
  turns: Turn[];
};

const DEFAULT_STYLE = 'natural, warm, conversational';

function parseRequestHost(value: unknown, expectedId: HostId): Host | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name, role, voice } = value as Record<string, unknown>;
  if (id !== expectedId) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > HOST_NAME_MAX_LENGTH) return null;
  if (!isPodcastVoice(voice)) return null;
  return {
    id: expectedId,
    name: name.trim(),
    role: typeof role === 'string' ? role.trim().slice(0, 120) : '',
    voice,
  };
}

/**
 * Validates one speech request — a base segment or an inserted answer. Bounded here rather
 * than trusted from the browser: this payload is forwarded to the Gemini API.
 */
export function parseSpeechRequest(value: unknown): SpeechRequest | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Expected a JSON object.';
  const { hosts, turns } = value as Record<string, unknown>;

  if (!Array.isArray(hosts) || hosts.length !== 2) return 'Exactly two hosts are required.';
  const hostA = parseRequestHost(hosts[0], 'host-a');
  const hostB = parseRequestHost(hosts[1], 'host-b');
  if (!hostA || !hostB) return 'Each host needs an id, a name, and a known voice.';
  if (hostA.name.toLowerCase() === hostB.name.toLowerCase()) return 'The two hosts need different names.';

  if (!Array.isArray(turns) || turns.length < 1 || turns.length > TURNS_PER_SEGMENT_MAX) {
    return `A speech request needs 1–${TURNS_PER_SEGMENT_MAX} turns.`;
  }
  const parsed = turns.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { hostId, text, style } = entry as Record<string, unknown>;
    if (hostId !== 'host-a' && hostId !== 'host-b') return null;
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length < TURN_TEXT_MIN_LENGTH || trimmed.length > TURN_TEXT_MAX_LENGTH) return null;
    if (style !== undefined && typeof style !== 'string') return null;
    const parsedStyle = typeof style === 'string' ? style.trim().slice(0, STYLE_MAX_LENGTH) : '';
    return { hostId, text: trimmed, ...(parsedStyle ? { style: parsedStyle } : {}) } as Turn;
  });
  if (parsed.some((turn) => turn === null)) {
    return `Each turn needs a known host and ${TURN_TEXT_MIN_LENGTH}–${TURN_TEXT_MAX_LENGTH} characters of text.`;
  }
  const validTurns = parsed as Turn[];
  if (segmentTextLength(validTurns) > SEGMENT_MAX_TEXT_LENGTH) {
    return `A speech request must be at most ${SEGMENT_MAX_TEXT_LENGTH} characters of spoken text.`;
  }
  return { hosts: [hostA, hostB], turns: validTurns };
}

/**
 * Builds the two-speaker Interactions payload.
 *
 * Shape follows Google's public multi-speaker TTS guide: each spoken line is a `text`
 * content block carrying a `speech_metadata` annotation that names the speaker and their
 * delivery, and `speech_config.mode: 'conversational'` tells the model to perform the whole
 * exchange as one conversation rather than as independent reads.
 */
export function buildSpeechPayload(request: SpeechRequest, model: string, stream = false) {
  const nameFor = (hostId: HostId) =>
    (request.hosts.find((host) => host.id === hostId) ?? request.hosts[0]).name;

  return {
    model,
    input: [{
      type: 'user_input',
      content: request.turns.map((turn) => ({
        type: 'text',
        text: turn.text,
        annotations: [{
          type: 'speech_metadata',
          speaker: nameFor(turn.hostId),
          style: turn.style || DEFAULT_STYLE,
        }],
      })),
    }],
    ...(stream ? { stream: true } : {}),
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: {
        mode: 'conversational',
        speakers: request.hosts.map((host) => ({ speaker: host.name, voice: host.voice })),
      },
    },
  };
}
