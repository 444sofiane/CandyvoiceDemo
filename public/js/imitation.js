import {
  formatSize,
  buildApiUrl,
  resolveApiUrl,
  parseJsonResponse,
  setMessageText,
  setStatusBadge,
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
import { createSpectrogramController } from './noise-filter-spectrogram.js';

// Keep this list in sync with ALLOWED_VOICE_MODELS in api_server.py — the
// `folder` value is sent to the API as-is and must match a real folder
// name under .\imitation\Model\ on the processing machine. The server
// re-validates this against its own allow-list regardless, so a stale or
// tampered value here can never reach the shell command directly.
const VOICE_MODELS = [
  { folder: 'model_barack', label: 'Barack', image: 'image/Barack.png' },
  { folder: 'model_chloe', label: 'Chloe', image: 'image/Chloe.png' },
  { folder: 'model_cortana', label: 'Cortana', image: 'image/Cortana.png' },
  { folder: 'model_degaulle', label: 'de Gaulle', image: 'image/deGaulle.png' },
  { folder: 'model_dombasle', label: 'Dombasle', image: 'image/dombasle.png' },
  { folder: 'model_etienne', label: 'Etienne', image: 'image/etienne.png' },
  { folder: 'model_frederic', label: 'Frederic', image: 'image/frederic.png' },
  { folder: 'model_isabelle', label: 'Isabelle', image: 'image/Isabelle.png' },
  { folder: 'model_jeanne', label: 'Jeanne', image: 'image/Jeanne.png' },
  { folder: 'model_JLS', label: 'JLS', image: 'image/JLS.png' },
  { folder: 'model_marine', label: 'Marine', image: 'image/marine.png' },
  { folder: 'model_mbappe', label: 'Mbappe', image: 'image/Mbappe.png' },
  { folder: 'model_michelleo', label: 'Michelleo', image: 'image/Michelleo.png' },
  { folder: 'model_mitterrand', label: 'Mitterrand', image: 'image/Mitterrand.png' },
  { folder: 'model_pierre', label: 'Pierre', image: 'image/Pierre.png' },
  { folder: 'model_tatiana', label: 'Tatiana', image: 'image/Tatiana.png' },
  { folder: 'model_trump', label: 'Trump', image: 'image/Trump.png' },
  { folder: 'model_valentin', label: 'Valentin', image: 'image/Valentin.png' },
];

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
  console.log('imitation.js loaded');

  const voiceStep = document.getElementById('voiceStep');
  const voiceGrid = document.getElementById('voiceGrid');
  const uploadStep = document.getElementById('uploadStep');
  const workStep = document.getElementById('workStep');

  const selectedVoiceBanner = document.getElementById('selectedVoiceBanner');
  const selectedVoiceImg = document.getElementById('selectedVoiceImg');
  const selectedVoiceName = document.getElementById('selectedVoiceName');
  const changeVoiceBtn = document.getElementById('changeVoiceBtn');

  const selectedVoiceImgWork = document.getElementById('selectedVoiceImgWork');
  const selectedVoiceNameWork = document.getElementById('selectedVoiceNameWork');
  const changeVoiceBtnWork = document.getElementById('changeVoiceBtnWork');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  const fileName = document.getElementById('fileName');
  const fileMeta = document.getElementById('fileMeta');
  const statusBadge = document.getElementById('statusBadge');
  const progressBar = document.getElementById('progressBar');
  const messageBox = document.getElementById('messageBox');

  const originalPreview = document.getElementById('originalPreview');
  const originalAudio = document.getElementById('originalAudio');
  const resultBlock = document.getElementById('resultBlock');
  const resultAudio = document.getElementById('resultAudio');

  // Without this, the browser can taint the media element's audio graph
  // once an AnalyserNode is attached, and getByteFrequencyData() silently
  // returns all-zero/flat data — audio still plays fine, but the
  // spectrogram shows garbage values. Matches noisefilter.js.
  originalAudio.crossOrigin = 'anonymous';
  resultAudio.crossOrigin = 'anonymous';

  const spectrogramBlock = document.getElementById('spectrogramBlock');
  const originalSpectrogramEl = document.getElementById('originalSpectrogram');
  const resultSpectrogramEl = document.getElementById('resultSpectrogram');
  const compareBtn = document.getElementById('compareBtn');

  const imitateBtn = document.getElementById('imitateBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const removeBtn = document.getElementById('removeBtn');

  let selectedVoice = null; // { folder, label, image }
  let currentObjectUrl = null;
  let currentFile = null;
  let comparePlaying = false; // for spectrogram compare button

  // Cancellation: requestId guards against a stale in-flight request's
  // response landing after the user has moved on (reset/remove/another
  // upload), and activeAbortController lets us actually cut the network
  // request short instead of just ignoring its eventual result. Same
  // pattern as deepfake.js's analyzeBtn flow.
  let currentRequestId = 0;
  let activeAbortController = null;

  const apiUrl = buildApiUrl({
    search: window.location.search,
    bodyDataset: document.body.dataset,
    protocol: window.location.protocol,
    port: window.location.port,
    endpointPath: '/api/imitation',
  });

  const spectrogramController = createSpectrogramController({
    originalSpectrogramEl,
    resultSpectrogramEl,
    originalAudio,
    resultAudio,
  });

  // ---- Original/result playback sync --------------------------------
  // Mirrors noisefilter.js's setupAudioSync: pressing play/pause/seek on
  // either the original or the imitated result drives the other in
  // lockstep, so the two spectrogram panels (which each re-arm on their
  // own media element's 'play'/'pause' events) stay synced to actual
  // playback progress too — not just to the manual compare button.
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

  // Compare button — same pattern as noisefilter.js's compareBtn, but
  // driving spectrogramController instead of a level graph.
  if (compareBtn) {
    compareBtn.addEventListener('click', () => {
      if (!spectrogramController) {
        console.error('Spectrogram controller is not initialized.');
        return;
      }

      if (comparePlaying) {
        spectrogramController.stop();
        originalAudio.pause();
        resultAudio.pause();
        compareBtn.textContent = 'Play & compare spectrograms';
        comparePlaying = false;
      } else {
        // Always start the comparison from the top, regardless of wherever
        // the user last scrubbed either player to.
        originalAudio.currentTime = 0;
        resultAudio.currentTime = 0;
        spectrogramController.start();
        originalAudio.play().catch(() => {});
        if (hasUsableSrc(resultAudio)) resultAudio.play().catch(() => {});
        compareBtn.textContent = 'Stop comparison';
        comparePlaying = true;
      }
    });

    [originalAudio, resultAudio].forEach((el) => {
      el.addEventListener('ended', () => {
        if (originalAudio.ended && resultAudio.ended) {
          compareBtn.textContent = 'Play & compare spectrograms';
          comparePlaying = false;
        }
      });
    });
  }

  function setMessage(message, isError = false) {
    setMessageText(messageBox, message, isError);
  }

  function setStatus(state) {
    setStatusBadge(statusBadge, state);
  }

  // ---- Voice picker -------------------------------------------------

  function renderVoiceGrid() {
    voiceGrid.innerHTML = '';
    VOICE_MODELS.forEach((voice) => {
      const card = document.createElement('div');
      card.className = 'cv-voice-card';
      card.setAttribute('role', 'option');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-selected', 'false');
      card.dataset.folder = voice.folder;

      card.innerHTML = `
        <div class="cv-voice-avatar">
          <img src="${voice.image}" alt="${voice.label}" loading="lazy">
        </div>
        <span class="cv-voice-name">${voice.label}</span>
        <span class="cv-voice-check">&check;</span>
      `;

      card.addEventListener('click', () => selectVoice(voice));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectVoice(voice);
        }
      });

      voiceGrid.appendChild(card);
    });
  }

  function selectVoice(voice) {
    selectedVoice = voice;

    Array.from(voiceGrid.children).forEach((card) => {
      const isSelected = card.dataset.folder === voice.folder;
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-selected', String(isSelected));
    });

    selectedVoiceImg.src = voice.image;
    selectedVoiceImg.alt = voice.label;
    selectedVoiceName.textContent = voice.label;

    selectedVoiceImgWork.src = voice.image;
    selectedVoiceImgWork.alt = voice.label;
    selectedVoiceNameWork.textContent = voice.label;

    voiceStep.classList.add('d-none');
    uploadStep.classList.remove('d-none');
  }

  function backToVoicePicker() {
    voiceStep.classList.remove('d-none');
    uploadStep.classList.add('d-none');
    workStep.classList.add('d-none');

    // Cancel any in-flight imitation request — the user is bailing out of
    // this file entirely, so there's no reason to let it keep running.
    currentRequestId++;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    // Stop spectrogram to save resources and hide it
    if (spectrogramController) {
      spectrogramController.stop();
    }
    originalAudio.pause();
    resultAudio.pause();
    if (compareBtn) compareBtn.textContent = 'Play & compare spectrograms';
    comparePlaying = false;
    spectrogramBlock.classList.add('d-none');
  }

  changeVoiceBtn.addEventListener('click', backToVoicePicker);
  changeVoiceBtnWork.addEventListener('click', backToVoicePicker);

  renderVoiceGrid();

  // ---- Upload ---------------------------------------------------------

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
      imitateBtn.disabled = true;
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

    // Spectrogram: reset and pre-render the original view, but keep the
    // block itself hidden until imitation actually succeeds (matches
    // noisefilter.js — no spectrogram before there's a result to compare).
    spectrogramBlock.classList.add('d-none');
    spectrogramController.reset();
    spectrogramController.refreshOriginal();

    resultAudio.removeAttribute('src');
    resultBlock.classList.add('d-none');
    downloadBtn.classList.add('d-none');
    resetBtn.classList.add('d-none');
    progressBar.style.width = '0%';
    setMessage('');

    setStatus('idle');
    imitateBtn.disabled = false;
    imitateBtn.textContent = 'Apply Voice Imitation';

    uploadStep.classList.add('d-none');
    workStep.classList.remove('d-none');

    applyQuotaGate();
  }

  imitateBtn.addEventListener('click', async () => {
    console.log('Sending file to API for voice imitation...');
    if (!currentFile) {
      console.error('No file selected for imitation.');
      return;
    }
    if (!selectedVoice) {
      console.error('No voice model selected.');
      backToVoicePicker();
      return;
    }

    const requestId = ++currentRequestId;
    activeAbortController = new AbortController();

    const minutesNeeded = await getAudioDurationMinutes(originalAudio);
    if (requestId !== currentRequestId) return;

    if (auth.currentUser && !hasQuotaFor(auth.currentUser.uid, minutesNeeded)) {
      const remaining = getRemainingMinutes(auth.currentUser.uid);
      setMessage(
        `This file is about ${minutesNeeded.toFixed(1)} min, but you only have ${remaining.toFixed(1)} of ${USAGE_QUOTA_MINUTES.toFixed(0)} min left in your quota. Try a shorter file.`,
        true,
      );
      return;
    }

    imitateBtn.disabled = true;
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
      if (requestId !== currentRequestId) return;
    } catch (error) {
      if (requestId !== currentRequestId) return;
      console.error(error);
      setMessage(error.message || 'Could not convert this file.', true);
      setStatus('idle');
      imitateBtn.disabled = false;
      imitateBtn.textContent = 'Apply Voice Imitation';
      return;
    }

    if (!auth.currentUser) {
      setMessage('Your session has expired — please sign in again.', true);
      setStatus('idle');
      imitateBtn.disabled = false;
      imitateBtn.textContent = 'Apply Voice Imitation';
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
      if (requestId !== currentRequestId) return;
      console.error('Failed to get ID token:', error);
      setMessage('Could not verify your session. Please sign in again.', true);
      setStatus('idle');
      imitateBtn.disabled = false;
      imitateBtn.textContent = 'Apply Voice Imitation';
      return;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': fileToUpload.name,
          'X-Output-Name': fileToUpload.name.replace(/\.[^.]+$/u, '_imitated.wav'),
          'X-Voice-Model': selectedVoice.folder,
          Authorization: `Bearer ${idToken}`,
        },
        body: fileToUpload,
        signal: activeAbortController.signal,
      });
      if (requestId !== currentRequestId) return;

      console.log('API response status:', response.status, response.statusText);
      const data = await parseJsonResponse(response);
      if (requestId !== currentRequestId) return;

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
        downloadBtn.setAttribute('download', `imitated-${fileToUpload.name}`);
        downloadBtn.classList.remove('d-none');
        resetBtn.classList.remove('d-none');

        // Show and initialize spectrogram — only now, once there's an
        // actual result to compare against the original.
        spectrogramBlock.classList.remove('d-none');
        spectrogramController.refreshResult();
      }

      imitateBtn.textContent = 'Imitated';
    } catch (error) {
      if (requestId !== currentRequestId) return;
      console.error(error);
      setMessage(error.message || 'Processing failed.', true);
      setStatus('idle');
      imitateBtn.disabled = false;
      imitateBtn.textContent = 'Apply Voice Imitation';
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

    resultAudio.removeAttribute('src');
    resultBlock.classList.add('d-none');
    downloadBtn.classList.add('d-none');
    resetBtn.classList.add('d-none');

    originalAudio.removeAttribute('src');
    originalPreview.classList.add('d-none');

    // Reset spectrogram
    spectrogramController.reset();
    spectrogramBlock.classList.add('d-none');
    compareBtn.textContent = 'Play & compare spectrograms';
    comparePlaying = false;

    imitateBtn.textContent = 'Apply Voice Imitation';
    setStatus('idle');
  }

  resetBtn.addEventListener('click', resetAll);
  removeBtn.addEventListener('click', resetAll);
});
