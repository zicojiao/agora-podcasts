/**
 * Collapses concurrent calls into one in-flight attempt.
 *
 * Opening a microphone takes long enough that a re-rendering effect can fire the same
 * request dozens of times before the first resolves. Without this, each call starts its own
 * getUserMedia and publishes a separate track — the caller ends up holding a different track
 * than the one that is actually live.
 *
 * The result is deliberately not cached: once an attempt settles, the next call starts a new
 * one. Callers that want a stable result should check their own "already have it" guard
 * first, as `publishMicrophone` does.
 */
export function createSingleFlight<T>() {
  let pending: Promise<T> | null = null;

  return {
    run(operation: () => Promise<T>): Promise<T> {
      if (pending) return pending;
      const attempt = operation();
      pending = attempt;
      const clear = () => {
        if (pending === attempt) pending = null;
      };
      attempt.then(clear, clear);
      return attempt;
    },
    /** Drops the in-flight attempt so the next call starts fresh. */
    reset() {
      pending = null;
    },
    get inFlight() {
      return pending !== null;
    },
  };
}

export type SingleFlight<T> = ReturnType<typeof createSingleFlight<T>>;
