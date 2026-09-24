export const FLOOR_SETUP_TIMEOUT_MS = 45_000;
export const NO_SPEECH_TIMEOUT_MS = 12_000;

type FloorDeadlineReason = 'setup' | 'silence';

export class FloorTimeoutController {
  private timerId: number | null = null;
  private readonly schedule: (callback: () => void, delayMs: number) => number;
  private readonly cancel: (id: number) => void;
  private readonly onExpire: (reason: FloorDeadlineReason) => void;

  constructor({
    schedule,
    cancel,
    onExpire,
  }: {
    schedule: (callback: () => void, delayMs: number) => number;
    cancel: (id: number) => void;
    onExpire: (reason: FloorDeadlineReason) => void;
  }) {
    this.schedule = schedule;
    this.cancel = cancel;
    this.onExpire = onExpire;
  }

  private replace(reason: FloorDeadlineReason, delayMs: number) {
    this.clear();
    this.timerId = this.schedule(() => {
      this.timerId = null;
      this.onExpire(reason);
    }, delayMs);
  }

  granted() {
    this.replace('setup', FLOOR_SETUP_TIMEOUT_MS);
  }

  ready() {
    this.replace('silence', NO_SPEECH_TIMEOUT_MS);
  }

  activity() {
    this.replace('silence', NO_SPEECH_TIMEOUT_MS);
  }

  clear() {
    if (this.timerId === null) return;
    this.cancel(this.timerId);
    this.timerId = null;
  }
}

export function shouldPrepareLiveTranscription({
  requestingFloor,
  holdsFloor,
  phase,
  submitted,
}: {
  requestingFloor: boolean;
  holdsFloor: boolean;
  phase: string;
  submitted: boolean;
}) {
  if (submitted) return false;
  return requestingFloor || (holdsFloor && phase === 'listening');
}
