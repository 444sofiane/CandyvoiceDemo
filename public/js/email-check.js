let freeEmailDomainsPromise = null;

function getFreeEmailDomains() {
  if (!freeEmailDomainsPromise) {
    freeEmailDomainsPromise = fetch(EMAIL_DOMAINS_URL)
      .then((r) => r.text())
      .then((text) => new Set(text.split(/\r?\n/).map((d) => d.trim().toLowerCase()).filter(Boolean)));
  }
  return freeEmailDomainsPromise;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email) {
  return EMAIL_REGEX.test(email.trim());
}

export function getEmailDomain(email) {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : null;
}

export async function checkProfessionalEmail(email) {
  const domains = await getFreeEmailDomains();
  const trimmed = email.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Enter your work email.' };
  }
  if (!isValidEmailFormat(trimmed)) {
    return { valid: false, reason: 'Enter a valid email address.' };
  }

  const domain = getEmailDomain(trimmed);
  if (domains.has(domain)) {
    return { valid: false, reason: `${domain} is a personal email provider — please use your work email.` };
  }

  return { valid: true };
}
