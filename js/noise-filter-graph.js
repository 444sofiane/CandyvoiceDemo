import { getAudioContext, getAnalysisSourceNode } from './noise-filter-audio-graph.js';

export function createLevelGraph({ levelCanvas, originalAudio, resultAudio, setMessage }) {
  const ctx2d = levelCanvas.getContext('2d');
  let audioCtx = null;
  let inAnalyser = null;
  let outAnalyser = null;
  let inSourceNode = null;
  let outSourceNode = null;
  let rafId = null;

  const HISTORY = 220;
  const inLevels = new Array(HISTORY).fill(0);
  const outLevels = new Array(HISTORY).fill(0);
  let lastIn = 0;
  let lastOut = 0;

  function resizeCanvas() {
    const rect = levelCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    levelCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    levelCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let inBuf = null;
  let outBuf = null;

  function ensureGraph() {
    if (audioCtx) return;
    audioCtx = getAudioContext();
    if (!audioCtx) return;

    inAnalyser = audioCtx.createAnalyser();
    inAnalyser.fftSize = 1024;
    inSourceNode = getAnalysisSourceNode(originalAudio);
    inSourceNode.connect(inAnalyser);

    outAnalyser = audioCtx.createAnalyser();
    outAnalyser.fftSize = 1024;
    outSourceNode = getAnalysisSourceNode(resultAudio);
    outSourceNode.connect(outAnalyser);

    inBuf = new Uint8Array(inAnalyser.fftSize);
    outBuf = new Uint8Array(outAnalyser.fftSize);
  }

  function peakLevel(analyser, buffer) {
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = Math.abs(buffer[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  function draw() {
    const w = levelCanvas.clientWidth;
    const h = levelCanvas.clientHeight;

    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, w, h);

    ctx2d.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx2d.lineWidth = 1;
    const vLines = 8;
    for (let i = 0; i <= vLines; i += 1) {
      const x = (w / vLines) * i;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, h);
      ctx2d.stroke();
    }
    // Reference lines at 25/50/75/100% of the 0–1 range, measured from the bottom.
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const y = h - h * f;
      ctx2d.beginPath();
      ctx2d.moveTo(0, y);
      ctx2d.lineTo(w, y);
      ctx2d.stroke();
    });

    const stepX = w / (HISTORY - 1);

    // Values are always 0–1 (peakLevel takes an absolute value), so plot
    // straight off the bottom edge instead of around a vertical center —
    // 0 sits on the floor, 1 reaches the top.
    ctx2d.strokeStyle = '#ff2b2b';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    inLevels.forEach((v, i) => {
      const x = i * stepX;
      const y = h - v * h;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();

    ctx2d.strokeStyle = '#26e0ff';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    outLevels.forEach((v, i) => {
      const x = i * stepX;
      const y = h - v * h;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();

    // Both labels moved to the top: with 0 now resting at the bottom edge,
    // a bottom-anchored label would sit right on top of a near-silent trace.
    ctx2d.font = '600 13px Inter, sans-serif';
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = 'right';
    ctx2d.fillStyle = '#ff2b2b';
    ctx2d.fillText(`Niveau In: ${lastIn.toFixed(3)}`, w - 8, 6);
    ctx2d.fillStyle = '#26e0ff';
    ctx2d.fillText(`Niveau Out: ${lastOut.toFixed(3)}`, w - 8, 24);
  }

  function tick() {
    lastIn = peakLevel(inAnalyser, inBuf);
    lastOut = peakLevel(outAnalyser, outBuf);

    inLevels.shift();
    inLevels.push(lastIn);
    outLevels.shift();
    outLevels.push(lastOut);

    draw();

    if (!originalAudio.paused || !resultAudio.paused) {
      rafId = window.requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }

  // Pausing stops the animation loop (so it's not running for nothing while
  // idle), but nothing was restarting it when playback resumed unless the
  // user explicitly re-clicked "Play & compare levels" — a plain pause/play
  // on the native controls left the graph frozen. This re-arms the loop
  // any time either track starts playing again, if it isn't already running.
  function resumeTickIfNeeded() {
    if (!audioCtx || rafId) return;
    if (!originalAudio.paused || !resultAudio.paused) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  originalAudio.addEventListener('play', resumeTickIfNeeded);
  resultAudio.addEventListener('play', resumeTickIfNeeded);

  function start() {
    ensureGraph();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    resizeCanvas();

    originalAudio.currentTime = 0;
    resultAudio.currentTime = 0;

    const playPromises = [originalAudio.play()];
    if (resultAudio.src) playPromises.push(resultAudio.play());

    Promise.all(playPromises).catch((err) => {
      setMessage(err.message || 'Could not start playback.', true);
    }).finally(() => {
      resumeTickIfNeeded();
    });
  }

  function stop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    originalAudio.pause();
    resultAudio.pause();
  }

  function reset() {
    stop();
    inLevels.fill(0);
    outLevels.fill(0);
    lastIn = 0;
    lastOut = 0;
    if (audioCtx) {
      resizeCanvas();
      draw();
    }
  }

  window.addEventListener('resize', () => {
    if (audioCtx) {
      resizeCanvas();
      draw();
    }
  });

  return { start, stop, reset };
}
