/**
 * Positions the phone could not send (no signal, weak signal, server down).
 *
 * The background task keeps recording while offline. Each position that fails
 * to send is kept here and uploaded in batches as soon as a live position goes
 * through again, so the officer's history has no hole in it and nobody has to
 * open the app or press anything. It never shows a popup.
 *
 * Kept deliberately small and separate from the general offline queue
 * (db.ts): that queue replays one request per item and only when the Profile
 * switch is toggled, which is wrong for a position every 5 seconds.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './api';

const STORAGE_KEY = 'offline_pings_v1';
// About 5.5 hours at one position every 5 seconds. Past this, the oldest go.
const MAX_SAVED = 4000;
// Same as the server's GPS retention; older points would be refused anyway.
const MAX_AGE_MS = 90 * 24 * 3600 * 1000;
const BATCH_SIZE = 200;
// At most this many batches per flush, so one flush never runs for minutes.
const MAX_BATCHES_PER_FLUSH = 5;
const MIN_FLUSH_GAP_MS = 15_000;

export type SavedPing = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed_kmh: number | null;
  battery_pct: number | null;
  timestamp: string;
};

// Reads and writes happen one after another, never overlapping.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

async function read(): Promise<SavedPing[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function write(list: SavedPing[]): Promise<void> {
  try {
    if (list.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[PingBuffer] could not save', err);
  }
}

/** Sets aside a position that could not be sent. */
export function savePing(ping: SavedPing): Promise<void> {
  return serial(async () => {
    const cutoff = Date.now() - MAX_AGE_MS;
    const list = (await read()).filter((p) => Date.parse(p.timestamp) >= cutoff);
    if (list.some((p) => p.timestamp === ping.timestamp)) return;
    list.push(ping);
    await write(list.length > MAX_SAVED ? list.slice(list.length - MAX_SAVED) : list);
  });
}

export async function savedPingCount(): Promise<number> {
  return serial(async () => (await read()).length);
}

let flushing = false;
let lastFlushAt = 0;

/**
 * Uploads saved positions, oldest first. Stops quietly at the first failure
 * and tries again next time. Returns how many were sent.
 */
export async function flushSavedPings(): Promise<number> {
  if (flushing || Date.now() - lastFlushAt < MIN_FLUSH_GAP_MS) return 0;
  flushing = true;
  lastFlushAt = Date.now();
  let sent = 0;
  try {
    for (let i = 0; i < MAX_BATCHES_PER_FLUSH; i++) {
      const batch = await serial(async () => {
        const cutoff = Date.now() - MAX_AGE_MS;
        const list = (await read()).filter((p) => Date.parse(p.timestamp) >= cutoff);
        list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        return list.slice(0, BATCH_SIZE);
      });
      if (batch.length === 0) break;
      try {
        await apiClient.request('/location/ping/batch', 'POST', 'gps_ping', { points: batch }, { queue: false });
      } catch (err: any) {
        const status = err?.status;
        // The server refused the data itself (not a signal problem): sending it
        // again can never work, so drop it instead of blocking everything behind it.
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 429) {
          await removeSent(batch);
          continue;
        }
        break; // no signal, busy server or expired login: try again later
      }
      await removeSent(batch);
      sent += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }
  } finally {
    flushing = false;
  }
  return sent;
}

function removeSent(batch: SavedPing[]): Promise<void> {
  const done = new Set(batch.map((p) => p.timestamp));
  return serial(async () => {
    const list = await read();
    await write(list.filter((p) => !done.has(p.timestamp)));
  });
}
