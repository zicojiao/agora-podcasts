import type { CaptureResult, Properties } from 'posthog-js';

const SENSITIVE_PROPERTY_NAMES = new Set([
  'audio',
  'channel',
  'display_name',
  'error',
  'name',
  'room',
  'room_id',
  'source',
  'source_text',
  'text',
  'transcript',
]);

export function stripUrlDetails(value: string) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export function sanitizeAnalyticsProperties(properties: Properties) {
  const sanitized: Properties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (SENSITIVE_PROPERTY_NAMES.has(key.toLowerCase())) continue;

    const lowerKey = key.toLowerCase();
    sanitized[key] = typeof value === 'string'
      && (lowerKey.includes('url') || lowerKey.includes('referrer'))
      ? stripUrlDetails(value)
      : value;
  }

  return sanitized;
}

export function sanitizeAnalyticsCapture(capture: CaptureResult | null) {
  if (!capture) return null;

  return {
    ...capture,
    properties: sanitizeAnalyticsProperties(capture.properties),
    $set: undefined,
    $set_once: undefined,
    $unset: undefined,
  } satisfies CaptureResult;
}
