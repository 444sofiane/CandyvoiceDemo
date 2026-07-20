import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { firebaseConfig } from './firebase-config.js';
import { getCachedUsageMinutes, subscribeUsage, formatQuota, USAGE_QUOTA_MINUTES } from './usage-client.js';
import { syncEmailVerifiedStatus } from './hubspot-verification-sync.js';
import { captureAcquisitionSource, getAcquisitionSource, getBrowserLocale, getBrowserTimezone } from './contact-context.js';
import { syncContactProfile } from './contact-profile-sync.js';

const featureInterestEndpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/trackFeatureInterest`;
const pendingFeatureInterestStorageKey = 'cv-pending-feature-interests';

document.documentElement.style.visibility = 'hidden';

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  if (!user.emailVerified) {
    window.location.href = 'verify-email.html';
    return;
  }

  document.documentElement.style.visibility = 'visible';
  captureAcquisitionSource();
  setupUserMenu(user);
  setupFeatureInterestTracking(user);
  void flushPendingFeatureInterests(user);
  void syncContactProfile(user, {
    acquisitionSource: getAcquisitionSource(),
    browserLocale: getBrowserLocale(),
    browserTimezone: getBrowserTimezone(),
  });

  // Defensive re-sync: covers a verified user landing here without ever
  // clicking "I've verified" on verify-email.html (e.g. verified in another
  // tab, then reloaded straight into this page). Doesn't block rendering —
  // it's deduped per session, so this is a no-op after the first run.
  syncEmailVerifiedStatus(user);
});

function setupUserMenu(user) {
  const avatarBtn = document.getElementById('avatarBtn');
  const avatarInitial = document.getElementById('avatarInitial');
  const userDropdown = document.getElementById('userDropdown');
  const userEmailDisplay = document.getElementById('userEmailDisplay');
  const usageValue = document.getElementById('usageValue');
  const usageBarFill = document.getElementById('usageBarFill');
  const signOutBtn = document.getElementById('signOutBtn');

  if (!avatarBtn || !userDropdown) return;

  avatarInitial.textContent = (user.email || '?').charAt(0).toUpperCase();
  userEmailDisplay.textContent = user.email || '';

  function renderUsage(usedMinutes) {
    usageValue.textContent = formatQuota(usedMinutes);
    const percent = Math.min(100, (usedMinutes / USAGE_QUOTA_MINUTES) * 100);
    usageBarFill.style.width = `${percent}%`;
    usageBarFill.classList.toggle('cv-usage-bar-fill--full', usedMinutes >= USAGE_QUOTA_MINUTES);
  }

  renderUsage(getCachedUsageMinutes(user.uid));
  subscribeUsage(user.uid, renderUsage);

  function openDropdown() {
    userDropdown.classList.remove('d-none');
    avatarBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    userDropdown.classList.add('d-none');
    avatarBtn.setAttribute('aria-expanded', 'false');
  }

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (userDropdown.classList.contains('d-none')) openDropdown();
    else closeDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target) && e.target !== avatarBtn) closeDropdown();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });

  signOutBtn.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}

function setupFeatureInterestTracking(user) {
  const featureLinks = Array.from(document.querySelectorAll('.cv-feature-link'));
  if (!featureLinks.length) return;

  featureLinks.forEach((link) => {
    if (link.dataset.featureTrackingBound === 'true') return;
    link.dataset.featureTrackingBound = 'true';

    if (link.getAttribute('aria-current') === 'page') return;

    link.addEventListener('click', (event) => {
      void handleFeatureLinkClick(event, link, user);
    });
  });
}

async function handleFeatureLinkClick(event, link, user) {
  event.preventDefault();

  const destination = link.href;
  const feature = featureFromLink(link);

  if (feature) {
    queueFeatureInterest(feature);
  }

  window.location.href = destination;
}

function queueFeatureInterest(feature) {
  const pending = readPendingFeatureInterests();
  pending.push({
    feature,
    queuedAt: Date.now(),
  });
  sessionStorage.setItem(pendingFeatureInterestStorageKey, JSON.stringify(pending));
}

function readPendingFeatureInterests() {
  try {
    const stored = sessionStorage.getItem(pendingFeatureInterestStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.feature === 'string') : [];
  } catch (error) {
    console.warn('Could not read pending feature interests:', error);
    return [];
  }
}

function storePendingFeatureInterests(pending) {
  if (!pending.length) {
    sessionStorage.removeItem(pendingFeatureInterestStorageKey);
    return;
  }

  sessionStorage.setItem(pendingFeatureInterestStorageKey, JSON.stringify(pending));
}

async function flushPendingFeatureInterests(user) {
  const pending = readPendingFeatureInterests();
  if (!pending.length) return;

  const remaining = [];

  for (const entry of pending) {
    const sent = await sendFeatureInterest(user, entry.feature);
    if (!sent) {
      remaining.push(entry);
    }
  }

  storePendingFeatureInterests(remaining);
}

function featureFromLink(link) {
  const href = (link.getAttribute('href') || '').toLowerCase();
  if (href.includes('deepfake')) return 'deepfake';
  if (href.includes('imitation')) return 'imitation';
  if (href.includes('noise') || href.includes('noisefilter')) return 'noizeoff';
  return null;
}

async function sendFeatureInterest(user, feature) {
  try {
    const token = await user.getIdToken();
    const response = await fetch(featureInterestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ feature }),
      keepalive: true,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Feature interest tracking failed:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Feature interest tracking failed:', error);
    return false;
  }
}
