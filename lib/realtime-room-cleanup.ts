type LocalAudioTrack = {
  stop: () => void;
  close: () => void;
};

type RealtimeClient<TTrack extends LocalAudioTrack> = {
  unpublish: (tracks: TTrack[]) => Promise<unknown>;
  leave: () => Promise<unknown>;
};

type RealtimeMessagingClient = {
  unsubscribe: (channel: string) => Promise<unknown>;
  logout: () => Promise<unknown>;
};

type CloseRealtimeRoomOptions<TTrack extends LocalAudioTrack> = {
  channel: string | null;
  client: RealtimeClient<TTrack> | null;
  rtm: RealtimeMessagingClient | null;
  programTrack: TTrack | null;
  microphoneTrack: TTrack | null;
};

async function safely(action?: () => void | Promise<unknown>) {
  if (!action) return;
  try {
    await action();
  } catch {
    // Teardown is best effort. One failed SDK call must not keep the other connection alive.
  }
}

/** Releases every local media resource before detaching from RTM and RTC. */
export async function closeRealtimeRoom<TTrack extends LocalAudioTrack>({
  channel,
  client,
  rtm,
  programTrack,
  microphoneTrack,
}: CloseRealtimeRoomOptions<TTrack>) {
  const tracks = [programTrack, microphoneTrack].filter((track): track is TTrack => track !== null);
  if (client && tracks.length > 0) await safely(() => client.unpublish(tracks));

  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Continue to close the track even if playback was already stopped.
    }
    try {
      track.close();
    } catch {
      // A duplicate browser teardown can reach an already closed track.
    }
  }

  if (rtm && channel) await safely(() => rtm.unsubscribe(channel));
  if (rtm) await safely(() => rtm.logout());
  if (client) await safely(() => client.leave());
}
