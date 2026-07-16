import { getAudioContext, getAnalysisSourceNode } from './noise-filter-audio-graph.js';

export function createSpectrogramController({ originalSpectrogramEl, resultSpectrogramEl, originalAudio, resultAudio }) {
  const WINDOW_SECONDS = 8;
  const FRAME_RATE = 24;
  const MAX_HISTORY = WINDOW_SECONDS * FRAME_RATE;
  const CANVAS_HEIGHT = 180;

  const views = {
    original: { containerEl: originalSpectrogramEl, mediaEl: originalAudio, canvas: null, ctx: null, history: [], rafId: null },
    result: { containerEl: resultSpectrogramEl, mediaEl: resultAudio, canvas: null, ctx: null, history: [], rafId: null },
  };

  let audioCtx = null;

  function ensureAudioContext() {
    if (audioCtx) return audioCtx;
    audioCtx = getAudioContext();
    return audioCtx;
  }

  function createView(key) {
    const view = views[key];
    if (!view || !view.containerEl) return null;

    view.containerEl.innerHTML = '';
    view.containerEl.style.overflow = 'hidden';
    view.containerEl.style.background = '#05070e';
    view.containerEl.style.borderRadius = '12px';

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    canvas.style.display = 'block';
    view.containerEl.appendChild(canvas);

    view.canvas = canvas;
    view.ctx = canvas.getContext('2d');
    resizeCanvas(view);
    paintEmpty(view);
    return view;
  }

  function resizeCanvas(view) {
    if (!view || !view.canvas) return;

    const rect = view.containerEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    view.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    view.canvas.height = Math.max(1, Math.round(CANVAS_HEIGHT * dpr));
    view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintEmpty(view) {
    if (!view || !view.ctx || !view.canvas) return;

    const width = view.canvas.clientWidth || view.containerEl.clientWidth || 600;
    const height = view.canvas.clientHeight || CANVAS_HEIGHT;

    view.ctx.clearRect(0, 0, width, height);
    view.ctx.fillStyle = '#05070e';
    view.ctx.fillRect(0, 0, width, height);
    view.ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    view.ctx.lineWidth = 1;

    for (let i = 0; i <= 6; i += 1) {
      const y = (height / 6) * i;
      view.ctx.beginPath();
      view.ctx.moveTo(0, y);
      view.ctx.lineTo(width, y);
      view.ctx.stroke();
    }

    view.ctx.fillStyle = 'rgba(255,255,255,0.65)';
    view.ctx.font = '12px Inter, sans-serif';
    view.ctx.fillText('Waiting for audio…', 12, height - 18);
  }

  function colorForAmplitude(value) {
    const normalized = Math.max(0, Math.min(1, value));
    const hue = 250 - normalized * 220;
    const saturation = 85;
    const lightness = 35 + normalized * 25;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function drawSpectrogram(view) {
    if (!view || !view.ctx || !view.canvas) return;

    const width = view.canvas.clientWidth || view.containerEl.clientWidth || 600;
    const height = view.canvas.clientHeight || CANVAS_HEIGHT;
    const step = width / MAX_HISTORY;

    view.ctx.clearRect(0, 0, width, height);
    view.ctx.fillStyle = '#05070e';
    view.ctx.fillRect(0, 0, width, height);

    if (view.history.length === 0) {
      paintEmpty(view);
      return;
    }

    const binCount = 64;
    const binHeight = height / binCount;
    const columnWidth = Math.max(1, step * 0.95);

    view.history.forEach((frame, index) => {
      const x = index * step;
      for (let bin = 0; bin < binCount; bin += 1) {
        const amplitude = frame[bin] / 255;
        const y = height - (bin + 1) * binHeight;
        if (amplitude <= 0.01) continue;
        view.ctx.fillStyle = colorForAmplitude(amplitude);
        view.ctx.fillRect(x, y, columnWidth, binHeight + 1);
      }
    });
  }

  function ensureAnalyser(view) {
    if (!view) return null;

    if (!view.analyser) {
      const ctx = ensureAudioContext();
      if (!ctx) return null;

      view.analyser = ctx.createAnalyser();
      view.analyser.fftSize = 1024;
      view.analyser.smoothingTimeConstant = 0.01;
      view.mediaSourceNode = getAnalysisSourceNode(view.mediaEl);
      if (!view.mediaSourceNode) return null;
      view.mediaSourceNode.connect(view.analyser);
      if (ctx.state === 'suspended') ctx.resume();
    }

    return view.analyser;
  }

  function tick(view) {
    if (!view || !view.mediaEl || !view.ctx) return;

    const analyser = ensureAnalyser(view);
    if (analyser) {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      const frame = Array.from(dataArray.slice(0, 64));
      view.history.push(frame);
      if (view.history.length > MAX_HISTORY) view.history.shift();
      drawSpectrogram(view);
    }

    if (!view.mediaEl.paused && !view.mediaEl.ended) {
      view.rafId = window.requestAnimationFrame(() => tick(view));
    } else {
      view.rafId = null;
    }
  }

  // Like the level graph, tick() intentionally stops scheduling itself once
  // the element is paused. Without this, resuming playback via the native
  // controls (rather than the compare button) left the drawing frozen on
  // the last frame, since nothing else ever called tick() again.
  function resumeIfPlaying(view) {
    if (!view || !view.ctx || view.rafId) return;
    if (view.mediaEl && !view.mediaEl.paused && !view.mediaEl.ended) {
      view.rafId = window.requestAnimationFrame(() => tick(view));
    }
  }

  views.original.mediaEl.addEventListener('play', () => resumeIfPlaying(views.original));
  views.result.mediaEl.addEventListener('play', () => resumeIfPlaying(views.result));

  function start(target = null) {
    console.log('Starting spectrogram controller...');
    const viewsToStart = target
      ? [target]
      : [views.original, views.result];

    viewsToStart.forEach((preparedView) => {
      if (!preparedView) return;

      const view = preparedView === views.original || preparedView === views.result
        ? preparedView
        : createView(preparedView === 'original' ? 'original' : 'result');

      if (!view || !view.containerEl) return;

      resizeCanvas(view);
      if (view.rafId) {
        window.cancelAnimationFrame(view.rafId);
        view.rafId = null;
      }

      view.history = [];
      drawSpectrogram(view);
      if (view.mediaEl && view.mediaEl.currentSrc) {
        view.rafId = window.requestAnimationFrame(() => tick(view));
      }
    });
  }

  function stop() {
    Object.values(views).forEach((view) => {
      if (view.rafId) {
        window.cancelAnimationFrame(view.rafId);
        view.rafId = null;
      }
    });
  }

  function refreshOriginal() {
    const view = createView('original');
    view.history = [];
    paintEmpty(view);
    if (view.mediaEl && view.mediaEl.currentSrc) {
      start(view);
    }
  }

  function refreshResult() {
    const view = createView('result');
    view.history = [];
    paintEmpty(view);
    if (view.mediaEl && view.mediaEl.currentSrc) {
      start(view);
    }
  }

  function reset() {
    Object.values(views).forEach((view) => {
      if (view.rafId) {
        window.cancelAnimationFrame(view.rafId);
        view.rafId = null;
      }
      view.history = [];
      if (view.canvas) {
        paintEmpty(view);
      }
    });
  }

  window.addEventListener('resize', () => {
    Object.values(views).forEach((view) => {
      if (view.canvas) {
        resizeCanvas(view);
        drawSpectrogram(view);
      }
    });
  });

  return {
    start,
    stop,
    refreshOriginal,
    refreshResult,
    reset,
  };
}