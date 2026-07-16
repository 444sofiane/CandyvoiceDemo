import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { getCachedUsageMinutes, subscribeUsage, formatQuota, USAGE_QUOTA_MINUTES } from './usage-client.js';
import { syncEmailVerifiedStatus } from './hubspot-verification-sync.js';

document.documentElement.style.visibility = 'hidden';

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  if (!user.emailVerified) {
    window.location.href = 'verify-email.html';
    return;
  }

  document.documentElement.style.visibility = 'visible';
  setupUserMenu(user);

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
    window.location.href = 'login.html';
  });
}
