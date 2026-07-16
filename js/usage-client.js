import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { db, functions } from './firebase-init.js';


export const USAGE_QUOTA_MINUTES = 60;

const cache = new Map();
const listenersByUid = new Map();
const unsubscribeByUid = new Map();

function ensureSubscription(uid) {
  if (unsubscribeByUid.has(uid)) return;

  const ref = doc(db, 'usage', uid);
  const unsubscribe = onSnapshot(
    ref,
    (snap) => {
      const minutesUsed = snap.exists() ? (snap.data().minutesUsed || 0) : 0;
      cache.set(uid, minutesUsed);
      (listenersByUid.get(uid) || new Set()).forEach((callback) => callback(minutesUsed));
    },
    (error) => {
      console.error('Usage subscription failed:', error);
    },
  );
  unsubscribeByUid.set(uid, unsubscribe);
}

export function subscribeUsage(uid, callback) {
  ensureSubscription(uid);
  if (!listenersByUid.has(uid)) listenersByUid.set(uid, new Set());
  listenersByUid.get(uid).add(callback);
  if (cache.has(uid)) callback(cache.get(uid));
  return () => listenersByUid.get(uid)?.delete(callback);
}

export function getCachedUsageMinutes(uid) {
  return cache.get(uid) || 0;
}

export function getRemainingMinutes(uid) {
  return Math.max(0, USAGE_QUOTA_MINUTES - getCachedUsageMinutes(uid));
}

const QUOTA_EPSILON = 0.01;

export function hasQuotaFor(uid, minutesNeeded) {
  return getRemainingMinutes(uid) >= minutesNeeded - QUOTA_EPSILON;
}

export function formatQuota(usedMinutes) {
  return `${usedMinutes.toFixed(1)} / ${USAGE_QUOTA_MINUTES.toFixed(0)} min`;
}

const recordUsageCallable = httpsCallable(functions, 'recordUsage');

export async function recordUsage(minutesNeeded) {
  const result = await recordUsageCallable({ minutesNeeded });
  return result.data;
}
