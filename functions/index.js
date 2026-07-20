const functionsV1 = require('firebase-functions/v1');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
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

const HUBSPOT_CONTACT_PROPERTY_DEFINITIONS = {
  signup_date: {
    groupName: 'contactinformation',
    name: 'signup_date',
    label: 'Signup date',
    type: 'date',
    fieldType: 'date',
  },
  email_verified: {
    groupName: 'contactinformation',
    name: 'email_verified',
    label: 'Email verified',
    type: 'bool',
    fieldType: 'booleancheckbox', 
  },
  minutes_used: {
    groupName: 'contactinformation',
    name: 'minutes_used',
    label: 'Minutes used',
    type: 'number',
    fieldType: 'number',
  },
  firebase_uid: {
    groupName: 'contactinformation',
    name: 'firebase_uid',
    label: 'Firebase UID',
    type: 'string',
    fieldType: 'text',
  },
  last_feature_clicked: {
    groupName: 'contactinformation',
    name: 'last_feature_clicked',
    label: 'Last feature clicked',
    type: 'string',
    fieldType: 'text',
  },
  last_feature_clicked_at: {
    groupName: 'contactinformation',
    name: 'last_feature_clicked_at',
    label: 'Last feature clicked at',
    type: 'date',
    fieldType: 'date',
  },
  favorite_feature: {
    groupName: 'contactinformation',
    name: 'favorite_feature',
    label: 'Favorite feature',
    type: 'string',
    fieldType: 'text',
  },
  favorite_feature_updated_at: {
    groupName: 'contactinformation',
    name: 'favorite_feature_updated_at',
    label: 'Favorite feature updated at',
    type: 'date',
    fieldType: 'date',
  },
  feature_clicks_deepfake: {
    groupName: 'contactinformation',
    name: 'feature_clicks_deepfake',
    label: 'Feature clicks deepfake',
    type: 'number',
    fieldType: 'number',
  },
  feature_clicks_imitation: {
    groupName: 'contactinformation',
    name: 'feature_clicks_imitation',
    label: 'Feature clicks imitation',
    type: 'number',
    fieldType: 'number',
  },
  feature_clicks_noizeoff: {
    groupName: 'contactinformation',
    name: 'feature_clicks_noizeoff',
    label: 'Feature clicks noizeoff',
    type: 'number',
    fieldType: 'number',
  },
  email_verified_date: {
    groupName: 'contactinformation',
    name: 'email_verified_date',
    label: 'Email verified date',
    type: 'date',
    fieldType: 'date',
  },
  last_seen_at: {
    groupName: 'contactinformation',
    name: 'last_seen_at',
    label: 'Last seen at',
    type: 'datetime',
    fieldType: 'date',
  },
  acquisition_source: {
    groupName: 'contactinformation',
    name: 'acquisition_source',
    label: 'Acquisition source',
    type: 'string',
    fieldType: 'text',
  },
  browser_locale: {
    groupName: 'contactinformation',
    name: 'browser_locale',
    label: 'Browser locale',
    type: 'string',
    fieldType: 'text',
  },
  browser_timezone: {
    groupName: 'contactinformation',
    name: 'browser_timezone',
    label: 'Browser timezone',
    type: 'string',
    fieldType: 'text',
  },
  total_feature_clicks: {
    groupName: 'contactinformation',
    name: 'total_feature_clicks',
    label: 'Total feature clicks',
    type: 'number',
    fieldType: 'number',
  },
  last_active_feature: {
    groupName: 'contactinformation',
    name: 'last_active_feature',
    label: 'Last active feature',
    type: 'string',
    fieldType: 'text',
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

function toHubspotDateTime(date = new Date()) {
  return date.toISOString();
}

async function ensureHubspotContactProperty(propertyName) {
  const definition = HUBSPOT_CONTACT_PROPERTY_DEFINITIONS[propertyName];
  if (!definition) return;

  const propertyUrl = `https://api.hubapi.com/crm/v3/properties/contacts/${encodeURIComponent(propertyName)}`;

  try {
    await axios.get(propertyUrl, { headers: HUBSPOT_HEADERS() });
  } catch (error) {
    if (error.response?.status !== 404) {
      throw error;
    }

    try {
      await axios.post(
        'https://api.hubapi.com/crm/v3/properties/contacts',
        definition,
        { headers: HUBSPOT_HEADERS() },
      );
      console.log(`Created missing HubSpot contact property: ${propertyName}`);
    } catch (createError) {
      if (createError.response?.status !== 409) {
        throw createError;
      }
    }
  }
}

async function ensureHubspotContactProperties(propertyNames) {
  const uniquePropertyNames = [...new Set(propertyNames)].filter(Boolean);
  for (const propertyName of uniquePropertyNames) {
    await ensureHubspotContactProperty(propertyName);
  }
}

function normalizeClickCounts(clickCounts = {}) {
  return {
    deepfake: Number(clickCounts.deepfake || 0),
    imitation: Number(clickCounts.imitation || 0),
    noizeoff: Number(clickCounts.noizeoff || 0),
  };
}

function normalizeTextValue(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
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

    await ensureHubspotContactProperties([
      'firebase_uid',
      'last_feature_clicked',
      'last_feature_clicked_at',
      'favorite_feature',
      'favorite_feature_updated_at',
      'feature_clicks_deepfake',
      'feature_clicks_imitation',
      'feature_clicks_noizeoff',
      'total_feature_clicks',
      'last_active_feature',
    ]);

    const contactUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(user.email)}?idProperty=email`;
    const currentProps = FEATURE_CLICK_PROPERTIES[featureKey];

    const featureUsageRef = db.collection('feature_usage').doc(decodedToken.uid);
    const clickCounts = await db.runTransaction(async (tx) => {
      const snap = await tx.get(featureUsageRef);
      const storedCounts = normalizeClickCounts(snap.exists ? snap.data()?.clickCounts : {});
      const totalFeatureClicks = Number(snap.exists ? snap.data()?.totalFeatureClicks || 0 : 0);
      storedCounts[featureKey] += 1;

      tx.set(
        featureUsageRef,
        {
          uid: decodedToken.uid,
          email: user.email,
          clickCounts: storedCounts,
          totalFeatureClicks: totalFeatureClicks + 1,
          lastFeatureKey: featureKey,
          last_feature_clicked: currentProps.label,
          favorite_feature: getFavoriteFeature(storedCounts),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return storedCounts;
    });

    const properties = {
      email: user.email,
      firebase_uid: decodedToken.uid,
      [currentProps.count]: clickCounts[featureKey],
      last_feature_clicked: currentProps.label,
      last_feature_clicked_at: toHubspotDateOnly(),
      favorite_feature: getFavoriteFeature(clickCounts),
      favorite_feature_updated_at: toHubspotDateOnly(),
      total_feature_clicks: Object.values(clickCounts).reduce((sum, count) => sum + Number(count || 0), 0),
      last_active_feature: currentProps.label,
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
      await ensureHubspotContactProperties([
        'signup_date',
        'email_verified',
        'minutes_used',
        'acquisition_source',
        'last_seen_at',
      ]);
      await axios.post(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        {
          properties: {
            email: user.email,
            firebase_uid: user.uid,
            signup_date: toHubspotDateOnly(new Date(user.metadata.creationTime)),
            minutes_used: 0,
            email_verified: false,
            acquisition_source: 'registration',
            last_seen_at: toHubspotDateTime(new Date(user.metadata.creationTime)),
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
      await ensureHubspotContactProperties(['email_verified', 'email_verified_date']);
      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(user.email)}?idProperty=email`,
        {
          properties: {
            email_verified: true,
            email_verified_date: toHubspotDateOnly(),
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
 * Lightweight profile sync from the authenticated frontend. Updates contact
 * metadata such as last_seen_at, browser locale, timezone, and acquisition
 * source without touching usage counters.
 */
exports.syncContactProfile = onCall(
  { secrets: ['HUBSPOT_TOKEN'], serviceAccount: SERVICE_ACCOUNT },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const user = await auth.getUser(request.auth.uid);
    if (!user.email) {
      return { synced: false };
    }

    const acquisitionSource = normalizeTextValue(request.data?.acquisitionSource, 'direct');
    const browserLocale = normalizeTextValue(request.data?.browserLocale);
    const browserTimezone = normalizeTextValue(request.data?.browserTimezone);

    try {
      await ensureHubspotContactProperties([
        'last_seen_at',
        'acquisition_source',
        'browser_locale',
        'browser_timezone',
      ]);

      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(user.email)}?idProperty=email`,
        {
          properties: {
            last_seen_at: toHubspotDateTime(),
            acquisition_source: acquisitionSource,
            browser_locale: browserLocale,
            browser_timezone: browserTimezone,
          },
        },
        { headers: HUBSPOT_HEADERS() },
      );

      return { synced: true };
    } catch (error) {
      console.error('HubSpot profile sync failed:', error.response?.data || error.message);
      return { synced: false };
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
      await ensureHubspotContactProperty('minutes_used');
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
