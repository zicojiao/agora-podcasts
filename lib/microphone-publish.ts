export type AcquiredMicrophoneTrack<TMediaTrack> = {
  getMediaStreamTrack: () => TMediaTrack;
  close: () => void;
};

/**
 * Makes the native microphone stream available to local transcription immediately after
 * permission succeeds. RTC publication continues in the same operation, but is no longer
 * allowed to hide an already-acquired microphone from the UI and ASR pipeline.
 */
export async function acquireAndPublishMicrophone<TMediaTrack, TSdkTrack extends AcquiredMicrophoneTrack<TMediaTrack>>({
  createTrack,
  publishTrack,
  isRoomActive,
  onTrackReady,
}: {
  createTrack: () => Promise<TSdkTrack>;
  publishTrack: (track: TSdkTrack) => Promise<void>;
  isRoomActive: () => boolean;
  onTrackReady: (mediaTrack: TMediaTrack, sdkTrack: TSdkTrack) => void;
}) {
  const track = await createTrack();
  if (!isRoomActive()) {
    track.close();
    throw new Error('The room closed while the microphone was opening.');
  }

  const mediaTrack = track.getMediaStreamTrack();
  onTrackReady(mediaTrack, track);

  try {
    await publishTrack(track);
    if (!isRoomActive()) throw new Error('The room closed while the microphone was publishing.');
    return mediaTrack;
  } catch (error) {
    track.close();
    throw error;
  }
}
