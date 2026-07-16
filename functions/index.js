const functionsV1 = require('firebase-functions/v1');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const axios = require('axios');

admin.initializeApp();

const db = getFirestore();
const auth = getAuth();

// The project's App Engine default service account (candyvoice@appspot.gserviceaccount.com)
// does not exist, so every function that needs the HUBSPOT_TOKEN secret is pinned
// explicitly to the Compute Engine default service account instead.
const SERVICE_ACCOUNT = '226330169560-compute@developer.gserviceaccount.com';

// Applies to all v2 functions below unless overridden per-function.
setGlobalOptions({ serviceAccount: SERVICE_ACCOUNT });

// Keep this in sync with USAGE_QUOTA_MINUTES in usage-client.js
const USAGE_QUOTA_MINUTES = 60;
const QUOTA_EPSILON = 0.01;

const HUBSPOT_HEADERS = () => ({
  Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json',
});

/**
 * Fires automatically right after a new Firebase Auth user is created.
 * Creates a matching contact in HubSpot. Runs server-side only, so a client
 * can never skip or spoof it.
 *
 * This is a v1 function (Auth triggers aren't available in v2 yet), so it
 * needs its own explicit serviceAccount override — setGlobalOptions above
 * only applies to v2 functions.
 */
exports.onUserCreated = functionsV1
  .runWith({
    secrets: ['HUBSPOT_TOKEN'],
    serviceAccount: SERVICE_ACCOUNT,
  })
  .auth.user()
  .onCreate(async (user) => {
    if (!user.email) return;

    try {
      await axios.post(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        {
          properties: {
            email: user.email,
            firebase_uid: user.uid,
            signup_date: new Date(user.metadata.creationTime).toISOString(),
            minutes_used: 0,
            email_verified: false,
          },
        },
        { headers: HUBSPOT_HEADERS() },
      );
      console.log(`HubSpot contact created for ${user.email}`);
    } catch (error) {
      if (error.response?.status === 409) {
        console.warn(`HubSpot contact already exists for ${user.email}`);
      } else {
        console.error('HubSpot contact create failed:', error.response?.data || error.message);
      }
    }
  });

/**
 * Callable function invoked from the client once it believes the user has
 * verified their email (verify-email.js after a successful `reload(user)`,
 * and auth-guard.js as a defensive re-sync on every authenticated page load).
 *
 * Never trusts the client's claim of "I'm verified" — it re-reads the user
 * record via the Admin SDK, which is the only authoritative source, before
 * touching HubSpot. This is what actually closes the gap where a HubSpot
 * contact was created (by onUserCreated, above) before the email was ever
 * confirmed: that contact stays `email_verified: false` until this function
 * independently verifies it and flips the flag.
 */
exports.confirmEmailVerified = onCall(
  { secrets: ['HUBSPOT_TOKEN'], serviceAccount: SERVICE_ACCOUNT },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const user = await auth.getUser(request.auth.uid);

    if (!user.emailVerified) {
      return { emailVerified: false, synced: false };
    }
    if (!user.email) {
      return { emailVerified: true, synced: false };
    }

    try {
      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(user.email)}?idProperty=email`,
        {
          properties: {
            email_verified: true,
            email_verified_date: new Date().toISOString(),
          },
        },
        { headers: HUBSPOT_HEADERS() },
      );
      return { emailVerified: true, synced: true };
    } catch (error) {
      console.error('HubSpot email_verified sync failed:', error.response?.data || error.message);
      // The user genuinely is verified even if the HubSpot write failed —
      // don't turn a HubSpot hiccup into a client-side error.
      return { emailVerified: true, synced: false };
    }
  },
);

/**
 * Callable function invoked from noisefilter.js after a file is filtered.
 * 1. Verifies the user still has quota remaining.
 * 2. Increments minutesUsed in Firestore (usage/{uid}).
 *
 * The HubSpot contact's minutes_used property is kept in sync separately by
 * syncUsageTotalToHubspot below (Firestore trigger), so this function itself
 * doesn't need the HUBSPOT_TOKEN secret or any HubSpot call.
 */
exports.recordUsage = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = request.auth.uid;
  const minutesNeeded = Number(request.data?.minutesNeeded);

  if (!Number.isFinite(minutesNeeded) || minutesNeeded <= 0) {
    throw new HttpsError('invalid-argument', 'minutesNeeded must be a positive number.');
  }

  const usageRef = db.collection('usage').doc(uid);

  const newTotal = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const currentMinutes = snap.exists ? (snap.data().minutesUsed || 0) : 0;
    const remaining = USAGE_QUOTA_MINUTES - currentMinutes;

    if (remaining < minutesNeeded - QUOTA_EPSILON) {
      throw new HttpsError(
        'resource-exhausted',
        `Only ${remaining.toFixed(1)} of ${USAGE_QUOTA_MINUTES} min remaining.`,
      );
    }

    const updatedMinutes = currentMinutes + minutesNeeded;
    tx.set(usageRef, { minutesUsed: updatedMinutes }, { merge: true });
    return updatedMinutes;
  });

  return { success: true, minutesUsed: newTotal };
});

/**
 * Firestore trigger: whenever usage/{uid} changes (from recordUsage above,
 * or any manual/admin edit), push the current running total to HubSpot as
 * a contact property. Keeps minutes_used correct independent of how the
 * Firestore doc was updated.
 */
exports.syncUsageTotalToHubspot = onDocumentWritten(
  {
    document: 'usage/{uid}',
    secrets: ['HUBSPOT_TOKEN'],
    serviceAccount: SERVICE_ACCOUNT,
  },
  async (event) => {
    const minutesUsed = event.data?.after?.data()?.minutesUsed;
    if (minutesUsed === undefined) return;

    const uid = event.params.uid;

    let email;
    try {
      const user = await auth.getUser(uid);
      email = user.email;
    } catch (error) {
      console.error(`Could not look up auth user ${uid}:`, error.message);
      return;
    }
    if (!email) return;

    try {
      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
        { properties: { minutes_used: minutesUsed } },
        { headers: HUBSPOT_HEADERS() },
      );
    } catch (error) {
      console.error('HubSpot total sync failed:', error.response?.data || error.message);
    }
  },
);
