import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions } from './firebase-init.js';

const syncContactProfileCallable = httpsCallable(functions, 'syncContactProfile');

export async function syncContactProfile(user, profile = {}) {
  if (!user) return null;

  try {
    const result = await syncContactProfileCallable(profile);
    return result.data;
  } catch (error) {
    console.error('Could not sync contact profile:', error);
    return null;
  }
}