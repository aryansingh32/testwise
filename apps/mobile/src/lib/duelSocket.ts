import { io, type Socket } from 'socket.io-client';
import { API_URL, freshAccessToken } from './api';

let socket: Socket | null = null;

/** Shared Socket.IO connection to the duel server; authenticates with a fresh token on every (re)connect. */
export function duelSocket(): Socket {
  if (socket) return socket;
  socket = io(`${API_URL}/duels`, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 800,
    auth: (cb) => {
      void freshAccessToken().then((token) => cb({ token }));
    },
  });
  return socket;
}

export function closeDuelSocket() {
  socket?.disconnect();
  socket = null;
}

/** Emit with an acknowledgement as a promise. */
export function emitAck<T = { ok: boolean; error?: string }>(event: string, data?: unknown): Promise<T> {
  const s = duelSocket();
  return new Promise((resolve) => s.timeout(8000).emit(event, data ?? {}, (err: unknown, res: T) => resolve(err ? ({ ok: false, error: 'timeout' } as T) : res)));
}
