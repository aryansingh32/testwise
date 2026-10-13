import { api } from '../api';

type Room = import('livekit-client').Room;
export type LiveSource = 'camera' | 'microphone' | 'screen';
export type LiveEvent = { type: 'stopped'; source: LiveSource } | { type: 'disconnected' } | { type: 'reconnected' };

let room: Room | null = null;
let wanted: Record<LiveSource, boolean> = { camera: false, microphone: false, screen: false };
const listeners = new Set<(e: LiveEvent) => void>();
const emit = (e: LiveEvent) => listeners.forEach((l) => l(e));

export const onLiveEvent = (cb: (e: LiveEvent) => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
export const isLive = () => !!room && room.state === 'connected';

function sdk() {
  const { registerGlobals } = require('@livekit/react-native') as { registerGlobals(): void };
  const lk = require('livekit-client') as typeof import('livekit-client');
  registerGlobals();
  return lk;
}

async function enable(r: Room, source: LiveSource): Promise<boolean> {
  try {
    if (source === 'camera') await r.localParticipant.setCameraEnabled(true);
    else if (source === 'microphone') await r.localParticipant.setMicrophoneEnabled(true);
    else await r.localParticipant.setScreenShareEnabled(true); // Android shows the system "start recording" prompt
    return true;
  } catch {
    return false;
  }
}

/**
 * Joins the proctor's room and publishes what this exam monitors. Called from the single consent screen BEFORE the
 * attempt starts, so the OS prompts happen once and a denied permission blocks the start instead of ending a running
 * test. Returns the first source that could not be started.
 */
export async function connectLive(url: string, token: string, sources: Record<LiveSource, boolean>): Promise<{ ok: true } | { ok: false; failed: LiveSource | 'connect' }> {
  try {
    await disconnectLive();
    const lk = sdk();
    const r = new lk.Room({ adaptiveStream: true, dynacast: true });
    r.on(lk.RoomEvent.LocalTrackUnpublished, (pub) => {
      const source = pub.source === lk.Track.Source.ScreenShare ? 'screen' : pub.source === lk.Track.Source.Microphone ? 'microphone' : 'camera';
      if (wanted[source]) emit({ type: 'stopped', source });
    });
    r.on(lk.RoomEvent.Disconnected, () => emit({ type: 'disconnected' }));
    r.on(lk.RoomEvent.Reconnected, () => emit({ type: 'reconnected' }));
    await r.connect(url, token);
    room = r;
    wanted = { camera: false, microphone: false, screen: false };
    for (const source of ['camera', 'microphone', 'screen'] as const) {
      if (!sources[source]) continue;
      wanted[source] = true;
      if (!(await enable(r, source))) {
        await disconnectLive();
        return { ok: false, failed: source };
      }
    }
    return { ok: true };
  } catch {
    await disconnectLive();
    return { ok: false, failed: 'connect' };
  }
}

/** Re-joins after the app was restarted mid-exam (the OS prompts appear again). */
export async function rejoinLive(attemptId: string, sources: Record<LiveSource, boolean>) {
  const t = await api<{ url: string; token: string }>(`/v1/proctor/attempts/${attemptId}/live-token`);
  return connectLive(t.url, t.token, sources);
}

export const resumeSource = async (source: LiveSource) => (room ? enable(room, source) : false);

export const isScreenSharing = () => !!room && wanted.screen && room.localParticipant.isScreenShareEnabled;

export async function disconnectLive() {
  const r = room;
  room = null;
  wanted = { camera: false, microphone: false, screen: false };
  try {
    await r?.disconnect();
  } catch {
    /* already closed */
  }
}
