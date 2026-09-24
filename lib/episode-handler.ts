import { NextRequest } from 'next/server';
import {
  SEGMENT_MAX_COUNT,
  SEGMENT_MAX_TEXT_LENGTH,
  SEGMENT_MIN_COUNT,
  SOURCE_MAX_LENGTH,
  SOURCE_MIN_LENGTH,
  TURNS_PER_SEGMENT_MAX,
  TURNS_PER_SEGMENT_MIN,
  TURN_TEXT_MAX_LENGTH,
  VOCAL_TAGS,
  parseEpisode,
  type Host,
} from '@/lib/episode';
import {
  apiError,
  generateContentJson,
  getTextModelId,
  postGenerateContent,
  providerFailure,
  type GeminiFetch,
} from '@/lib/gemini-transport';

// Keep names and voices together: the TTS API identifies speakers by name, so allowing the
// script model to choose names can attach a feminine name to the masculine-sounding voice.
export const PODCAST_HOSTS: [Host, Host] = [
  { id: 'host-a', name: 'Marcus', role: 'Host', voice: 'Puck' },
  { id: 'host-b', name: 'Elena', role: 'Co-host', voice: 'Kore' },
];

const SCRIPT_TIMEOUT_MS = 90_000;

export const EPISODE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ['host-a', 'host-b'] },
          name: { type: 'string', enum: ['Marcus', 'Elena'] },
          role: { type: 'string' },
        },
        required: ['id', 'name', 'role'],
      },
    },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          turns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                hostId: { type: 'string', enum: ['host-a', 'host-b'] },
                text: { type: 'string' },
                style: { type: 'string' },
              },
              required: ['hostId', 'text', 'style'],
            },
          },
        },
        required: ['topic', 'turns'],
      },
    },
  },
  required: ['title', 'summary', 'hosts', 'segments'],
} as const;

export const SCRIPT_SYSTEM_INSTRUCTION = [
  'You write short two-host podcast episodes that sound like two people genuinely talking, not like a summary read aloud.',
  '',
  'Grounding:',
  '- The input may be a topic, a question, a few notes, or a detailed source passage. Treat it as the creative brief for the episode.',
  '- When the brief is short, develop it with useful explanation, tensions, examples, and open questions drawn from general knowledge and clear reasoning.',
  '- Never invent precise statistics, quotations, studies, names, dates, or citations that the brief does not provide.',
  '- When the brief provides specific facts, preserve them accurately. If an important detail is unknown, have a host say so plainly.',
  '',
  'Structure:',
  `- Produce ${SEGMENT_MIN_COUNT}–${SEGMENT_MAX_COUNT} segments. Each segment is one continuous stretch of conversation on one facet of the material.`,
  `- Each segment holds ${TURNS_PER_SEGMENT_MIN}–${TURNS_PER_SEGMENT_MAX} turns and at most ${SEGMENT_MAX_TEXT_LENGTH} characters of spoken text.`,
  `- Each turn is at most ${TURN_TEXT_MAX_LENGTH} characters and carries one speakable idea. Vary turn length; real conversation is uneven.`,
  '- The hosts alternate, but not mechanically. Let one host carry two turns in a row when the material calls for it.',
  '- The very first spoken turn must feel like a real show opening: begin with a light <laugh> or warm energy, welcome the listener to the podcast, introduce both hosts, and name the subject.',
  '- The final spoken turn must be a real sign-off, not a trailing thought: briefly land the point, thank the listener, and end with “That’s today’s episode of Agora Podcasts.”',
  '',
  'Voice:',
  '- host-a is Marcus, a man with the Puck voice. He leads and drives structure.',
  '- host-b is Elena, a woman with the Kore voice. She digs in, pushes back, and asks the question the listener is thinking.',
  '- These identities are fixed. Never swap their names, pronouns, speaker IDs, or voices. In the spoken opening, Marcus introduces himself as Marcus and Elena introduces herself as Elena.',
  '',
  'This text is spoken aloud, so write how people actually talk, not how they write:',
  '- Contract everything a speaker would contract: "that\'s", "it\'s", "we\'re", "let\'s", "don\'t", "they\'d".',
  '  Writing "that is" or "let us" where a person would say "that\'s" or "let\'s" makes the audio sound stilted.',
  '- Short clauses. Occasional sentence fragments. Start a sentence with "And" or "But" when it fits.',
  '- Hosts interrupt, agree mid-thought, and finish each other\'s points.',
  '',
  'The "text" field is spoken aloud verbatim. It must contain no stage directions, speaker labels, markdown, or bracketed asides.',
  `The only exception is these inline vocal events, which may be placed at the exact point they should occur: ${VOCAL_TAGS.join(' ')}.`,
  '- In the opening exchange, deliberately demonstrate 2–3 different vocal events across the first few turns when they fit: a light <laugh>, a settling <breath>, or a purposeful <short pause>.',
  '- Use <laugh> for real amusement or rapport; <breath> before a substantial idea or shift; <short pause> around a question, reveal, or conclusion; and <sigh> only for genuine frustration, tension, or resignation.',
  '- After the opening, use events sparingly and only when the meaning motivates them. Never stack tags or repeat the same event in adjacent turns.',
  '',
  'The "style" field is a short delivery note for the voice model (for example "warm, curious" or "dry, a little skeptical"). It is never spoken. Always supply one.',
  '- Make every style concrete and performable. Vary delivery with the conversation rather than assigning one generic mood to the whole episode.',
].join('\n');

export function buildScriptPayload(source: string) {
  return {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          'Develop a complete episode from the topic or notes below. A short brief is intentional: expand it into a thoughtful conversation.',
          '',
          '--- TOPIC OR NOTES ---',
          source,
          '--- END TOPIC OR NOTES ---',
        ].join('\n'),
      }],
    }],
    systemInstruction: { parts: [{ text: SCRIPT_SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EPISODE_SCHEMA,
      temperature: 0.85,
      // On 2.5-series models maxOutputTokens covers thinking tokens too. A full four-segment
      // episode is a few thousand tokens of JSON on its own, so leave real headroom — running
      // out surfaces as MAX_TOKENS with an empty candidate, not as a shorter episode.
      maxOutputTokens: 16_384,
      // Structuring a conversation genuinely benefits from planning, so this budget is
      // generous, but bounded so the allowance cannot be consumed entirely by reasoning.
      thinkingConfig: { thinkingBudget: 4_096 },
    },
  };
}

export function createEpisodeHandler({ fetchGoogle }: { fetchGoogle?: GeminiFetch } = {}) {
  return async function POST(request: NextRequest) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return apiError('Set GEMINI_API_KEY on the server to generate episodes.', 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return apiError('Expected a JSON object', 400);
    }

    const { source, voices } = body as Record<string, unknown>;
    if (typeof source !== 'string') return apiError('Source text is required.', 400);
    const trimmedSource = source.trim();
    if (trimmedSource.length < SOURCE_MIN_LENGTH || trimmedSource.length > SOURCE_MAX_LENGTH) {
      return apiError(
        `Source text must be ${SOURCE_MIN_LENGTH.toLocaleString()}–${SOURCE_MAX_LENGTH.toLocaleString()} characters.`,
        400,
      );
    }
    if (voices !== undefined) return apiError('Voice selection is not supported for the fixed hosts.', 400);

    const model = getTextModelId();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SCRIPT_TIMEOUT_MS)]);

    try {
      const response = await postGenerateContent(
        model,
        buildScriptPayload(trimmedSource),
        apiKey,
        signal,
        fetchGoogle,
      );
      const draft = generateContentJson(response) as Record<string, unknown>;

      // The model writes the dialogue; the server owns each speaker's name, role, and voice.
      const candidate = {
        ...draft,
        id: `ep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        hosts: PODCAST_HOSTS.map((host) => ({ ...host })),
        segments: Array.isArray(draft.segments)
          ? draft.segments.map((segment, index) => ({
            ...(segment && typeof segment === 'object' ? segment : {}),
            id: `seg-${index + 1}`,
          }))
          : draft.segments,
      };

      const parsedEpisode = parseEpisode(candidate);
      if (typeof parsedEpisode === 'string') {
        console.error('[episode] model output rejected', { reason: parsedEpisode });
        return apiError(`The generated episode did not fit the required shape: ${parsedEpisode}`, 502);
      }
      return Response.json(
        { episode: parsedEpisode },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      return providerFailure(error, signal, 'script');
    }
  };
}
