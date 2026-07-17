import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions } from './firebase-init.js';

const confirmEmailVerifiedCallable = httpsCallable(functions, 'confirmEmailVerified');

// Avoid firing this more than once per uid per page session (e.g. auth-guard
// runs on every protected page load). The Cloud Function itself is safe to
// call repeatedly — this is just to skip the redundant network round-trip.
const syncedUids = new Set();

/**
 * Tells the server to re-check (via the Admin SDK, never trusting the
 * client) whether `user`'s email is verified, and if so, sync that to
 * HubSpot. Safe to call speculatively — it's a no-op server-side if the
 * email isn't actually verified yet.
 */
export async function syncEmailVerifiedStatus(user, { force = false } = {}) {
  if (!user) return null;
  if (!force && syncedUids.has(user.uid)) return null;

  try {
    const result = await confirmEmailVerifiedCallable();
    syncedUids.add(user.uid);
    return result.data;
  } catch (error) {
    console.error('Could not sync email verification status:', error);
    return null;
  }
}
