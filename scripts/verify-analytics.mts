import assert from 'node:assert/strict';
import {
  sanitizeAnalyticsCapture,
  sanitizeAnalyticsProperties,
  stripUrlDetails,
} from '@/lib/analytics-privacy';

assert.equal(
  stripUrlDetails('https://agora-podcasts.vercel.app/?room=room-secret&utm_source=x#studio'),
  'https://agora-podcasts.vercel.app/',
);

const properties = sanitizeAnalyticsProperties({
  $current_url: 'https://agora-podcasts.vercel.app/?room=room-secret',
  $referrer: 'https://example.com/path?private=yes',
  room_id: 'room-secret',
  transcript: 'private listener question',
  source_text: 'private pasted article',
  role: 'listener',
  entry_method: 'share_link',
});

assert.deepEqual(properties, {
  $current_url: 'https://agora-podcasts.vercel.app/',
  $referrer: 'https://example.com/path',
  role: 'listener',
  entry_method: 'share_link',
});

const capture = sanitizeAnalyticsCapture({
  uuid: 'test',
  event: 'question_submitted',
  properties,
  $set: { name: 'private' },
});

assert.equal(capture?.$set, undefined);
assert.equal(capture?.$set_once, undefined);
assert.equal(capture?.$unset, undefined);

console.log('✓ privacy-minimal analytics checks passed');
