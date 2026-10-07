import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  acquire(): boolean;
  release(): void;
  isHeld(): boolean;
};

// Null when the native part is not in the app (Expo Go, or an older APK). Every
// call below then does nothing, so tracking works exactly as before.
let native: Native | null = null;
try {
  native = requireOptionalNativeModule<Native>('WakeLock');
} catch {
  native = null;
}

export const WakeLock = {
  /** Keep the processor awake (renews the lock if already held). Safe to call often. */
  acquire(): boolean {
    try {
      return native?.acquire() ?? false;
    } catch {
      return false;
    }
  },
  release(): void {
    try {
      native?.release();
    } catch {
      // nothing to do
    }
  },
  isHeld(): boolean {
    try {
      return native?.isHeld() ?? false;
    } catch {
      return false;
    }
  },
  isAvailable: native != null,
};
