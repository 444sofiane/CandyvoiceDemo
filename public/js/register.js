import { createUserWithEmailAndPassword, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { checkProfessionalEmail } from './email-check.js';

const MIN_PASSWORD_LENGTH = 6;
const REGISTER_DEBUG_PREFIX = '[register]';

document.addEventListener('DOMContentLoaded', () => {
  console.info(`${REGISTER_DEBUG_PREFIX} script loaded`);

  const form = document.getElementById('registerForm');
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const confirmPasswordError = document.getElementById('confirmPasswordError');
  const formMessage = document.getElementById('formMessage');
  const registerBtn = document.getElementById('registerBtn');

  console.info(`${REGISTER_DEBUG_PREFIX} dom ready`, {
    hasForm: Boolean(form),
    hasEmailInput: Boolean(emailInput),
    hasPasswordInput: Boolean(passwordInput),
    hasConfirmPasswordInput: Boolean(confirmPasswordInput),
    hasRegisterBtn: Boolean(registerBtn),
  });

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
    console.info(`${REGISTER_DEBUG_PREFIX} submit start`);
    e.preventDefault();
    setFormMessage('');

    let hasError = false;
    const trimmedEmail = emailInput.value.trim();

    console.info(`${REGISTER_DEBUG_PREFIX} validate inputs`, {
      email: trimmedEmail,
      passwordLength: passwordInput.value.length,
      confirmPasswordLength: confirmPasswordInput.value.length,
    });

    const emailCheck = await Promise.resolve(checkProfessionalEmail(emailInput.value));
    console.info(`${REGISTER_DEBUG_PREFIX} email check result`, emailCheck);
    if (!emailCheck?.valid) {
      showFieldError(emailInput, emailError, emailCheck?.reason || 'Enter a valid work email address.');
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
      console.warn(`${REGISTER_DEBUG_PREFIX} validation failed`, {
        emailInvalid: emailInput.classList.contains('is-invalid'),
        passwordInvalid: passwordInput.classList.contains('is-invalid'),
        confirmPasswordInvalid: confirmPasswordInput.classList.contains('is-invalid'),
      });
      const firstInvalid = [emailInput, passwordInput, confirmPasswordInput].find((el) => el.classList.contains('is-invalid'));
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    console.info(`${REGISTER_DEBUG_PREFIX} validation passed`);
    registerBtn.disabled = true;
    registerBtn.textContent = 'Creating account…';
    setFormMessage('Setting up your account…');

    let credential;
    try {
      console.info(`${REGISTER_DEBUG_PREFIX} creating firebase user`, { email: trimmedEmail });
      credential = await createUserWithEmailAndPassword(auth, trimmedEmail, passwordInput.value);
      console.info(`${REGISTER_DEBUG_PREFIX} firebase user created`, {
        uid: credential?.user?.uid,
        emailVerified: credential?.user?.emailVerified,
      });
    } catch (error) {
      console.error(`${REGISTER_DEBUG_PREFIX} createUserWithEmailAndPassword failed`, {
        code: error?.code,
        message: error?.message,
        error,
      });
      setFormMessage(friendlyAuthError(error), 'error');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create account';
      return;
    }

    try {
      console.info(`${REGISTER_DEBUG_PREFIX} sending verification email`);
      await sendEmailVerification(credential.user);
      console.info(`${REGISTER_DEBUG_PREFIX} verification email sent`);
    } catch (error) {
      console.error(`${REGISTER_DEBUG_PREFIX} verification email failed`, {
        code: error?.code,
        message: error?.message,
        error,
      });
    }

    console.info(`${REGISTER_DEBUG_PREFIX} redirecting to verify-email.html`);
    setFormMessage('Account created — check your inbox to verify your email…', 'success');
    window.location.href = 'verify-email.html';
  });
});
