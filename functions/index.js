const functionsV1 = require('firebase-functions/v1');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const axios = require('axios');
const { FieldValue } = require('firebase-admin/firestore');

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

const FEATURE_CLICK_PROPERTIES = {
  deepfake: {
    count: 'feature_clicks_deepfake',
    label: 'Deepfake detection',
  },
  imitation: {
    count: 'feature_clicks_imitation',
    label: 'Imitation',
  },
  noizeoff: {
    count: 'feature_clicks_noizeoff',
    label: 'NoizeOff',
  },
};

function normalizeFeatureName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('deepfake')) return 'deepfake';
  if (normalized.includes('imitation')) return 'imitation';
  if (normalized.includes('noizeoff') || normalized.includes('noiseoff') || normalized.includes('noise filter')) return 'noizeoff';
  return null;
}

/**
 * HubSpot "Date picker" properties (as opposed to "Date and time picker")
 * reject anything that isn't exactly midnight UTC — a plain
 * `new Date().toISOString()` gets rejected with INVALID_DATE because it
 * carries the actual time of day. This truncates to the UTC calendar day.
 * If a property is switched to "Date and time picker" in HubSpot, use
 * `new Date().toISOString()` directly for that property instead.
 */
function toHubspotDateOnly(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getFavoriteFeature(clickCounts) {
  const entries = Object.entries(clickCounts);
  if (!entries.length) return null;

  let favorite = entries[0];
  for (const entry of entries.slice(1)) {
    if (entry[1] > favorite[1]) favorite = entry;
  }

  return FEATURE_CLICK_PROPERTIES[favorite[0]]?.label || null;
}

/**
 * PATCHes a HubSpot contact by email, falling back to a POST create if the
 * contact doesn't exist yet (404). Shared by any sync path that writes
 * contact properties keyed off email, so every call site behaves the same
 * way regardless of which Firestore/Auth event triggered it.
 */
async function upsertHubspotContactByEmail(email, properties) {
  const contactUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`;

  try {
    await axios.patch(contactUrl, { properties }, { headers: HUBSPOT_HEADERS() });
    return { created: false };
  } catch (error) {
    if (error.response?.status === 404) {
      await axios.post(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        { properties: { email, ...properties } },
        { headers: HUBSPOT_HEADERS() },
      );
      return { created: true };
    }
    throw error;
  }
}

exports.trackFeatureInterest = onRequest(
  { secrets: ['HUBSPOT_TOKEN'], serviceAccount: SERVICE_ACCOUNT },
  async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = request.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      response.status(401).json({ error: 'Missing Firebase auth token' });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (error) {
      response.status(401).json({ error: 'Invalid Firebase auth token' });
      return;
    }

    const featureKey = normalizeFeatureName(request.body?.feature || request.body?.featureKey || request.query?.feature);
    if (!featureKey) {
      response.status(400).json({ error: 'feature is required' });
      return;
    }

    let user;
    try {
      user = await auth.getUser(decodedToken.uid);
    } catch (error) {
      response.status(404).json({ error: 'Authenticated user not found' });
      return;
    }

    if (!user.email) {
      response.status(400).json({ error: 'User email is required' });
      return;
    }

    const contactUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(user.email)}?idProperty=email&properties=feature_clicks_deepfake,feature_clicks_imitation,feature_clicks_noizeoff`;
    const currentProps = FEATURE_CLICK_PROPERTIES[featureKey];

    let clickCounts = {
      deepfake: 0,
      imitation: 0,
      noizeoff: 0,
    };

    try {
      const existing = await axios.get(contactUrl, { headers: HUBSPOT_HEADERS() });
      const properties = existing.data?.properties || {};
      clickCounts = {
        deepfake: Number(properties.feature_clicks_deepfake || 0),
        imitation: Number(properties.feature_clicks_imitation || 0),
        noizeoff: Number(properties.feature_clicks_noizeoff || 0),
      };
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error('HubSpot feature lookup failed:', error.response?.data || error.message);
        response.status(502).json({ error: 'Could not read HubSpot contact' });
        return;
      }
    }

    clickCounts[featureKey] += 1;

    const properties = {
      email: user.email,
      firebase_uid: decodedToken.uid,
      [currentProps.count]: clickCounts[featureKey],
      last_feature_clicked: currentProps.label,
      last_feature_clicked_at: toHubspotDateOnly(),
      favorite_feature: getFavoriteFeature(clickCounts),
      favorite_feature_updated_at: toHubspotDateOnly(),
    };

    try {
      await axios.patch(
        contactUrl,
        { properties },
        { headers: HUBSPOT_HEADERS() },
      );
    } catch (error) {
      if (error.response?.status === 404) {
        try {
          await axios.post(
            'https://api.hubapi.com/crm/v3/objects/contacts',
            { properties: { ...properties, [currentProps.count]: clickCounts[featureKey] } },
            { headers: HUBSPOT_HEADERS() },
          );
        } catch (createError) {
          console.error('HubSpot feature interest create failed:', createError.response?.data || createError.message);
          response.status(502).json({ error: 'Could not create HubSpot contact' });
          return;
        }
      } else {
        console.error('HubSpot feature interest sync failed:', error.response?.data || error.message);
        response.status(502).json({ error: 'Could not update HubSpot contact' });
        return;
      }
    }

    response.json({
      ok: true,
      feature: currentProps.label,
      favoriteFeature: getFavoriteFeature(clickCounts),
      clickCounts,
    });
  },
);

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

  /*
  recordSessionTime is called by the client when a session ends (pagehide or visibilitychange). It increments totalSeconds and sessionCount in Firestore
  for the user, capped at 2 hours per session. This is separate from the
  onUserCreated trigger because a user can have multiple sessions, and we
  want to track that.
  */

  exports.recordSessionTime = onRequest(async (request, response) => {
  response.set('Access-Control-Allow-Origin', '*');

  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed');
    return;
  }

  let body;
  try {
    body = JSON.parse(request.rawBody.toString());
  } catch (error) {
    response.status(400).send('Invalid payload');
    return;
  }

  const { idToken, durationSeconds } = body;
  if (!idToken || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    response.status(400).send('Invalid payload');
    return;
  }

  let decodedToken;
  try {
    decodedToken = await auth.verifyIdToken(idToken);
  } catch (error) {
    response.status(401).send('Invalid token');
    return;
  }

  const cappedSeconds = Math.min(durationSeconds, 2 * 60 * 60);
  const ref = db.collection('sessions').doc(decodedToken.uid);
  await ref.set(
    {
      totalSeconds: FieldValue.increment(cappedSeconds),
      sessionCount: FieldValue.increment(1),
    },
    { merge: true },
  );

  response.status(204).send();
});

exports.syncSessionTimeToHubspot = onDocumentWritten(
  {
    document: 'sessions/{uid}',
    secrets: ['HUBSPOT_TOKEN'],
    serviceAccount: SERVICE_ACCOUNT,
  },
  async (event) => {
    const data = event.data?.after?.data();
    if (!data || !data.sessionCount) return;

    const uid = event.params.uid;
    let email;
    try {
      email = (await auth.getUser(uid)).email;
    } catch (error) {
      console.error(`Could not look up auth user ${uid}:`, error.message);
      return;
    }
    if (!email) return;

    const avgMinutes = Math.round((data.totalSeconds / data.sessionCount / 60) * 10) / 10;

    try {
      await upsertHubspotContactByEmail(email, {
        avg_session_minutes: avgMinutes,
        total_sessions: data.sessionCount,
      });
    } catch (error) {
      console.error('HubSpot session time sync failed:', error.response?.data || error.message);
    }
  },
);

/**
 * Firestore trigger: fires when userProfiles/{uid} is written (currently
 * only a one-time `create`, per firestore.rules — see register.js for the
 * client-side write). Pushes firstname/lastname/company to the matching
 * HubSpot contact as standard contact properties.
 *
 * Deliberately separate from onUserCreated above: that trigger fires the
 * instant the Auth user is created, which can race ahead of this Firestore
 * write completing. Using upsertHubspotContactByEmail here means this still
 * works correctly (falls back to creating the contact) even if this trigger
 * somehow runs before onUserCreated's contact-creation POST lands.
 */
exports.syncUserProfileToHubspot = onDocumentWritten(
  {
    document: 'userProfiles/{uid}',
    secrets: ['HUBSPOT_TOKEN'],
    serviceAccount: SERVICE_ACCOUNT,
  },
  async (event) => {
    const profile = event.data?.after?.data();
    if (!profile) return;

    const { firstName, lastName, company, email } = profile;
    if (!email) {
      console.warn(`userProfiles/${event.params.uid} has no email, skipping HubSpot sync`);
      return;
    }

    try {
      await upsertHubspotContactByEmail(email, {
        firstname: firstName || '',
        lastname: lastName || '',
        company: company || '',
        firebase_uid: event.params.uid,
      });
      console.log(`HubSpot profile synced for ${email}`);
    } catch (error) {
      console.error('HubSpot profile sync failed:', error.response?.data || error.message);
    }
  },
);

/**
 * Callable used by authenticated pages to keep the HubSpot contact in sync
 * with live profile metadata that is only known client-side at page load
 * time (for example acquisition source and browser info).
 */
exports.syncContactProfile = onCall(
  { secrets: ['HUBSPOT_TOKEN'], serviceAccount: SERVICE_ACCOUNT },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const user = await auth.getUser(request.auth.uid);
    if (!user.email) {
      return { synced: false, reason: 'missing-email' };
    }

    const profile = request.data || {};
    const properties = {
      firebase_uid: user.uid,
    };

    if (typeof profile.acquisitionSource === 'string' && profile.acquisitionSource.trim()) {
      properties.acquisition_source = profile.acquisitionSource.trim();
    }
    if (typeof profile.browserLocale === 'string' && profile.browserLocale.trim()) {
      properties.browser_locale = profile.browserLocale.trim();
    }
    if (typeof profile.browserTimezone === 'string' && profile.browserTimezone.trim()) {
      properties.browser_timezone = profile.browserTimezone.trim();
    }

    try {
      await upsertHubspotContactByEmail(user.email, properties);
      return { synced: true };
    } catch (error) {
      console.error('HubSpot contact profile sync failed:', error.response?.data || error.message);
      return { synced: false };
    }
  },
);

/*
  recordLogin is called by the client after a successful login, to increment
  the login count and update lastLoginAt in Firestore. This is separate from
  the onUserCreated trigger because a user can log in multiple times, and we
  want to track that.
*/



exports.recordLogin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const ref = db.collection('logins').doc(request.auth.uid);
  await ref.set(
    { count: FieldValue.increment(1), lastLoginAt: serverTimestampAdmin() },
    { merge: true },
  );
  return { ok: true };
});

// Small helper so this file doesn't need a second firestore import style
function serverTimestampAdmin() {
  return admin.firestore.FieldValue.serverTimestamp();
}

exports.syncLoginCountToHubspot = onDocumentWritten(
  {
    document: 'logins/{uid}',
    secrets: ['HUBSPOT_TOKEN'],
    serviceAccount: SERVICE_ACCOUNT,
  },
  async (event) => {
    const count = event.data?.after?.data()?.count;
    if (count === undefined) return;

    const uid = event.params.uid;
    let email;
    try {
      email = (await auth.getUser(uid)).email;
    } catch (error) {
      console.error(`Could not look up auth user ${uid}:`, error.message);
      return;
    }
    if (!email) return;

    try {
      await upsertHubspotContactByEmail(email, {
        login_count: count,
        last_login_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('HubSpot login count sync failed:', error.response?.data || error.message);
    }
  },
);

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
