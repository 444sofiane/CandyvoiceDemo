import {
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { syncEmailVerifiedStatus } from './hubspot-verification-sync.js';

const RESEND_COOLDOWN_SECONDS = 30;

document.addEventListener('DOMContentLoaded', () => {
  const userEmailDisplay = document.getElementById('userEmailDisplay');
  const formMessage = document.getElementById('formMessage');
  const checkVerifiedBtn = document.getElementById('checkVerifiedBtn');
  const resendBtn = document.getElementById('resendBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  let cooldownTimer = null;

  function setMessage(message, variant = 'muted') {
    formMessage.textContent = message || '';
    formMessage.classList.remove('text-danger', 'text-success', 'text-muted');
    formMessage.classList.add(variant === 'error' ? 'text-danger' : variant === 'success' ? 'text-success' : 'text-muted');
  }

  function startResendCooldown() {
    let remaining = RESEND_COOLDOWN_SECONDS;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend email (${remaining}s)`;

    cooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend email';
      } else {
        resendBtn.textContent = `Resend email (${remaining}s)`;
      }
    }, 1000);
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }

    if (user.emailVerified) {
      await syncEmailVerifiedStatus(user);
      window.location.href = 'noisefilter.html';
      return;
    }

    userEmailDisplay.textContent = user.email || 'your email';

    checkVerifiedBtn.addEventListener('click', async () => {
      checkVerifiedBtn.disabled = true;
      checkVerifiedBtn.textContent = 'Checking…';
      setMessage('');

      try {
        await reload(user);
        if (user.emailVerified) {
          setMessage('Verified — redirecting…', 'success');
          await syncEmailVerifiedStatus(user);
          window.location.href = 'noisefilter.html';
        } else {
          setMessage("Still not verified — click the link in the email first, then try again.", 'error');
          checkVerifiedBtn.disabled = false;
          checkVerifiedBtn.textContent = "I've verified — continue";
        }
      } catch (error) {
        console.error(error);
        setMessage('Something went wrong checking your status. Please try again.', 'error');
        checkVerifiedBtn.disabled = false;
        checkVerifiedBtn.textContent = "I've verified — continue";
      }
    });

    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      setMessage('');

      try {
        await sendEmailVerification(user);
        setMessage('Verification email resent — check your inbox.', 'success');
        startResendCooldown();
      } catch (error) {
        console.error(error);
        const message = error.code === 'auth/too-many-requests'
          ? 'Too many requests — please wait a bit before resending.'
          : 'Could not resend the email. Please try again shortly.';
        setMessage(message, 'error');
        resendBtn.disabled = false;
      }
    });

    signOutBtn.addEventListener('click', async () => {
      await signOut(auth);
      window.location.href = 'index.html';
    });
  });
});
