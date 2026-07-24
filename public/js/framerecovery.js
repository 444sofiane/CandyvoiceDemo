import {
  formatSize,
  buildApiUrl,
  resolveApiUrl,
  parseJsonResponse,
  setMessageText,
  setStatusBadge,
} from './noise-filter-utils.js';
import { createSpectrogramController } from './noise-filter-spectrogram.js';
import { convertFileToWav } from './noise-filter-convert.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import {
  subscribeUsage,
  getRemainingMinutes,
  hasQuotaFor,
  USAGE_QUOTA_MINUTES,
} from './usage-client.js';

// Server-side hard cap lives in api_server.py's FRAME_RECOVERY_FACTOR_MAX
// (0.5). Keep this in sync — it's what turns the slider's 0-50 percent
// display into the 0-0.5 fraction the exe expects.
const MAX_LOSS_PERCENT = 50;

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

document.addEventListener('DOMContentLoaded', () => {
  console.log('framerecovery.js loaded');

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
  const resultAudio = document.getElementById('resultAudio');

  const lossSlider = document.getElementById('lossSlider');
  const lossValue = document.getElementById('lossValue');


  const compareBtn = document.getElementById('compareBtn');

  const recoverBtn = document.getElementById('recoverBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const removeBtn = document.getElementById('removeBtn');

  const spectrogramBlock = document.getElementById('spectrogramBlock');
  const originalSpectrogramEl = document.getElementById('originalSpectrogram');
  const resultSpectrogramEl = document.getElementById('resultSpectrogram');

  let currentObjectUrl = null;
  let currentFile = null;
  let comparePlaying = false;

  originalAudio.crossOrigin = 'anonymous';
  resultAudio.crossOrigin = 'anonymous';

  if (compareBtn) compareBtn.disabled = true;

  function renderLossValue() {
    lossValue.textContent = `${lossSlider.value}%`;
  }
  lossSlider.addEventListener('input', renderLossValue);
  renderLossValue();

  const apiUrl = buildApiUrl({
    search: window.location.search,
    bodyDataset: document.body.dataset,
    protocol: window.location.protocol,
    port: window.location.port,
    endpointPath: '/api/frame-recovery',
  });


  const spectrogramController = createSpectrogramController({
    originalSpectrogramEl,
    resultSpectrogramEl,
    originalAudio,
    resultAudio,
  });

  function setMessage(message, isError = false) {
    setMessageText(messageBox, message, isError);
  }

  function setStatus(state) {
    setStatusBadge(statusBadge, state);
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

  compareBtn.addEventListener('click', () => {
    if (!spectrogramController) {
      console.error('Spectrogram controller is not initialized.');
      return;
    }

    if (comparePlaying) {
      spectrogramController.stop();
      compareBtn.textContent = 'Play & compare levels';
      comparePlaying = false;
    } else {
      spectrogramController.start();
      compareBtn.textContent = 'Stop comparison';
      comparePlaying = true;
    }
  });

  [originalAudio, resultAudio].forEach((el) => {
    el.addEventListener('ended', () => {
      if (originalAudio.ended && resultAudio.ended) {
        compareBtn.textContent = 'Play & compare levels';
        comparePlaying = false;
      }
    });
  });

  function hasUsableSrc(el) {
    return Boolean(el.currentSrc || el.src);
  }

  function setupAudioSync(a, b) {
    const DRIFT_TOLERANCE = 0.15; // seconds
    let syncing = false;

    function syncTimeFrom(source, target) {
      if (syncing || !hasUsableSrc(target)) return;
      if (Math.abs(target.currentTime - source.currentTime) <= DRIFT_TOLERANCE) return;

      syncing = true;
      try {
        target.currentTime = source.currentTime;
      } catch (err) {
      }
      syncing = false;
    }

    a.addEventListener('seeking', () => syncTimeFrom(a, b));
    b.addEventListener('seeking', () => syncTimeFrom(b, a));

    a.addEventListener('play', () => {
      if (hasUsableSrc(b) && b.paused) b.play().catch(() => {});
    });
    b.addEventListener('play', () => {
      if (hasUsableSrc(a) && a.paused) a.play().catch(() => {});
    });

    a.addEventListener('pause', () => {
      if (!b.paused) b.pause();
    });
    b.addEventListener('pause', () => {
      if (!a.paused) a.pause();
    });

    a.addEventListener('timeupdate', () => {
      if (!a.paused && !b.paused) syncTimeFrom(a, b);
    });
    b.addEventListener('timeupdate', () => {
      if (!a.paused && !b.paused) syncTimeFrom(b, a);
    });
  }

  setupAudioSync(originalAudio, resultAudio);

  function applyQuotaGate() {
    if (!auth.currentUser || !currentFile) return true;

    const remaining = getRemainingMinutes(auth.currentUser.uid);
    if (remaining <= 0) {
      recoverBtn.disabled = true;
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

    resultAudio.removeAttribute('src');
    resultBlock.classList.add('d-none');
    downloadBtn.classList.add('d-none');
    resetBtn.classList.add('d-none');

    spectrogramBlock.classList.add('d-none');
    spectrogramController.reset();
    spectrogramController.refreshOriginal();

    compareBtn.textContent = 'Play & compare levels';
    compareBtn.disabled = true;
    comparePlaying = false;
    progressBar.style.width = '0%';
    setMessage('');

    setStatus('idle');
    recoverBtn.disabled = false;
    recoverBtn.textContent = 'Simulate Loss & Recover';

    uploadStep.classList.add('d-none');
    workStep.classList.remove('d-none');

    applyQuotaGate();
  }

  recoverBtn.addEventListener('click', async () => {
    console.log('Sending file to API for frame recovery...');
    if (!currentFile) {
      console.error('No file selected for frame recovery.');
      return;
    }

    const lossPercent = Math.max(0, Math.min(MAX_LOSS_PERCENT, Number(lossSlider.value)));
    const frameRecoveryFactor = lossPercent / 100;
    if (frameRecoveryFactor <= 0) {
      setMessage('Set the frame loss slider above 0% first.', true);
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

    recoverBtn.disabled = true;
    setStatus('processing');
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
      setStatus('idle');
      recoverBtn.disabled = false;
      recoverBtn.textContent = 'Simulate Loss & Recover';
      return;
    }

    if (!auth.currentUser) {
      setMessage('Your session has expired — please sign in again.', true);
      setStatus('idle');
      recoverBtn.disabled = false;
      recoverBtn.textContent = 'Simulate Loss & Recover';
      return;
    }

    progressBar.style.width = '35%';
    setMessage(`Sending the file to the API (${lossPercent}% simulated frame loss)…`);
    console.log('Using API endpoint:', apiUrl);

    let idToken;
    try {
      idToken = await auth.currentUser.getIdToken();
    } catch (error) {
      console.error('Failed to get ID token:', error);
      setMessage('Could not verify your session. Please sign in again.', true);
      setStatus('idle');
      recoverBtn.disabled = false;
      recoverBtn.textContent = 'Simulate Loss & Recover';
      return;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': fileToUpload.name,
          'X-Output-Name': fileToUpload.name.replace(/\.[^.]+$/u, '_recovered.wav'),
          'X-Frame-Recovery-Factor': frameRecoveryFactor.toFixed(2),
          Authorization: `Bearer ${idToken}`,
        },
        body: fileToUpload,
      });

      console.log('API response status:', response.status, response.statusText);
      const data = await parseJsonResponse(response);

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Processing failed.');
      }

      progressBar.style.width = '100%';
      setStatus('done');
      setMessage(`Recovery complete — simulated ${lossPercent}% frame loss.`);

      console.log('API response:', data.output_url);
      const resultUrl = resolveApiUrl(apiUrl, data.output_url);
      if (resultUrl) {
        resultAudio.src = resultUrl;
        resultBlock.classList.remove('d-none');
        downloadBtn.href = resultUrl;
        downloadBtn.setAttribute('download', `recovered-${fileToUpload.name}`);
        downloadBtn.classList.remove('d-none');
        resetBtn.classList.remove('d-none');
        compareBtn.disabled = false;

        spectrogramBlock.classList.remove('d-none');
        spectrogramController.refreshResult();
      }

      recoverBtn.textContent = 'Recovered';
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Processing failed.', true);
      setStatus('idle');
      recoverBtn.disabled = false;
      recoverBtn.textContent = 'Simulate Loss & Recover';
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

    resultAudio.removeAttribute('src');
    resultBlock.classList.add('d-none');
    downloadBtn.classList.add('d-none');
    resetBtn.classList.add('d-none');

    originalAudio.removeAttribute('src');
    originalPreview.classList.add('d-none');

    spectrogramController.reset();
    spectrogramBlock.classList.add('d-none');

    compareBtn.textContent = 'Play & compare levels';
    compareBtn.disabled = true;
    comparePlaying = false;
    recoverBtn.textContent = 'Simulate Loss & Recover';
    setStatus('idle');
  }

  resetBtn.addEventListener('click', resetAll);
  removeBtn.addEventListener('click', resetAll);
});
