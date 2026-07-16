
const FREE_EMAIL_DOMAINS = new Set([
  // 'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'gmx.com', 'gmx.net', 'web.de',
  'mail.com', 'inbox.com',
  'yandex.com', 'yandex.ru',
  'zoho.com',
  'qq.com', '163.com', '126.com',
  'naver.com',
  'rediffmail.com',
  'fastmail.com', 'hey.com',
]);

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
