const acquisitionSourceStorageKey = 'cv-acquisition-source';

function getQuerySource() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');

    if (utmSource || utmMedium || utmCampaign) {
      return [utmSource, utmMedium, utmCampaign].filter(Boolean).join(' / ');
    }
  } catch (error) {
    console.warn('Could not read acquisition source from query params:', error);
  }

  return null;
}

function getReferrerSource() {
  try {
    if (!document.referrer) return 'direct';
    const referrerUrl = new URL(document.referrer);
    if (referrerUrl.host === window.location.host) return 'internal';
    return referrerUrl.hostname.replace(/^www\./, '');
  } catch (error) {
    console.warn('Could not read acquisition source from referrer:', error);
    return 'direct';
  }
}

export function captureAcquisitionSource() {
  try {
    const current = sessionStorage.getItem(acquisitionSourceStorageKey);
    if (current) return current;

    const source = getQuerySource() || getReferrerSource();
    sessionStorage.setItem(acquisitionSourceStorageKey, source);
    return source;
  } catch (error) {
    console.warn('Could not capture acquisition source:', error);
    return 'direct';
  }
}

export function getAcquisitionSource() {
  try {
    return sessionStorage.getItem(acquisitionSourceStorageKey) || captureAcquisitionSource();
  } catch (error) {
    console.warn('Could not get acquisition source:', error);
    return 'direct';
  }
}

export function getBrowserLocale() {
  return navigator.language || navigator.languages?.[0] || 'unknown';
}

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}