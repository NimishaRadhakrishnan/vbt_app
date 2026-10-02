import { Alert } from 'react-native';

/**
 * Fix for the audit's #1 finding: apiClient.request() already returns
 * { offline: true } when a write falls back to the local sync queue, but
 * no screen ever checked it - every submit action showed the exact same
 * "Saved"/"Submitted" alert whether the request actually reached the
 * server or just got queued on-device. That's a trust bug: an officer
 * had no way to know a visit, closure, or leave request hadn't gone
 * through yet.
 *
 * Every submit handler in the app should call this instead of directly
 * Alert.alert-ing its own success message, so the offline case always
 * gets a noticeably different message - never the same "it's done"
 * wording as a confirmed server save.
 */
export function showSubmitResult(
  result: any,
  successTitle: string,
  successMessage: string
): void {
  if (result?.offline) {
    Alert.alert(
      'Saved on Your Phone',
      "Will send when you're back online."
    );
  } else {
    Alert.alert(successTitle, successMessage);
  }
}

/** True if a submit response came from the offline queue rather than a
 * confirmed server response - for screens that want to show a "Pending
 * sync" badge on their own list items instead of (or in addition to) the
 * one-time alert. */
export function wasQueuedOffline(result: any): boolean {
  return !!result?.offline;
}
