package expo.modules.wakelock

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * One partial wake lock for the whole app process, held while tracking runs.
 *
 * A foreground service keeps the app alive but does not keep the processor
 * awake, so with the screen off and the phone still, the processor can sleep
 * in the middle of a location update or a network call. A partial wake lock
 * stops that. It is held in a companion object (not on the module instance)
 * because the screens and the background task can each load their own copy of
 * this module inside the same process.
 *
 * It always has a timeout, so a lock that is never released cannot drain the
 * battery for days: tracking renews it on every GPS update.
 */
class WakeLockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WakeLock")

    Function("acquire") {
      acquire(appContext.reactContext?.applicationContext)
    }

    Function("release") {
      release()
    }

    Function("isHeld") {
      synchronized(LOCK) { wakeLock?.isHeld == true }
    }
  }

  companion object {
    private val LOCK = Any()
    private const val TAG = "VBTOne:tracking"
    // Long enough for a working day; renewed by every GPS update.
    private const val TIMEOUT_MS = 12L * 60L * 60L * 1000L

    @Volatile
    private var wakeLock: PowerManager.WakeLock? = null

    private fun acquire(context: Context?): Boolean {
      if (context == null) return false
      synchronized(LOCK) {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        val lock = wakeLock ?: power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG).also {
          it.setReferenceCounted(false)
          wakeLock = it
        }
        // Renewing: acquiring a non-counted lock again just resets its timeout.
        lock.acquire(TIMEOUT_MS)
        return lock.isHeld
      }
    }

    private fun release() {
      synchronized(LOCK) {
        val lock = wakeLock ?: return
        if (lock.isHeld) lock.release()
      }
    }
  }
}
