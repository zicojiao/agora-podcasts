import { NextRequest, NextResponse } from 'next/server';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { createRoomCode, isRoomChannel } from '@/lib/room-code';

const TOKEN_TTL_SECONDS = 3_600;

export function parseChannelName(value: string | null) {
  if (!value) return createRoomCode();
  return isRoomChannel(value) ? value : null;
}

export function parseUid(value: string | null, random: () => number = Math.random) {
  if (!value) return Math.floor(random() * 9_999_000) + 1_000;
  const parsed = Number.parseInt(value, 10);
  // Agora numeric UIDs must be a positive 32-bit integer.
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < 2 ** 32 ? parsed : null;
}

export function createAgoraTokenHandler() {
  return async function GET(request: NextRequest) {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
      return NextResponse.json(
        { error: 'Agora credentials are not set. Add NEXT_PUBLIC_AGORA_APP_ID and NEXT_AGORA_APP_CERTIFICATE.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const { searchParams } = new URL(request.url);
    const channel = parseChannelName(searchParams.get('channel'));
    if (!channel) {
      return NextResponse.json(
        { error: 'Room codes may use 3–64 letters, digits, hyphens, or underscores.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const uid = parseUid(searchParams.get('uid'));
    if (uid === null) {
      return NextResponse.json(
        { error: 'Invalid uid.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const expiration = Math.floor(Date.now() / 1_000) + TOKEN_TTL_SECONDS;
    try {
      // buildTokenWithRtm, not an RTC-only builder: the room needs RTM for floor control
      // and state, and an RTC-only token does not grant RTM access.
      const token = RtcTokenBuilder.buildTokenWithRtm(
        appId,
        appCertificate,
        channel,
        uid.toString(),
        RtcRole.PUBLISHER,
        expiration,
        expiration,
      );
      return NextResponse.json(
        { token, uid: uid.toString(), channel, expiresAt: expiration },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      console.error('[agora] token generation failed:', error instanceof Error ? error.message : error);
      return NextResponse.json(
        { error: 'Could not generate an Agora token.' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  };
}
