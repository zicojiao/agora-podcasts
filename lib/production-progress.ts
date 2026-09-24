export type ProductionPhase = 'scripting' | 'buffering';

export const PRODUCTION_STEPS = [
  {
    label: 'Write the show',
    technicalLabel: 'Gemini script',
  },
  {
    label: 'Create the voices',
    technicalLabel: 'Gemini 3.8 Flash TTS',
  },
  {
    label: 'Go live',
    technicalLabel: 'Agora RTC',
  },
] as const;

const WRITING_DETAILS = [
  'Gemini is reading your brief and finding the strongest angle.',
  'The full two-host conversation is being written in one pass.',
  'The opening, discussion, and sign-off are being polished.',
  'Next, Gemini TTS will turn the script into two distinct voices.',
] as const;

const VOICE_DETAILS = [
  'The script is ready. Gemini TTS is creating the opening audio.',
  'The first audio frames are being prepared for playback.',
  'Agora will publish the same program track to everyone in the room.',
] as const;

export function productionProgressFor(phase: ProductionPhase, copyIndex: number) {
  const activeStep = phase === 'scripting' ? 0 : 1;
  const details = phase === 'scripting' ? WRITING_DETAILS : VOICE_DETAILS;
  const normalizedIndex = Math.abs(Math.trunc(copyIndex)) % details.length;

  return {
    activeStep,
    title: phase === 'scripting'
      ? 'Writing the two-host conversation'
      : 'Creating the opening two-host audio',
    detail: details[normalizedIndex],
  };
}
