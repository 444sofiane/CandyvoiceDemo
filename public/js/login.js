import { signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { isValidEmailFormat } from './email-check.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions } from './firebase-init.js';



document.addEventListener('DOMContentLoaded', () => {
  const recordLogin = httpsCallable(functions, 'recordLogin');
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const formMessage = document.getElementById('formMessage');
  const signInBtn = document.getElementById('signInBtn');

  function showFieldError(input, errorEl, message) {
    input.classList.add('is-invalid');
    errorEl.textContent = message;
    errorEl.classList.remove('d-none');
  }

  function clearFieldError(input, errorEl) {
    input.classList.remove('is-invalid');
    errorEl.textContent = '';
    errorEl.classList.add('d-none');
  }

  function setFormMessage(message, variant = 'muted') {
    formMessage.textContent = message || '';
    formMessage.classList.remove('text-danger', 'text-success', 'text-muted');
    formMessage.classList.add(variant === 'error' ? 'text-danger' : variant === 'success' ? 'text-success' : 'text-muted');
  }

  [emailInput, passwordInput].forEach((input, i) => {
    const errorEl = [emailError, passwordError][i];
    input.addEventListener('input', () => clearFieldError(input, errorEl));
  });

  function friendlyAuthError(error) {
    switch (error.code) {
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return "That email/password combination doesn't match an account.";
      case 'auth/too-many-requests':
        return 'Too many attempts — please wait a moment and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormMessage('');

    let hasError = false;

    const trimmedEmail = emailInput.value.trim();
    if (!trimmedEmail) {
      showFieldError(emailInput, emailError, 'Enter your email.');
      hasError = true;
    } else if (!isValidEmailFormat(trimmedEmail)) {
      showFieldError(emailInput, emailError, 'Enter a valid email address.');
      hasError = true;
    } else {
      clearFieldError(emailInput, emailError);
    }

    if (!passwordInput.value) {
      showFieldError(passwordInput, passwordError, 'Enter your password.');
      hasError = true;
    } else {
      clearFieldError(passwordInput, passwordError);
    }

    if (hasError) {
      (emailInput.classList.contains('is-invalid') ? emailInput : passwordInput).focus();
      return;
    }

    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in…';
    setFormMessage('Checking your details…');

    try {
      const credential = await signInWithEmailAndPassword(auth, trimmedEmail, passwordInput.value);
      recordLogin().catch((err) => console.warn('Could not record login:', err)); // fire-and-forget, don't block redirect
      setFormMessage('Signed in — redirecting…', 'success');
      window.location.href = credential.user.emailVerified ? 'noisefilter.html' : 'verify-email.html';
    } catch (error) {
      console.error(error);
      setFormMessage(friendlyAuthError(error), 'error');
      signInBtn.disabled = false;
      signInBtn.textContent = 'Sign in';
    }
  });
});
