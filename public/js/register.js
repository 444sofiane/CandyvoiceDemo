import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-init.js';
import { checkProfessionalEmail } from './email-check.js';

const MIN_PASSWORD_LENGTH = 6;
const REGISTER_DEBUG_PREFIX = '[register]';

document.addEventListener('DOMContentLoaded', () => {
  console.info(`${REGISTER_DEBUG_PREFIX} script loaded`);

  const form = document.getElementById('registerForm');
  const firstNameInput = document.getElementById('firstNameInput');
  const lastNameInput = document.getElementById('lastNameInput');
  const companyInput = document.getElementById('companyInput');
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const firstNameError = document.getElementById('firstNameError');
  const lastNameError = document.getElementById('lastNameError');
  const companyError = document.getElementById('companyError');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const confirmPasswordError = document.getElementById('confirmPasswordError');
  const formMessage = document.getElementById('formMessage');
  const registerBtn = document.getElementById('registerBtn');

  console.info(`${REGISTER_DEBUG_PREFIX} dom ready`, {
    hasForm: Boolean(form),
    hasFirstNameInput: Boolean(firstNameInput),
    hasLastNameInput: Boolean(lastNameInput),
    hasCompanyInput: Boolean(companyInput),
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
    [firstNameInput, firstNameError],
    [lastNameInput, lastNameError],
    [companyInput, companyError],
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
    const trimmedFirstName = firstNameInput.value.trim();
    const trimmedLastName = lastNameInput.value.trim();
    const trimmedCompany = companyInput.value.trim();
    const trimmedEmail = emailInput.value.trim();

    console.info(`${REGISTER_DEBUG_PREFIX} validate inputs`, {
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      company: trimmedCompany,
      email: trimmedEmail,
      passwordLength: passwordInput.value.length,
      confirmPasswordLength: confirmPasswordInput.value.length,
    });

    if (!trimmedFirstName) {
      showFieldError(firstNameInput, firstNameError, 'Enter your first name.');
      hasError = true;
    } else {
      clearFieldError(firstNameInput, firstNameError);
    }

    if (!trimmedLastName) {
      showFieldError(lastNameInput, lastNameError, 'Enter your last name.');
      hasError = true;
    } else {
      clearFieldError(lastNameInput, lastNameError);
    }

    if (!trimmedCompany) {
      showFieldError(companyInput, companyError, 'Enter your company name.');
      hasError = true;
    } else {
      clearFieldError(companyInput, companyError);
    }

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
        firstNameInvalid: firstNameInput.classList.contains('is-invalid'),
        lastNameInvalid: lastNameInput.classList.contains('is-invalid'),
        companyInvalid: companyInput.classList.contains('is-invalid'),
        emailInvalid: emailInput.classList.contains('is-invalid'),
        passwordInvalid: passwordInput.classList.contains('is-invalid'),
        confirmPasswordInvalid: confirmPasswordInput.classList.contains('is-invalid'),
      });
      const firstInvalid = [firstNameInput, lastNameInput, companyInput, emailInput, passwordInput, confirmPasswordInput]
        .find((el) => el.classList.contains('is-invalid'));
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

    // Set the Firebase Auth display name too, so it's visible anywhere the
    // app reads user.displayName (e.g. future UI), independent of HubSpot.
    try {
      await updateProfile(credential.user, { displayName: `${trimmedFirstName} ${trimmedLastName}`.trim() });
    } catch (error) {
      console.warn(`${REGISTER_DEBUG_PREFIX} updateProfile failed`, error);
    }

    // Write the registration profile to Firestore. A Cloud Function
    // (syncUserProfileToHubspot, triggered on this document's writes) picks
    // this up and pushes firstname/lastname/company to the matching HubSpot
    // contact — kept separate from the auth-creation contact stub so this
    // never blocks account creation itself if Firestore has a hiccup.
    try {
      console.info(`${REGISTER_DEBUG_PREFIX} writing profile to Firestore`);
      await setDoc(doc(db, 'userProfiles', credential.user.uid), {
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        company: trimmedCompany,
        email: trimmedEmail,
        createdAt: serverTimestamp(),
      });
      console.info(`${REGISTER_DEBUG_PREFIX} profile written`);
    } catch (error) {
      console.error(`${REGISTER_DEBUG_PREFIX} profile write failed`, {
        code: error?.code,
        message: error?.message,
        error,
      });
      // Don't block the signup flow on this — the account itself is valid.
      // The user's name/company just won't be synced to HubSpot yet.
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
