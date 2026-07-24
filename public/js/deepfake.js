import {
  formatSize,
  buildApiUrl,
  parseJsonResponse,
  setMessageText,
  readNdjsonStream,
} from './noise-filter-utils.js';
import { convertFileToWav } from './noise-filter-convert.js';
import { createDeepfakeGraph } from './deepfake-graph.js';
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

  const graphBlock = document.getElementById('deepfakeGraphBlock');
  const graphCanvas = document.getElementById('deepfakeGraphCanvas');
  const deepfakeGraph = graphCanvas ? createDeepfakeGraph({ canvas: graphCanvas }) : null;

  const confidentialCheck = document.getElementById('confidentialCheck');

  const syncPlayheadToggle = document.getElementById('syncPlayheadToggle');
  let syncPlayheadEnabled = syncPlayheadToggle ? syncPlayheadToggle.checked : true;

  function updatePlayheadFromAudio() {
    if (!deepfakeGraph || !syncPlayheadEnabled) return;
    deepfakeGraph.setPlayhead(originalAudio.currentTime);
  }

  if (syncPlayheadToggle) {
    syncPlayheadToggle.addEventListener('change', () => {
      syncPlayheadEnabled = syncPlayheadToggle.checked;
      if (!deepfakeGraph) return;
      if (syncPlayheadEnabled) updatePlayheadFromAudio();
      else deepfakeGraph.clearPlayhead();
    });
  }

  originalAudio.addEventListener('timeupdate', updatePlayheadFromAudio);
  originalAudio.addEventListener('seeking', updatePlayheadFromAudio);
  originalAudio.addEventListener('play', updatePlayheadFromAudio);

  if (graphCanvas) {
    graphCanvas.style.cursor = 'pointer';
    graphCanvas.addEventListener('click', (event) => {
      if (!deepfakeGraph || !currentFile) return;
      const targetTime = deepfakeGraph.timeForClientX(event.clientX);
      if (!Number.isFinite(targetTime)) return;
      originalAudio.currentTime = targetTime;
      originalAudio.play().catch(() => { });
      updatePlayheadFromAudio();
    });
  }

  let currentObjectUrl = null;
  let currentFile = null;
  let currentRequestId = 0;
  let activeAbortController = null;

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

    if (graphBlock) graphBlock.classList.add('d-none');
    if (deepfakeGraph) deepfakeGraph.reset();

    setStatus(statusBadge, 'idle');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Run detection';

    uploadStep.classList.add('d-none');
    workStep.classList.remove('d-none');

    applyQuotaGate();
  }

  function renderResult(percent, threshold, { live = false } = {}) {
    const clamped = Math.max(0, Math.min(100, percent));
    deepfakeScore.textContent = `${clamped.toFixed(1)}%`;
    deepfakeMeterFill.style.width = `${clamped}%`;

    const isSynthetic = clamped >= threshold;
    deepfakeVerdict.textContent = live
      ? 'Analyzing…'
      : (isSynthetic ? 'Likely synthetic' : 'Likely genuine');
    deepfakeVerdict.classList.toggle('is-synthetic', !live && isSynthetic);
    deepfakeVerdict.classList.toggle('is-genuine', !live && !isSynthetic);

    resultBlock.classList.remove('d-none');
  }

  analyzeBtn.addEventListener('click', async () => {
    console.log('Sending file to API for deepfake detection...');
    if (!currentFile) {
      console.error('No file selected for analysis.');
      return;
    }
    const requestId = ++currentRequestId;
    activeAbortController = new AbortController();

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
      if (requestId !== currentRequestId) return;
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
      if (requestId !== currentRequestId) return;
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
          'X-Confidential-Check': confidentialCheck.checked ? 'true' : 'false',
          Authorization: `Bearer ${idToken}`,
        },
        body: fileToUpload,
        signal: activeAbortController.signal,
      });

      if (requestId !== currentRequestId) return;

      console.log('API response status:', response.status, response.statusText);

      // Anything that fails before the detector even starts (auth, rate
      // limit, quota, bad upload) still comes back as a normal JSON error
      // response with a real HTTP status — only once that's cleared does
      // the server switch to streaming progress events.
      if (!response.ok) {
        const data = await parseJsonResponse(response);
        throw new Error(data.error || 'Detection failed.');
      }

      let finalResult = null;
      let streamError = null;

      await readNdjsonStream(response, (event) => {
        if (requestId !== currentRequestId) return;
        if (event.type === 'info') {
          if (Number.isFinite(event.estimated_duration_sec)) {
            setMessage(`Analyzing… estimated audio length ${event.estimated_duration_sec.toFixed(0)}s.`);
          }
          return;
        }

        if (event.type === 'progress') {
          const processed = Math.max(0, Math.min(100, event.percent_processed));
          // The detector reports its own 0–100% completion; map that onto
          // the remaining slice of the bar (upload/convert already used
          // the first part) so the bar keeps moving smoothly to 100%.
          progressBar.style.width = `${35 + processed * 0.6}%`;
          setMessage(
            `Analyzing… ${processed.toFixed(1)}% processed (t=${event.elapsed_sec.toFixed(0)}s) — `
            + `instantaneous ${event.instant_percent.toFixed(1)}%, running average ${event.average_percent.toFixed(1)}%`,
          );
          renderResult(event.average_percent, 50, { live: true });

          if (graphBlock && graphBlock.classList.contains('d-none')) {
            graphBlock.classList.remove('d-none');
            if (deepfakeGraph) deepfakeGraph.resize();
          }
          if (deepfakeGraph) deepfakeGraph.addPoint(event.elapsed_sec, event.instant_percent, event.average_percent);
          return;
        }

        if (event.type === 'result') {
          finalResult = event;
          return;
        }

        if (event.type === 'error') {
          streamError = event.error || 'Detection failed.';
        }
      });

      if (requestId !== currentRequestId) return;

      if (streamError) {
        throw new Error(streamError);
      }
      if (!finalResult) {
        throw new Error('The detector stopped responding before finishing.');
      }

      progressBar.style.width = '100%';
      setStatus(statusBadge, 'done');
      setMessage('Analysis complete.');

      const percent = Number(finalResult.deepfake_percent);
      const threshold = Number.isFinite(Number(finalResult.threshold_percent)) ? Number(finalResult.threshold_percent) : 50;
      if (deepfakeGraph) deepfakeGraph.setThreshold(threshold);
      renderResult(Number.isFinite(percent) ? percent : 0, threshold);
      resetBtn.classList.remove('d-none');
      analyzeBtn.textContent = 'Analyzed';
      // display hubspot satisfaction survey after analysis
      document.getElementById('survey-container').style.display = 'block';
    } catch (error) {
      if (requestId !== currentRequestId) return;
      console.error(error);
      setMessage(error.message || 'Detection failed.', true);
      setStatus(statusBadge, 'idle');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Run detection';
    }
  });

  function resetAll() {
    currentRequestId++;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
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

    originalAudio.pause();
    originalAudio.removeAttribute('src');
    originalAudio.load();
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
