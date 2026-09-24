'use client';

import type {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
  ILocalAudioTrack,
} from 'agora-rtc-sdk-ng';
import type { RTMClient } from 'agora-rtm';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decodeRoomMessage,
  encodeRoomMessage,
  reduceRoomChatMessages,
  sanitizeChatText,
  sanitizeDisplayName,
  type ChatMessage,
  type RoomChatMessage,
  type RoomMessage,
} from '@/lib/room-messages';
import { createSingleFlight } from '@/lib/single-flight';
import { closeRealtimeRoom } from '@/lib/realtime-room-cleanup';
import { acquireAndPublishMicrophone } from '@/lib/microphone-publish';

export type RoomRole = 'host' | 'listener';
export type RoomConnection = 'idle' | 'connecting' | 'connected' | 'failed';

export type RoomMember = {
  uid: string;
  name: string;
};

export type { RoomChatMessage } from '@/lib/room-messages';

type TokenResponse = {
  token: string;
  uid: string;
  channel: string;
  expiresAt: number;
};

type UseAgoraRoomOptions = {
  channel: string | null;
  role: RoomRole;
  displayName: string;
  onMessage: (message: RoomMessage, publisher: string) => void;
};

async function requestToken(channel: string, uid?: string): Promise<TokenResponse> {
  const query = new URLSearchParams({ channel, ...(uid ? { uid } : {}) });
  const response = await fetch(`/api/agora-token?${query.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.token !== 'string') {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Could not get an Agora token.');
  }
  return payload as TokenResponse;
}

/**
 * Owns the room's real-time lifecycle: one RTC client for audio and one RTM client for
 * floor control and state, both on the same channel and the same UID.
 *
 * The host publishes the mixed program as a custom audio track. Whoever holds the floor
 * publishes their microphone directly, so the room hears the question live over RTC rather
 * than waiting for it to be relayed through the host.
 */
export function useAgoraRoom({ channel, role, displayName, onMessage }: UseAgoraRoomOptions) {
  const [connection, setConnection] = useState<RoomConnection>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [remoteAudioCount, setRemoteAudioCount] = useState(0);
  const [programPublished, setProgramPublished] = useState(false);
  const [microphonePublished, setMicrophonePublished] = useState(false);
  const [rtmConnected, setRtmConnected] = useState(false);
  const [rtmSyncRevision, setRtmSyncRevision] = useState(0);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const rtmRef = useRef<RTMClient | null>(null);
  const programTrackRef = useRef<ILocalAudioTrack | null>(null);
  const microphoneTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const microphoneFlightRef = useRef(createSingleFlight<MediaStreamTrack>());
  const channelRef = useRef<string | null>(null);
  const uidRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const rtmSubscribedRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const displayNameRef = useRef(displayName);

  useEffect(() => {
    onMessageRef.current = onMessage;
    displayNameRef.current = displayName;
  }, [onMessage, displayName]);

  const leaveRoom = useCallback(async () => {
    generationRef.current += 1;

    const client = clientRef.current;
    const rtm = rtmRef.current;
    const programTrack = programTrackRef.current;
    const microphoneTrack = microphoneTrackRef.current;
    const activeChannel = channelRef.current;

    clientRef.current = null;
    rtmRef.current = null;
    programTrackRef.current = null;
    microphoneTrackRef.current = null;
    channelRef.current = null;
    uidRef.current = null;
    microphoneFlightRef.current.reset();
    rtmSubscribedRef.current = false;

    setMembers([]);
    setRemoteAudioCount(0);
    setProgramPublished(false);
    setMicrophonePublished(false);
    setRtmConnected(false);
    setChatMessages([]);
    setUid(null);
    setConnection('idle');

    await closeRealtimeRoom({
      channel: activeChannel,
      client,
      rtm,
      programTrack,
      microphoneTrack,
    });
  }, []);

  useEffect(() => {
    if (!channel) {
      setConnection('idle');
      return;
    }
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    if (!appId) {
      setError('NEXT_PUBLIC_AGORA_APP_ID is not set, so the room cannot be created.');
      setConnection('failed');
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;
    setConnection('connecting');
    setError(null);

    const start = async () => {
      try {
        const credentials = await requestToken(channel);
        if (cancelled || generation !== generationRef.current) return;

        channelRef.current = credentials.channel;
        uidRef.current = credentials.uid;
        setUid(credentials.uid);

        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
        AgoraRTC.setLogLevel(3);
        if (cancelled || generation !== generationRef.current) return;

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        clientRef.current = client;

        client.on('user-published', async (user, mediaType) => {
          if (mediaType !== 'audio') return;
          try {
            await client.subscribe(user, mediaType);
            user.audioTrack?.play();
            setRemoteAudioCount((current) => current + 1);
          } catch (subscribeError) {
            console.error('[room] subscribe failed', subscribeError);
          }
        });
        client.on('user-unpublished', (_user, mediaType) => {
          if (mediaType === 'audio') setRemoteAudioCount((current) => Math.max(0, current - 1));
        });
        client.on('token-privilege-will-expire', async () => {
          try {
            const renewed = await requestToken(channel, uidRef.current ?? undefined);
            await client.renewToken(renewed.token);
          } catch (renewError) {
            console.error('[room] RTC token renewal failed', renewError);
          }
        });

        const { default: AgoraRTM } = await import('agora-rtm');
        const rtm: RTMClient = new AgoraRTM.RTM(appId, credentials.uid);
        rtmRef.current = rtm;

        rtm.addEventListener('linkState', (event) => {
          const connected = event.currentState === 'CONNECTED' && rtmSubscribedRef.current;
          setRtmConnected(connected);
          // A reconnect does not replay messages that were published while RTM was down.
          // Bump a revision so the host republishes its authoritative room snapshot.
          if (connected) setRtmSyncRevision((current) => current + 1);
        });

        rtm.addEventListener('message', (event) => {
          if (event.channelName !== credentials.channel) return;
          if (event.publisher === credentials.uid) return;
          const message = decodeRoomMessage(event.message);
          if (!message) return;
          if (message.t === 'hello') {
            setMembers((current) => current.map((member) => (
              member.uid === event.publisher ? { ...member, name: message.name } : member
            )));
          }
          if (message.t === 'chat.message' || message.t === 'episode.restart') {
            setChatMessages((current) => reduceRoomChatMessages(
              current,
              message,
              event.publisher,
            ));
          }
          onMessageRef.current(message, event.publisher);
        });

        rtm.addEventListener('presence', (event) => {
          if (event.channelName !== credentials.channel) return;
          if (event.eventType === 'SNAPSHOT') {
            const snapshot = event.snapshot ?? [];
            setMembers(snapshot
              .filter((state) => state.userId !== credentials.uid)
              .map((state) => ({ uid: state.userId, name: sanitizeDisplayName(undefined) })));
            return;
          }
          if (event.eventType === 'REMOTE_JOIN') {
            setMembers((current) => (
              current.some((member) => member.uid === event.publisher)
                ? current
                : [...current, { uid: event.publisher, name: sanitizeDisplayName(undefined) }]
            ));
            return;
          }
          if (event.eventType === 'REMOTE_LEAVE' || event.eventType === 'REMOTE_TIMEOUT') {
            setMembers((current) => current.filter((member) => member.uid !== event.publisher));
          }
        });

        rtm.addEventListener('tokenPrivilegeWillExpire', async () => {
          try {
            const renewed = await requestToken(channel, credentials.uid);
            await rtm.renewToken(renewed.token);
          } catch (renewError) {
            console.error('[room] RTM token renewal failed', renewError);
          }
        });

        await rtm.login({ token: credentials.token });
        await rtm.subscribe(credentials.channel, { withMessage: true, withPresence: true });
        if (cancelled || generation !== generationRef.current) return;

        rtmSubscribedRef.current = true;
        setRtmConnected(true);
        setRtmSyncRevision((current) => current + 1);
        // Announce a display name so every roster entry has one, and so a host that is
        // already mid-episode knows to replay its state to the new arrival.
        await rtm.publish(credentials.channel, encodeRoomMessage({
          t: 'hello',
          name: sanitizeDisplayName(displayNameRef.current),
        })).catch(() => undefined);

        // Join signaling before media. RTM carries the episode snapshot and room state, so a
        // slow WebRTC/ICE negotiation must not strand listeners on the waiting screen.
        await client.join(appId, credentials.channel, credentials.token, Number(credentials.uid));
        if (cancelled || generation !== generationRef.current) {
          await client.leave().catch(() => undefined);
          return;
        }
        setConnection('connected');
      } catch (joinError) {
        if (cancelled || generation !== generationRef.current) return;
        console.error('[room] join failed', joinError);
        setError(joinError instanceof Error ? joinError.message : 'Could not join the room.');
        setConnection('failed');
      }
    };

    void start();

    return () => {
      cancelled = true;
      void leaveRoom();
    };
  }, [channel, role, leaveRoom]);

  const send = useCallback(async (message: RoomMessage) => {
    const rtm = rtmRef.current;
    const activeChannel = channelRef.current;
    if (!rtm || !activeChannel) return;
    try {
      await rtm.publish(activeChannel, encodeRoomMessage(message));
    } catch (publishError) {
      console.error('[room] publish failed', publishError);
    }
  }, []);

  const sendChat = useCallback(async (value: string) => {
    const rtm = rtmRef.current;
    const activeChannel = channelRef.current;
    const activeUid = uidRef.current;
    const text = sanitizeChatText(value);
    if (!rtm || !activeChannel || !activeUid || !text) return false;

    const message: ChatMessage = {
      t: 'chat.message',
      id: `${activeUid}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      name: sanitizeDisplayName(displayNameRef.current),
      text,
      sentAt: Date.now(),
    };

    try {
      await rtm.publish(activeChannel, encodeRoomMessage(message), { customType: 'chat.message' });
      // RTM does not echo channel publishes back to the sender.
      setChatMessages((current) => reduceRoomChatMessages(current, message, activeUid));
      return true;
    } catch (publishError) {
      console.error('[room] chat publish failed', publishError);
      return false;
    }
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([]);
  }, []);

  /** Publishes the mixed program. Only the host calls this. */
  const publishProgram = useCallback(async (mediaStreamTrack: MediaStreamTrack) => {
    const client = clientRef.current;
    if (!client || programTrackRef.current) return;
    const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
    const track = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack });
    programTrackRef.current = track;
    await client.publish(track);
    setProgramPublished(true);
  }, []);

  const unpublishProgram = useCallback(async () => {
    const client = clientRef.current;
    const track = programTrackRef.current;
    programTrackRef.current = null;
    setProgramPublished(false);
    if (!client || !track) return;
    await client.unpublish(track).catch(() => undefined);
    track.close();
  }, []);

  /**
   * Publishes the floor holder's microphone. Echo cancellation matters here: the asker is
   * also subscribed to the program track coming back out of their own speakers.
   */
  const publishMicrophone = useCallback(async (onTrackReady?: (track: MediaStreamTrack) => void) => {
    const client = clientRef.current;
    if (!client) throw new Error('The room is not connected.');
    if (microphoneTrackRef.current) {
      const mediaTrack = microphoneTrackRef.current.getMediaStreamTrack();
      onTrackReady?.(mediaTrack);
      return mediaTrack;
    }
    // Concurrent callers share one attempt; otherwise each starts its own getUserMedia and
    // publishes a separate track.
    return microphoneFlightRef.current.run(async () => {
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      let acquiredTrack: IMicrophoneAudioTrack | null = null;
      try {
        const mediaTrack = await acquireAndPublishMicrophone<
          MediaStreamTrack,
          IMicrophoneAudioTrack
        >({
          createTrack: () => AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true }),
          publishTrack: async (track) => {
            await client.publish(track);
          },
          isRoomActive: () => clientRef.current === client,
          onTrackReady: (track, sdkTrack) => {
            acquiredTrack = sdkTrack;
            microphoneTrackRef.current = sdkTrack;
            onTrackReady?.(track);
          },
        });
        setMicrophonePublished(true);
        return mediaTrack;
      } catch (publishError) {
        if (microphoneTrackRef.current === acquiredTrack) microphoneTrackRef.current = null;
        setMicrophonePublished(false);
        throw publishError;
      }
    });
  }, []);

  const unpublishMicrophone = useCallback(async () => {
    const client = clientRef.current;
    const track = microphoneTrackRef.current;
    if (!track && !microphoneFlightRef.current.inFlight) return;
    microphoneTrackRef.current = null;
    microphoneFlightRef.current.reset();
    setMicrophonePublished(false);
    if (!track) return;
    if (client) await client.unpublish(track).catch(() => undefined);
    track.close();
  }, []);

  return {
    connection,
    error,
    uid,
    members,
    remoteAudioCount,
    programPublished,
    microphonePublished,
    rtmConnected,
    rtmSyncRevision,
    chatMessages,
    send,
    sendChat,
    clearChat,
    publishProgram,
    unpublishProgram,
    publishMicrophone,
    unpublishMicrophone,
    leaveRoom,
  };
}

export type AgoraRoom = ReturnType<typeof useAgoraRoom>;
