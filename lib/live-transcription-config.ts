/**
 * Shared Live API identifiers. Keep this module browser-safe: it is imported by both the
 * token issuer and the microphone client.
 */
export const LIVE_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe-live';

// @google/genai 2.24.0's experimental ephemeral-token transport uses v1alpha.
// Keep both issuance and browser connection on the same version until the SDK promotes it.
export const LIVE_TRANSCRIPTION_API_VERSION = 'v1alpha';

// A failed WebSocket handshake otherwise leaves the interruption UI in "connecting" forever.
export const LIVE_CONNECT_TIMEOUT_MS = 12_000;
