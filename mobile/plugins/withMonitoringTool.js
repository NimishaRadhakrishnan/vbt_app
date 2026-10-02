/**
 * PHASE 3A ITEM 3 — isMonitoringTool=enterprise_management
 *
 * Google Play's Stalkerware and Monitoring Applications policy is the
 * policy that actually governs this app. Under it, an app that collects
 * and transmits one person's location for another person to view is
 * disallowed UNLESS it is exclusively designed and marketed either for
 * parents monitoring children or for enterprise management monitoring
 * employees - and a key requirement of that exemption is the
 * `isMonitoringTool` metadata flag, present in the manifest of EVERY
 * version code across ALL tracks.
 *
 * This flag was entirely absent from the project. Without it, VBT One is
 * reviewed as a general-purpose app requesting background location, and
 * an app that reports an employee's position to their manager, reviewed
 * under general-purpose rules, reads as possible stalkerware. This is a
 * far more likely rejection cause than anything in the application code.
 *
 * Value is `enterprise_management`: the app caters to an enterprise that
 * manages and monitors its own employees. The other permitted values are
 * `child_monitoring` and `other`; `other` would send the app to a manual
 * exemption assessment we do not need, since our case is squarely the
 * enterprise one.
 *
 * WHY A CONFIG PLUGIN AND NOT A MANIFEST EDIT
 * -------------------------------------------
 * This is a managed Expo workflow: android/AndroidManifest.xml is
 * generated at prebuild and is not committed, so any hand edit to it is
 * erased by the next build. A config plugin is the only way to make this
 * flag survive, and surviving every build is precisely the policy
 * requirement ("all version codes across all tracks").
 *
 * The three companion requirements of the same policy are handled
 * elsewhere, noted here so the full obligation is traceable from one
 * place:
 *   - Persistent notification while tracking runs
 *       -> LocationService.startTracking()'s `foregroundService` option.
 *   - Not covert / no misleading users about tracking
 *       -> src/screens/LocationDisclosureScreen.tsx (shown before any
 *          permission prompt) and src/screens/MyTrackingScreen.tsx
 *          (the officer can see their own tracking state and route).
 *   - Tracking disclosed in the store listing
 *       -> docs/PHASE_3A_SUBMISSION_PACKAGE.md, store description.
 */

const { withAndroidManifest } = require("expo/config-plugins");

const FLAG_NAME = "isMonitoringTool";
const FLAG_VALUE = "enterprise_management";

/**
 * @param {import('@expo/config-types').ExpoConfig} config
 */
const withMonitoringTool = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults?.manifest?.application?.[0];

    if (!application) {
      // Fail loudly. A silent skip here would produce a build that looks
      // fine locally and gets rejected weeks later in review, with no
      // signal anywhere pointing back at this plugin.
      throw new Error(
        "[withMonitoringTool] No <application> node found in AndroidManifest. " +
          "The isMonitoringTool flag is mandatory for Play's monitoring-app " +
          "exemption and must not be silently skipped."
      );
    }

    application["meta-data"] = application["meta-data"] ?? [];

    // Idempotent: prebuild can run repeatedly, and a duplicated meta-data
    // key is a manifest-merge error rather than a harmless no-op.
    const existing = application["meta-data"].find(
      (item) => item?.$?.["android:name"] === FLAG_NAME
    );

    if (existing) {
      existing.$["android:value"] = FLAG_VALUE;
    } else {
      application["meta-data"].push({
        $: {
          "android:name": FLAG_NAME,
          "android:value": FLAG_VALUE,
        },
      });
    }

    return cfg;
  });

module.exports = withMonitoringTool;
