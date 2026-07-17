
const EMAIL_DOMAINS_URL = new URL('../assets/public_email_domains-ALL.txt', import.meta.url);

async function loadFreeEmailDomains() {
  const response = await fetch(EMAIL_DOMAINS_URL);

  if (!response.ok) {
    throw new Error(`Failed to load free email domains: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text
    .split(/\r?\n/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

const FREE_EMAIL_DOMAINS = new Set(await loadFreeEmailDomains());

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email) {
  return EMAIL_REGEX.test(email.trim());
}

export function getEmailDomain(email) {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : null;
}

export function checkProfessionalEmail(email) {
  const trimmed = email.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Enter your work email.' };
  }
  if (!isValidEmailFormat(trimmed)) {
    return { valid: false, reason: 'Enter a valid email address.' };
  }

  const domain = getEmailDomain(trimmed);
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return { valid: false, reason: `${domain} is a personal email provider — please use your work email.` };
  }

  return { valid: true };
}
