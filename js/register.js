import { createUserWithEmailAndPassword, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { checkProfessionalEmail } from './email-check.js';

const MIN_PASSWORD_LENGTH = 6;

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registerForm');
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const confirmPasswordError = document.getElementById('confirmPasswordError');
  const formMessage = document.getElementById('formMessage');
  const registerBtn = document.getElementById('registerBtn');

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

  [
    [emailInput, emailError],
    [passwordInput, passwordError],
    [confirmPasswordInput, confirmPasswordError],
  ].forEach(([input, errorEl]) => {
    input.addEventListener('input', () => clearFieldError(input, errorEl));
  });

  function friendlyAuthError(error) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'An account already exists for that email — try signing in instead.';
      case 'auth/weak-password':
        return `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`;
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

    const emailCheck = checkProfessionalEmail(emailInput.value);
    if (!emailCheck.valid) {
      showFieldError(emailInput, emailError, emailCheck.reason);
      hasError = true;
    } else {
      clearFieldError(emailInput, emailError);
    }

    if (!passwordInput.value) {
      showFieldError(passwordInput, passwordError, 'Choose a password.');
      hasError = true;
    } else if (passwordInput.value.length < MIN_PASSWORD_LENGTH) {
      showFieldError(passwordInput, passwordError, `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`);
      hasError = true;
    } else {
      clearFieldError(passwordInput, passwordError);
    }

    if (!confirmPasswordInput.value) {
      showFieldError(confirmPasswordInput, confirmPasswordError, 'Confirm your password.');
      hasError = true;
    } else if (confirmPasswordInput.value !== passwordInput.value) {
      showFieldError(confirmPasswordInput, confirmPasswordError, "Passwords don't match.");
      hasError = true;
    } else {
      clearFieldError(confirmPasswordInput, confirmPasswordError);
    }

    if (hasError) {
      const firstInvalid = [emailInput, passwordInput, confirmPasswordInput].find((el) => el.classList.contains('is-invalid'));
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Creating account…';
    setFormMessage('Setting up your account…');

    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    } catch (error) {
      console.error(error);
      setFormMessage(friendlyAuthError(error), 'error');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create account';
      return;
    }

    try {
      await sendEmailVerification(credential.user);
    } catch (error) {
      console.error('Account was created, but sending the verification email failed:', error);
    }

    setFormMessage('Account created — check your inbox to verify your email…', 'success');
    window.location.href = 'verify-email.html';
  });
});
