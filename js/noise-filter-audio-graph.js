let sharedAudioCtx = null;
const sourceNodesByElement = new WeakMap();

export function getAudioContext() {
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.error('Web Audio API is not supported in this browser.');
      return null;
    }
    sharedAudioCtx = new AudioContextClass();
  }
  return sharedAudioCtx;
}

export function getMediaSourceNode(mediaEl) {
  const ctx = getAudioContext();
  if (!ctx || !mediaEl) return null;

  if (!sourceNodesByElement.has(mediaEl)) {
    const source = ctx.createMediaElementSource(mediaEl);
    source.connect(ctx.destination);
    sourceNodesByElement.set(mediaEl, source);
  }

  return sourceNodesByElement.get(mediaEl);
}

const analysisSourcesByElement = new WeakMap();

function createShadowElement(mediaEl) {
  const shadow = document.createElement('audio');
  shadow.crossOrigin = mediaEl.crossOrigin || 'anonymous';
  shadow.preload = 'auto';
  shadow.muted = false;
  shadow.volume = 1;
  shadow.style.display = 'none';
  document.body.appendChild(shadow);
  return shadow;
}

function syncShadowElement(mediaEl, shadow) {
  const DRIFT_TOLERANCE = 0.15; // seconds

  const syncSrc = () => {
    const src = mediaEl.currentSrc || mediaEl.src;
    if (!src || shadow.src === src) return;
    shadow.src = src;
    shadow.load();
    if (!mediaEl.paused) {
      const resumeAtCurrentTime = () => {
        shadow.currentTime = mediaEl.currentTime;
        shadow.play().catch(() => {});
      };
      if (shadow.readyState >= 1) resumeAtCurrentTime();
      else shadow.addEventListener('loadedmetadata', resumeAtCurrentTime, { once: true });
    }
  };

  syncSrc();
  mediaEl.addEventListener('loadedmetadata', syncSrc);
  mediaEl.addEventListener('emptied', syncSrc);

  mediaEl.addEventListener('play', () => {
    syncSrc();
    if (Math.abs(shadow.currentTime - mediaEl.currentTime) > DRIFT_TOLERANCE) {
      shadow.currentTime = mediaEl.currentTime;
    }
    shadow.play().catch(() => {});
  });

  mediaEl.addEventListener('pause', () => shadow.pause());

  mediaEl.addEventListener('seeking', () => {
    if (Math.abs(shadow.currentTime - mediaEl.currentTime) > DRIFT_TOLERANCE) {
      shadow.currentTime = mediaEl.currentTime;
    }
  });

  mediaEl.addEventListener('timeupdate', () => {
    if (!mediaEl.paused && Math.abs(shadow.currentTime - mediaEl.currentTime) > DRIFT_TOLERANCE) {
      shadow.currentTime = mediaEl.currentTime;
    }
  });
}

export function getAnalysisSourceNode(mediaEl) {
  const ctx = getAudioContext();
  if (!ctx || !mediaEl) return null;

  if (!analysisSourcesByElement.has(mediaEl)) {
    const shadow = createShadowElement(mediaEl);
    const source = ctx.createMediaElementSource(shadow);

    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(silentGain);
    silentGain.connect(ctx.destination);

    syncShadowElement(mediaEl, shadow);

    analysisSourcesByElement.set(mediaEl, source);
  }

  return analysisSourcesByElement.get(mediaEl);
}
