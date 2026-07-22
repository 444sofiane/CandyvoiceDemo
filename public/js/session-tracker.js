const SESSION_ENDPOINT = 'https://us-central1-candyvoice.cloudfunctions.net/recordSessionTime';
const MAX_CHECKPOINT_SECONDS = 2 * 60 * 60; // cap a single checkpoint so a sleeping laptop doesn't skew things

const START_KEY = 'cv-session-start';
const CHECKPOINT_KEY = 'cv-session-last-checkpoint';
const COUNTED_KEY = 'cv-session-counted';

/**
 * Tracks total time spent in this browser TAB as a single "visit", across
 * however many internal pages (NoizeOff / Imitation / Deepfake) the user
 * navigates to. Relies on sessionStorage, which is scoped per-tab and is
 * cleared automatically when the tab closes — so a new tab always starts a
 * fresh visit, and reloading/navigating within the same tab does not.
 */
export function startSessionTracking(user) {
  const now = Date.now();

  if (!sessionStorage.getItem(START_KEY)) {
    sessionStorage.setItem(START_KEY, String(now));
  }
  if (!sessionStorage.getItem(CHECKPOINT_KEY)) {
    sessionStorage.setItem(CHECKPOINT_KEY, String(now));
  }

  async function sendCheckpoint() {
    const lastCheckpoint = Number(sessionStorage.getItem(CHECKPOINT_KEY)) || now;
    const elapsedMs = Date.now() - lastCheckpoint;
    const durationSeconds = Math.min(Math.round(elapsedMs / 1000), MAX_CHECKPOINT_SECONDS);

    if (durationSeconds < 1) return;

    const isFirstReportForThisVisit = !sessionStorage.getItem(COUNTED_KEY);

    // Update sessionStorage optimistically before sending — sendBeacon is
    // fire-and-forget and this may be the last chance to run any code
    // before the page is torn down.
    sessionStorage.setItem(CHECKPOINT_KEY, String(Date.now()));
    if (isFirstReportForThisVisit) sessionStorage.setItem(COUNTED_KEY, 'true');

    try {
      const idToken = await user.getIdToken();
      const payload = JSON.stringify({
        idToken,
        durationSeconds,
        isNewSession: isFirstReportForThisVisit,
      });
      // text/plain avoids a CORS preflight, which sendBeacon can't wait for anyway
      navigator.sendBeacon(SESSION_ENDPOINT, new Blob([payload], { type: 'text/plain' }));
    } catch (err) {
      console.warn('Could not record session time:', err);
    }
  }

  // Fires on tab switch, minimize, and close.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendCheckpoint();
  });

  // Fires on internal navigation (e.g. clicking between NoizeOff/Imitation/
  // Deepfake) as well as closing the tab — this is what turns multi-page
  // browsing into one continuously-measured visit instead of resetting.
  window.addEventListener('pagehide', sendCheckpoint);
}