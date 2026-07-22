const SESSION_ENDPOINT = 'https://us-central1-candyvoice.cloudfunctions.net/recordSessionTime';
const MAX_SESSION_SECONDS = 2 * 60 * 60; // cap so a sleeping laptop doesn't skew the average

export function startSessionTracking(user) {
  const startedAt = Date.now();
  let sent = false;

  async function sendDuration() {
    if (sent) return;
    sent = true;

    const durationSeconds = Math.min(
      Math.round((Date.now() - startedAt) / 1000),
      MAX_SESSION_SECONDS,
    );
    if (durationSeconds < 1) return;

    try {
      const idToken = await user.getIdToken();
      const payload = JSON.stringify({ idToken, durationSeconds });
      // text/plain avoids a CORS preflight, which sendBeacon can't wait for anyway
      navigator.sendBeacon(SESSION_ENDPOINT, new Blob([payload], { type: 'text/plain' }));
    } catch (err) {
      console.warn('Could not record session time:', err);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
  });
  window.addEventListener('pagehide', sendDuration);
}