const settings = require("../settings");
const Sentry = require("@sentry/electron/main");

// Placeholder DSN — replace with a real Sentry project DSN before shipping.
// DSNs are public (they only identify the project); rate limiting is configured
// server-side in the Sentry dashboard.
const SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

const enabled = !!settings.get("errorReporting");

if (enabled) {
  const { app } = require("electron");
  const version = app.isPackaged
    ? app.getVersion()
    : require("../package.json").version;

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `comfyui-launcher@${version}`,

    // Error tracking only — no performance/tracing, no replays
    tracesSampleRate: 0,
    sendDefaultPii: false,

    beforeSend(event) {
      // Strip absolute filesystem paths to protect user privacy.
      // Keeps only the basename so stack traces remain useful.
      if (event.exception && event.exception.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            // Windows paths: C:\Users\name\... → .../filename
            ex.value = ex.value.replace(
              /[A-Z]:\\[^\s"']+/gi,
              (m) => "..." + m.split("\\").pop()
            );
            // Unix paths: /home/user/... or /Users/name/... → .../filename
            ex.value = ex.value.replace(
              /\/(?:home|Users|tmp|var|opt)[^\s"']+/gi,
              (m) => "..." + m.split("/").pop()
            );
          }
        }
      }
      return event;
    },
  });
}

module.exports = { enabled };
