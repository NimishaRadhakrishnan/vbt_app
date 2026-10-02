/**
 * Offline Sync Queue Manager - real on-device persistence.
 *
 * Previously an in-memory array only (see file history / README) -
 * genuinely just simulated SQLite, so any unsynced visit/attendance/leave
 * action was silently lost the moment the app restarted while offline.
 * Now backed by AsyncStorage (already a dependency and already the
 * pattern this codebase uses for session persistence - see
 * api.ts's SESSION_STORAGE_KEY), keyed as one JSON-serialized array under
 * a single key. AsyncStorage rather than expo-sqlite: queue items are
 * small JSON payloads (a form submission's fields plus already-uploaded
 * photo URLs, never raw photo binary), so a real embedded SQL database
 * would be more machinery than this data shape needs.
 *
 * Public API is unchanged (queueItem/getQueuedItems/dequeueItem/
 * syncQueueWithBackend) - every existing call site already used
 * await/.then() against this class, so no caller needed to change.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

const QUEUE_STORAGE_KEY = 'offline_sync_queue_v1';

export interface SyncPayload {
  id: string;
  type: 'check_in' | 'check_out' | 'gps_ping' | 'farmer_register' | 'stock_audit' | 'dealer_order' | 'crop_issue' | 'plan_submit' | 'task_action' | 'visit_tracker_submit' | 'consent' | 'admin_action';
  payload: string; // JSON String
  created_at: string;
  endpoint: string; // e.g. '/location/ping' - needed to actually replay the request
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data: any; // parsed payload, kept alongside the JSON string for convenience
}

class OfflineSyncDatabase {
  // In-memory cache so repeated reads within one session don't all hit
  // AsyncStorage, but every mutation (queue/dequeue) writes through to
  // disk immediately - the cache is a convenience, disk is the source
  // of truth, and it's re-loaded fresh on first access after a restart.
  private cache: SyncPayload[] | null = null;

  private async load(): Promise<SyncPayload[]> {
    if (this.cache !== null) return this.cache;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      this.cache = raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('[Offline Queue] Failed to load persisted queue, starting empty:', err);
      this.cache = [];
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.cache ?? []));
    } catch (err) {
      // If this fails, the item is still in the in-memory cache for the
      // rest of this session (so an immediate sync attempt still works),
      // it just won't survive a restart - log rather than throw, since
      // the calling screen has already told the user "saved on device"
      // and shouldn't be shown a failure for something that mostly worked.
      console.error('[Offline Queue] Failed to persist queue to disk:', err);
    }
  }

  // Queue item locally when offline
  public async queueItem(
    type: SyncPayload['type'],
    data: any,
    endpoint: string,
    method: SyncPayload['method'] = 'POST'
  ): Promise<void> {
    const item: SyncPayload = {
      id: Math.random().toString(36).substring(7),
      type,
      payload: JSON.stringify(data),
      data,
      endpoint,
      method,
      created_at: new Date().toISOString(),
    };
    const queue = await this.load();
    queue.push(item);
    await this.persist();
    // Previously fired its own generic "Offline Mode" alert here, on top
    // of whichever alert the calling screen showed next - stacking two
    // popups per offline submit, and this one didn't even distinguish
    // "genuinely offline" from "reachable network, request still failed"
    // (see api.ts's catch-and-requeue path). Screens now show one
    // accurate message via showSubmitResult()/offlineAlert.ts instead;
    // this queue layer just queues.
  }

  // Retrieve all queued items
  public async getQueuedItems(): Promise<SyncPayload[]> {
    return [...(await this.load())];
  }

  // Delete item from queue after successful sync
  public async dequeueItem(id: string): Promise<void> {
    const queue = await this.load();
    this.cache = queue.filter(item => item.id !== id);
    await this.persist();
  }

  // Re-sync all queued events to the backend REST API
  public async syncQueueWithBackend(apiClient: (item: SyncPayload) => Promise<boolean>): Promise<void> {
    const queue = await this.load();
    if (queue.length === 0) return;

    let successfulSyncs = 0;

    for (const item of [...queue]) {
      try {
        const success = await apiClient(item);
        if (success) {
          await this.dequeueItem(item.id);
          successfulSyncs++;
        }
      } catch (err) {
        console.error(`[Sync Engine] Failed to sync item [${item.id}] of type [${item.type}]:`, err);
        break; // Stop sync train if connection fails midway
      }
    }

    if (successfulSyncs > 0) {
      Alert.alert(
        'Synchronization Successful',
        `Successfully synced ${successfulSyncs} offline action(s) to Vishakan Biotech servers.`
      );
    }
  }
}

export const dbService = new OfflineSyncDatabase();
