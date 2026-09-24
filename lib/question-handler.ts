import { NextRequest } from 'next/server';
import {
  ANSWER_TURNS_MAX,
  ANSWER_TURNS_MIN,
  HOST_NAME_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  SOURCE_MAX_LENGTH,
  TURN_TEXT_MAX_LENGTH,
  VOCAL_TAGS,
  isPodcastVoice,
  parseTurnList,
  sanitizeAnswerContext,
  type Host,
  type Turn,
} from '@/lib/episode';
import {
  apiError,
  generateContentJson,
  getTextModelId,
  postGenerateContent,
  providerFailure,
  type GeminiFetch,
} from '@/lib/gemini-transport';

const ANSWER_TIMEOUT_MS = 45_000;
const MAX_RECENT_TURNS = 8;

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
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
  required: ['turns'],
} as const;

export const ANSWER_SYSTEM_INSTRUCTION = [
  'A listener has interrupted a live two-host podcast to ask a question. Write the hosts\' spoken reply.',
  '',
  `Produce ${ANSWER_TURNS_MIN}–${ANSWER_TURNS_MAX} turns, and no more.`,
  '- The first turn must address the listener by name and restate or tightly paraphrase their question before answering it.',
  '- The rest answers the question directly, using only the supplied source text and what the hosts have already said.',
  '',
  'Only one host addresses the listener. Once the first turn has done it, the other host goes',
  'straight into the substance — two hosts both saying "great question" in a row is the single',
  'most common way this comes out sounding artificial.',
  '',
  'End the answer naturally with a brief handoff back to the show. Do not sign off or',
  're-introduce the episode; the original audio resumes immediately after your reply.',
  '',
  'Hard rules:',
  '- Answer the question that was asked. Do not restart the episode or re-introduce the show.',
  '- If the source does not cover it, say so in one clear sentence instead of speculating. Never invent facts or citations.',
  `- Each turn is at most ${TURN_TEXT_MAX_LENGTH} characters. Keep the whole reply tight — this is an aside, not a new segment.`,
  '- Stay in the established voice of each host.',
  '- This is spoken aloud. Contract everything a speaker would contract ("that\'s", "it\'s", "let\'s",',
  '  "don\'t"). Writing "that is" or "let us" where a person would say "that\'s" or "let\'s" sounds stilted.',
  '',
  'The "text" field is spoken aloud verbatim: no stage directions, speaker labels, or markdown.',
  `The only inline markup allowed is ${VOCAL_TAGS.join(' ')}, used at most once or twice.`,
  'The "style" field is an unspoken delivery note and is always required.',
].join('\n');

function parseHosts(value: unknown): [Host, Host] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const hosts = (['host-a', 'host-b'] as const).map((hostId, index) => {
    const entry = value[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { id, name, role, voice } = entry as Record<string, unknown>;
    if (id !== hostId) return null;
    if (typeof name !== 'string' || !name.trim() || name.length > HOST_NAME_MAX_LENGTH) return null;
    if (!isPodcastVoice(voice)) return null;
    return {
      id: hostId,
      name: name.trim(),
      role: typeof role === 'string' ? role.trim().slice(0, 120) : '',
      voice,
    } as Host;
  });
  return hosts.some((host) => host === null) ? null : (hosts as [Host, Host]);
}

export function buildAnswerPayload({
  source,
  title,
  summary,
  hosts,
  recentTurns,
  question,
  askerName,
}: {
  source: string;
  title: string;
  summary: string;
  hosts: [Host, Host];
  recentTurns: Turn[];
  question: string;
  askerName: string;
}) {
  const nameFor = (hostId: string) => hosts.find((host) => host.id === hostId)?.name ?? hostId;
  const transcript = recentTurns.length
    ? recentTurns.map((turn) => `${nameFor(turn.hostId)}: ${turn.text}`).join('\n')
    : '(the episode has only just started)';

  return {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          `Episode: ${title}`,
          `About: ${summary}`,
          `host-a is ${hosts[0].name} (${hosts[0].role}). host-b is ${hosts[1].name} (${hosts[1].role}).`,
          '',
          '--- WHAT THE HOSTS JUST SAID ---',
          transcript,
          '--- END ---',
          '',
          '--- SOURCE TEXT ---',
          source,
          '--- END SOURCE TEXT ---',
          '',
          `A listener named ${askerName} asked, out loud:`,
          question,
        ].join('\n'),
      }],
    }],
    systemInstruction: { parts: [{ text: ANSWER_SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ANSWER_SCHEMA,
      temperature: 0.7,
      // maxOutputTokens covers thinking tokens as well as the response on 2.5-series
      // models, and the answer itself is only a few hundred. A tight ceiling here fails as
      // MAX_TOKENS with an empty candidate rather than as a short answer.
      maxOutputTokens: 8_192,
      // The answer is short and grounded; a bounded thinking budget keeps latency down and
      // stops reasoning from consuming the whole allowance.
      thinkingConfig: { thinkingBudget: 1_024 },
    },
  };
}

export function createQuestionHandler({ fetchGoogle }: { fetchGoogle?: GeminiFetch } = {}) {
  return async function POST(request: NextRequest) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return apiError('Set GEMINI_API_KEY on the server to answer questions.', 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return apiError('Expected a JSON object', 400);
    }

    const raw = body as Record<string, unknown>;
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    if (!question || question.length > QUESTION_MAX_LENGTH) {
      return apiError(`The question must be 1–${QUESTION_MAX_LENGTH} characters.`, 400);
    }
    const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, SOURCE_MAX_LENGTH) : '';
    if (!source) return apiError('Source text is required.', 400);

    const hosts = parseHosts(raw.hosts);
    if (!hosts) return apiError('Two known hosts are required.', 400);

    const recentTurns = Array.isArray(raw.recentTurns)
      ? parseTurnList(raw.recentTurns.slice(-MAX_RECENT_TURNS), new Set(['host-a', 'host-b']), {
        min: 0,
        max: MAX_RECENT_TURNS,
      })
      : [];
    if (typeof recentTurns === 'string') return apiError(recentTurns, 400);

    const context = sanitizeAnswerContext({
      title: raw.title,
      summary: raw.summary,
      askerName: raw.askerName,
    });

    const model = getTextModelId();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]);

    try {
      const response = await postGenerateContent(
        model,
        buildAnswerPayload({ source, hosts, recentTurns, question, ...context }),
        apiKey,
        signal,
        fetchGoogle,
      );
      const draft = generateContentJson(response) as Record<string, unknown>;
      const turns = parseTurnList(draft.turns, new Set(['host-a', 'host-b']), {
        min: ANSWER_TURNS_MIN,
        max: ANSWER_TURNS_MAX,
      });
      if (typeof turns === 'string') {
        console.error('[answer] model output rejected', { reason: turns });
        return apiError(`The generated answer did not fit the required shape: ${turns}`, 502);
      }
      return Response.json({ turns }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return providerFailure(error, signal, 'answer');
    }
  };
}
