import {
  formatSize,
  buildApiUrl,
  parseJsonResponse,
  setMessageText,
} from './noise-filter-utils.js';
import { convertFileToWav } from './noise-filter-convert.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import {
  subscribeUsage,
  getRemainingMinutes,
  hasQuotaFor,
  USAGE_QUOTA_MINUTES,
} from './usage-client.js';

function getAudioDurationMinutes(audioEl) {
  return new Promise((resolve) => {
    if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
      resolve(audioEl.duration / 60);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audioEl.removeEventListener('loadedmetadata', finish);
      resolve(Number.isFinite(audioEl.duration) ? audioEl.duration / 60 : 0);
    };

    audioEl.addEventListener('loadedmetadata', finish);
    setTimeout(finish, 3000);
  });
}

function setStatus(statusBadge, state) {
  if (!statusBadge) return;
  statusBadge.classList.remove('cv-status-idle', 'cv-status-processing', 'cv-status-done');

  if (state === 'idle') {
    statusBadge.classList.add('cv-status-idle');
    statusBadge.textContent = 'Ready';
  } else if (state === 'processing') {
    statusBadge.classList.add('cv-status-processing');
    statusBadge.textContent = 'Analyzing…';
  } else if (state === 'done') {
    statusBadge.classList.add('cv-status-done');
    statusBadge.textContent = 'Analyzed';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('deepfake.js loaded');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  const uploadStep = document.getElementById('uploadStep');
  const workStep = document.getElementById('workStep');

  const fileName = document.getElementById('fileName');
  const fileMeta = document.getElementById('fileMeta');
  const statusBadge = document.getElementById('statusBadge');
  const progressBar = document.getElementById('progressBar');
  const messageBox = document.getElementById('messageBox');

  const originalPreview = document.getElementById('originalPreview');
  const originalAudio = document.getElementById('originalAudio');

  const resultBlock = document.getElementById('resultBlock');
  const deepfakeScore = document.getElementById('deepfakeScore');
  const deepfakeVerdict = document.getElementById('deepfakeVerdict');
  const deepfakeMeterFill = document.getElementById('deepfakeMeterFill');

  const analyzeBtn = document.getElementById('analyzeBtn');
  const resetBtn = document.getElementById('resetBtn');
  const removeBtn = document.getElementById('removeBtn');

  let currentObjectUrl = null;
  let currentFile = null;

  const apiUrl = buildApiUrl({
    search: window.location.search,
    bodyDataset: document.body.dataset,
    protocol: window.location.protocol,
    port: window.location.port,
    endpointPath: '/api/deepfake-detect',
  });

  function setMessage(message, isError = false) {
    setMessageText(messageBox, message, isError);
  }

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  function applyQuotaGate() {
    if (!auth.currentUser || !currentFile) return true;

    const remaining = getRemainingMinutes(auth.currentUser.uid);
    if (remaining <= 0) {
      analyzeBtn.disabled = true;
      setMessage(
        `You've used your full quota (${USAGE_QUOTA_MINUTES.toFixed(0)} min) on this account. Contact us if you need more.`,
        true,
      );
      return false;
    }
    return true;
  }

  onAuthStateChanged(auth, (user) => {
    if (user) subscribeUsage(user.uid, () => applyQuotaGate());
  });

  function handleFile(file) {
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, M4A, FLAC, OGG...).');
      return;
    }

    currentFile = file;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);

    fileName.textContent = file.name;
    fileMeta.textContent = `${formatSize(file.size)} · ${file.type || 'audio'}`;

    originalAudio.src = currentObjectUrl;
    originalPreview.classList.remove('d-none');

    resultBlock.classList.add('d-none');
    deepfakeMeterFill.style.width = '0%';
    resetBtn.classList.add('d-none');
    progressBar.style.width = '0%';
    setMessage('');

    setStatus(statusBadge, 'idle');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Run detection';

    uploadStep.classList.add('d-none');
    workStep.classList.remove('d-none');

    applyQuotaGate();
  }

  function renderResult(percent, threshold) {
    const clamped = Math.max(0, Math.min(100, percent));
    deepfakeScore.textContent = `${clamped.toFixed(1)}%`;
    deepfakeMeterFill.style.width = `${clamped}%`;

    const isSynthetic = clamped >= threshold;
    deepfakeVerdict.textContent = isSynthetic ? 'Likely synthetic' : 'Likely genuine';
    deepfakeVerdict.classList.toggle('is-synthetic', isSynthetic);
    deepfakeVerdict.classList.toggle('is-genuine', !isSynthetic);

    resultBlock.classList.remove('d-none');
  }

  analyzeBtn.addEventListener('click', async () => {
    console.log('Sending file to API for deepfake detection...');
    if (!currentFile) {
      console.error('No file selected for analysis.');
      return;
    }

    const minutesNeeded = await getAudioDurationMinutes(originalAudio);

    if (auth.currentUser && !hasQuotaFor(auth.currentUser.uid, minutesNeeded)) {
      const remaining = getRemainingMinutes(auth.currentUser.uid);
      setMessage(
        `This file is about ${minutesNeeded.toFixed(1)} min, but you only have ${remaining.toFixed(1)} of ${USAGE_QUOTA_MINUTES.toFixed(0)} min left in your quota. Try a shorter file.`,
        true,
      );
      return;
    }

    analyzeBtn.disabled = true;
    setStatus(statusBadge, 'processing');
    progressBar.style.width = '10%';
    setMessage('Converting audio…');

    let fileToUpload;
    try {
      fileToUpload = await convertFileToWav(currentFile, {
        onProgress: (stage) => {
          setMessage(stage === 'decoding' ? 'Decoding audio…' : 'Encoding WAV…');
        },
      });
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Could not convert this file.', true);
      setStatus(statusBadge, 'idle');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Run detection';
      return;
    }

    if (!auth.currentUser) {
      setMessage('Your session has expired — please sign in again.', true);
      setStatus(statusBadge, 'idle');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Run detection';
      return;
    }

    progressBar.style.width = '35%';
    setMessage('Sending the file to the API…');
    console.log('Using API endpoint:', apiUrl);

    let idToken;
    try {
      idToken = await auth.currentUser.getIdToken();
    } catch (error) {
      console.error('Failed to get ID token:', error);
      setMessage('Could not verify your session. Please sign in again.', true);
      setStatus(statusBadge, 'idle');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Run detection';
      return;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': fileToUpload.name,
          Authorization: `Bearer ${idToken}`,
        },
        body: fileToUpload,
      });

      console.log('API response status:', response.status, response.statusText);
      const data = await parseJsonResponse(response);

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Detection failed.');
      }

      progressBar.style.width = '100%';
      setStatus(statusBadge, 'done');
      setMessage('Analysis complete.');

      const percent = Number(data.deepfake_percent);
      const threshold = Number.isFinite(Number(data.threshold_percent)) ? Number(data.threshold_percent) : 50;
      renderResult(Number.isFinite(percent) ? percent : 0, threshold);

      resetBtn.classList.remove('d-none');
      analyzeBtn.textContent = 'Analyzed';
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Detection failed.', true);
      setStatus(statusBadge, 'idle');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Run detection';
    }
  });

  function resetAll() {
    currentFile = null;
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    fileInput.value = '';
    workStep.classList.add('d-none');
    uploadStep.classList.remove('d-none');
    setMessage('');
    progressBar.style.width = '0%';

    originalAudio.removeAttribute('src');
    originalPreview.classList.add('d-none');

    resultBlock.classList.add('d-none');
    deepfakeMeterFill.style.width = '0%';

    resetBtn.classList.add('d-none');
    analyzeBtn.textContent = 'Run detection';
    setStatus(statusBadge, 'idle');
  }

  resetBtn.addEventListener('click', resetAll);
  removeBtn.addEventListener('click', resetAll);
});
