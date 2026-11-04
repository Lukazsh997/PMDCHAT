import {
  type ClientToServerEvents,
  REALTIME_PATH,
  type ServerToClientEvents,
} from '@plataforma/contracts';
import { io, type Socket } from 'socket.io-client';
import { createStore } from './store';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Estado da conexão em tempo real, exibido na interface quando cai. */
export const connectionStore = createStore<'connecting' | 'online' | 'offline'>('connecting');

let socket: AppSocket | null = null;

/** Uma conexão por aba, aberta depois do login. Reconecta sozinha. */
export function getSocket(): AppSocket {
  if (socket) return socket;
  socket = io({
    path: REALTIME_PATH,
    withCredentials: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15_000,
  });
  socket.on('connect', () => connectionStore.set('online'));
  socket.on('disconnect', () => connectionStore.set('offline'));
  socket.on('connect_error', () => connectionStore.set('offline'));
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
  connectionStore.set('connecting');
}
