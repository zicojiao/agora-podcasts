// Domain core for a two-host episode. Shared by the server routes that validate model
// output, the client that renders it, and the contract verification script.

export const HOST_IDS = ['host-a', 'host-b'] as const;
export type HostId = (typeof HOST_IDS)[number];

// Preset voices supported by the Gemini TTS integration.
export const PODCAST_VOICES = [
  'Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;
export type PodcastVoice = (typeof PODCAST_VOICES)[number];

// These are the two preset voices used for the podcast's fixed hosts.
export const VERIFIED_VOICES = ['Kore', 'Puck'] as const;

// Inline vocal events supported by the Gemini TTS guide.
export const VOCAL_TAGS = ['<laugh>', '<breath>', '<sigh>', '<short pause>'] as const;

export const SOURCE_MIN_LENGTH = 8;
export const SOURCE_MAX_LENGTH = 20_000;
export const SEGMENT_MIN_COUNT = 2;
export const SEGMENT_MAX_COUNT = 4;
export const TURNS_PER_SEGMENT_MIN = 4;
export const TURNS_PER_SEGMENT_MAX = 18;
export const TURN_TEXT_MIN_LENGTH = 12;
export const TURN_TEXT_MAX_LENGTH = 420;
export const STYLE_MAX_LENGTH = 200;
export const HOST_NAME_MAX_LENGTH = 50;
export const HOST_ROLE_MAX_LENGTH = 120;
export const TITLE_MAX_LENGTH = 90;
export const SUMMARY_MAX_LENGTH = 320;
export const QUESTION_MAX_LENGTH = 500;
export const ANSWER_TURNS_MIN = 2;
export const ANSWER_TURNS_MAX = 4;

// One segment is one Interactions request. Segments are long enough to carry
// conversational momentum (~90s) without creating many audible generation seams.
export const SEGMENT_MAX_TEXT_LENGTH = 2_600;
export const EPISODE_MAX_TEXT_LENGTH = 9_000;

// Used only to place provisional turn boundaries before a segment finishes streaming; the
// boundaries are rescaled to the real audio length once the actual sample count is known.
// Measured against live Gemini 3.8 Flash TTS output: 1080 chars → 73.6s and 1116 chars → 72.8s,
// i.e. 14.7 and 15.3 chars/second.
export const ESTIMATED_CHARS_PER_SECOND = 15.0;

export type Host = {
  id: HostId;
  name: string;
  role: string;
  voice: PodcastVoice;
};

export type Turn = {
  hostId: HostId;
  text: string;
  style?: string;
};

export type Segment = {
  id: string;
  topic: string;
  turns: Turn[];
};

export type Episode = {
  id: string;
  title: string;
  summary: string;
  hosts: [Host, Host];
  segments: Segment[];
};

export function isPodcastVoice(value: unknown): value is PodcastVoice {
  return typeof value === 'string' && PODCAST_VOICES.some((voice) => voice === value);
}

export function isVerifiedVoice(voice: PodcastVoice) {
  return VERIFIED_VOICES.some((verified) => verified === voice);
}

export function isHostId(value: unknown): value is HostId {
  return value === 'host-a' || value === 'host-b';
}

function boundedString(value: unknown, max: number, min = 1) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

function parseTurn(value: unknown, hostIds: Set<string>): Turn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { hostId, text, style } = value as Record<string, unknown>;
  if (!isHostId(hostId) || !hostIds.has(hostId)) return null;
  const parsedText = boundedString(text, TURN_TEXT_MAX_LENGTH, TURN_TEXT_MIN_LENGTH);
  if (!parsedText) return null;
  if (style !== undefined && style !== null && typeof style !== 'string') return null;
  const parsedStyle = typeof style === 'string' ? style.trim().slice(0, STYLE_MAX_LENGTH) : '';
  return { hostId, text: parsedText, ...(parsedStyle ? { style: parsedStyle } : {}) };
}

export function parseTurnList(
  value: unknown,
  hostIds: Set<string>,
  { min, max }: { min: number; max: number },
): Turn[] | string {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return `Expected ${min}–${max} dialogue turns.`;
  }
  const turns = value.map((entry) => parseTurn(entry, hostIds));
  if (turns.some((turn) => turn === null)) {
    return `Each turn needs a known host and ${TURN_TEXT_MIN_LENGTH}–${TURN_TEXT_MAX_LENGTH} characters of text.`;
  }
  return turns as Turn[];
}

function parseHost(value: unknown, expectedId: HostId): Host | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name, role, voice } = value as Record<string, unknown>;
  if (id !== expectedId) return null;
  const parsedName = boundedString(name, HOST_NAME_MAX_LENGTH);
  const parsedRole = boundedString(role, HOST_ROLE_MAX_LENGTH);
  if (!parsedName || !parsedRole || !isPodcastVoice(voice)) return null;
  return { id: expectedId, name: parsedName, role: parsedRole, voice };
}

/**
 * Validates a structured episode. Returns the narrowed value, or a human-readable reason.
 * Applied to text-model output before any of it reaches the TTS transport or the browser.
 */
export function parseEpisode(value: unknown): Episode | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Expected a JSON object.';
  const { id, title, summary, hosts, segments } = value as Record<string, unknown>;

  const parsedId = boundedString(id, 64) ?? `ep-${Date.now().toString(36)}`;
  const parsedTitle = boundedString(title, TITLE_MAX_LENGTH);
  if (!parsedTitle) return `Episode title must be 1–${TITLE_MAX_LENGTH} characters.`;
  const parsedSummary = boundedString(summary, SUMMARY_MAX_LENGTH);
  if (!parsedSummary) return `Episode summary must be 1–${SUMMARY_MAX_LENGTH} characters.`;

  if (!Array.isArray(hosts) || hosts.length !== 2) return 'Exactly two hosts are required.';
  const hostA = parseHost(hosts[0], 'host-a');
  const hostB = parseHost(hosts[1], 'host-b');
  if (!hostA || !hostB) return 'Each host needs an id, name, role, and a known voice.';
  // The Interactions API identifies speakers by name, so the two names must differ.
  if (hostA.name.toLowerCase() === hostB.name.toLowerCase()) return 'The two hosts need different names.';
  if (hostA.voice === hostB.voice) return 'The two hosts need different voices.';

  if (!Array.isArray(segments) || segments.length < SEGMENT_MIN_COUNT || segments.length > SEGMENT_MAX_COUNT) {
    return `An episode needs ${SEGMENT_MIN_COUNT}–${SEGMENT_MAX_COUNT} segments.`;
  }

  const hostIds = new Set<string>(HOST_IDS);
  const parsedSegments: Segment[] = [];
  let totalLength = 0;

  for (const [index, entry] of segments.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `Segment ${index + 1} is not an object.`;
    const { id: segmentId, topic, turns } = entry as Record<string, unknown>;
    const parsedTopic = boundedString(topic, TITLE_MAX_LENGTH);
    if (!parsedTopic) return `Segment ${index + 1} needs a topic.`;
    const parsedTurns = parseTurnList(turns, hostIds, {
      min: TURNS_PER_SEGMENT_MIN,
      max: TURNS_PER_SEGMENT_MAX,
    });
    if (typeof parsedTurns === 'string') return `Segment ${index + 1}: ${parsedTurns}`;

    const segmentLength = segmentTextLength(parsedTurns);
    if (segmentLength > SEGMENT_MAX_TEXT_LENGTH) {
      return `Segment ${index + 1} must be at most ${SEGMENT_MAX_TEXT_LENGTH} characters of spoken text.`;
    }
    totalLength += segmentLength;
    parsedSegments.push({
      id: boundedString(segmentId, 64) ?? `seg-${index + 1}`,
      topic: parsedTopic,
      turns: parsedTurns,
    });
  }

  if (totalLength > EPISODE_MAX_TEXT_LENGTH) {
    return `The episode must be at most ${EPISODE_MAX_TEXT_LENGTH} characters of spoken text.`;
  }
  // Both hosts must actually speak, otherwise the two-speaker request is pointless.
  const spoken = new Set(parsedSegments.flatMap((segment) => segment.turns.map((turn) => turn.hostId)));
  if (spoken.size !== 2) return 'Both hosts must speak at least once.';

  return {
    id: parsedId,
    title: parsedTitle,
    summary: parsedSummary,
    hosts: [hostA, hostB],
    segments: parsedSegments,
  };
}

/** Bounds the free-text context fields that ride along with an interruption question. */
export function sanitizeAnswerContext({
  title,
  summary,
  askerName,
}: {
  title: unknown;
  summary: unknown;
  askerName: unknown;
}) {
  const text = (value: unknown, max: number, fallback: string) => {
    if (typeof value !== 'string') return fallback;
    const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max);
    return cleaned || fallback;
  };
  return {
    title: text(title, TITLE_MAX_LENGTH, 'Untitled episode'),
    summary: text(summary, SUMMARY_MAX_LENGTH, 'An episode about the supplied source text.'),
    askerName: text(askerName, 24, 'a listener'),
  };
}

export function segmentTextLength(turns: Turn[]) {
  return turns.reduce((total, turn) => total + turn.text.length, 0);
}

export function episodeTextLength(episode: Episode) {
  return episode.segments.reduce((total, segment) => total + segmentTextLength(segment.turns), 0);
}

export function findHost(episode: Episode, hostId: HostId) {
  return episode.hosts.find((host) => host.id === hostId) ?? episode.hosts[0];
}

export function estimateSegmentSeconds(turns: Turn[]) {
  return segmentTextLength(turns) / ESTIMATED_CHARS_PER_SECOND;
}

/**
 * Proportional turn boundaries within one segment, in samples.
 *
 * The Interactions stream carries no per-turn speaker identity — `step.delta` has only
 * `delta`, `index`, and optional usage metadata — so which host is currently speaking has
 * to be derived on the client. Boundaries are apportioned by character count, which tracks
 * speech duration closely enough for a highlight. Pass `totalSamples` once the segment has
 * finished streaming to rescale the estimate onto the real audio length.
 */
export function turnBoundaries(turns: Turn[], sampleRate: number, totalSamples?: number) {
  const lengths = turns.map((turn) => Math.max(1, turn.text.length));
  const totalChars = lengths.reduce((total, length) => total + length, 0);
  const estimatedTotal = (totalChars / ESTIMATED_CHARS_PER_SECOND) * sampleRate;
  const scale = totalSamples && estimatedTotal > 0 ? totalSamples / estimatedTotal : 1;

  let cursor = 0;
  return lengths.map((length) => {
    const duration = (length / ESTIMATED_CHARS_PER_SECOND) * sampleRate * scale;
    const start = cursor;
    cursor += duration;
    return { startSample: Math.round(start), endSample: Math.round(cursor) };
  });
}
