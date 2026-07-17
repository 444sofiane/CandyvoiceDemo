

import {
  formatSize,
  buildApiUrl,
  resolveApiUrl,
  parseJsonResponse,
  setMessageText,
  setStatusBadge,
} from './noise-filter-utils.js';
import { createLevelGraph } from './noise-filter-graph.js';
import { createSpectrogramController } from './noise-filter-spectrogram.js';
import { convertFileToWav } from './noise-filter-convert.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import {
  subscribeUsage,
  getRemainingMinutes,
  hasQuotaFor,
  recordUsage,
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

document.addEventListener('DOMContentLoaded', () => {
  console.log('noisefilter.js loaded');

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

  const levelGraphBlock = document.getElementById('levelGraphBlock');
  const levelCanvas = document.getElementById('levelCanvas');
  const compareBtn = document.getElementById('compareBtn');

  const filterBtn = document.getElementById('filterBtn');
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

  const apiUrl = buildApiUrl({
    search: window.location.search,
    bodyDataset: document.body.dataset,
    protocol: window.location.protocol,
    port: window.location.port,
  });

  const levelGraph = createLevelGraph({
    levelCanvas,
    originalAudio,
    resultAudio,
    setMessage: (message, isError = false) => setMessageText(messageBox, message, isError),
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

    if (!spectrogramController || !levelGraph) {
      console.error('Spectrogram controller or level graph is not initialized.');
      return;
    }

    if (comparePlaying) {
      spectrogramController.stop();
      levelGraph.stop();
      compareBtn.textContent = 'Play & compare levels';
      comparePlaying = false;
    } else {
      levelGraph.start();
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

  setupAudioSync(originalAudio, resultAudio);

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

  function applyQuotaGate() {
    if (!auth.currentUser || !currentFile) return true;

    const remaining = getRemainingMinutes(auth.currentUser.uid);
    if (remaining <= 0) {
      filterBtn.disabled = true;
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
    levelGraphBlock.classList.add('d-none');
    levelGraph.reset();

    spectrogramBlock.classList.add('d-none');
    spectrogramController.reset();
    spectrogramController.refreshOriginal();

    compareBtn.textContent = 'Play & compare levels';
    compareBtn.disabled = true;
    comparePlaying = false;
    progressBar.style.width = '0%';
    setMessage('');

    setStatus('idle');
    filterBtn.disabled = false;
    filterBtn.textContent = 'Apply Noise Filter';

    uploadStep.classList.add('d-none');
    workStep.classList.remove('d-none');

    applyQuotaGate();
  }

  filterBtn.addEventListener('click', async () => {
    console.log('Sending file to API for noise filtering...');
    if (!currentFile) {
      console.error('No file selected for filtering.');
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

    filterBtn.disabled = true;
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
      filterBtn.disabled = false;
      filterBtn.textContent = 'Apply Noise Filter';
      return;
    }

    progressBar.style.width = '35%';
    setMessage('Sending the file to the API…');
    console.log('Using API endpoint:', apiUrl);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': fileToUpload.name,
          'X-Output-Name': fileToUpload.name.replace(/\.[^.]+$/u, '_filtered.wav'),
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
      setMessage('Processing complete.');

      console.log('API response:', data.output_url);
      const resultUrl = resolveApiUrl(apiUrl, data.output_url);
      if (resultUrl) {
        resultAudio.src = resultUrl;
        resultBlock.classList.remove('d-none');
        downloadBtn.href = resultUrl;
        downloadBtn.setAttribute('download', `filtered-${fileToUpload.name}`);
        downloadBtn.classList.remove('d-none');
        resetBtn.classList.remove('d-none');
        levelGraphBlock.classList.remove('d-none');
        compareBtn.disabled = false;
        levelGraph.reset();

        spectrogramBlock.classList.remove('d-none');
        spectrogramController.refreshResult();

        if (auth.currentUser) {
          try {
            await recordUsage(minutesNeeded);
          } catch (error) {
            console.error('Failed to record usage:', error);
            if (error.code === 'functions/resource-exhausted') {
              setMessage(
                "Filtered — but your account's quota is now used up, so this won't count until you contact us. Result is still available below.",
                true,
              );
            } else {
              setMessage(
                'Filtered — but we could not update your usage total right now. Contact support if this persists.',
                true,
              );
            }
          }
        }
      }

      filterBtn.textContent = 'Filtered';
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Processing failed.', true);
      setStatus('idle');
      filterBtn.disabled = false;
      filterBtn.textContent = 'Apply Noise Filter';
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

    levelGraph.stop();
    levelGraph.reset();
    levelGraphBlock.classList.add('d-none');

    spectrogramController.reset();
    spectrogramBlock.classList.add('d-none');

    compareBtn.textContent = 'Play & compare levels';
    compareBtn.disabled = true;
    comparePlaying = false;
    filterBtn.textContent = 'Apply Noise Filter';
    setStatus('idle');
  }

  resetBtn.addEventListener('click', resetAll);
  removeBtn.addEventListener('click', resetAll);
});