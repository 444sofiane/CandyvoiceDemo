/**
 * Draws a live line chart of the deepfake detector's score over time:
 * red = instantaneous score for the current frame, purple = the running
 * average across the whole file so far. Fed one point per "progress" event
 * from the streaming API response — same canvas-drawing approach as
 * noise-filter-graph.js on the NoizeOff page.
 *
 * Once analysis is done, the same chart can also track audio playback:
 * setPlayhead(t) draws a marker at time `t` (seconds) so a user scrubbing
 * or playing the original file can see which point on the curve matches
 * what they're hearing. timeForClientX() does the inverse — turning a click
 * on the canvas into a time — so the caller can seek the audio to match.
 */
export function createDeepfakeGraph({ canvas, thresholdPercent = 50 }) {
  const ctx2d = canvas.getContext('2d');

  const points = []; // { t, instant, average }
  let threshold = thresholdPercent;
  let playheadTime = null; // seconds; null when not synced to playback

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round((rect.height || 180) * dpr));
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintEmpty() {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 180;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = '#05070e';
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = 'rgba(255,255,255,0.65)';
    ctx2d.font = '12px Inter, sans-serif';
    ctx2d.fillText('Waiting for analysis…', 12, h - 18);
  }

  function currentMaxT() {
    return points.length ? Math.max(points[points.length - 1].t, 1) : 1;
  }

  /** Public: convert a clientX (from a click/mousemove on the canvas) into
   * the corresponding elapsed-time in seconds, so the caller can seek an
   * <audio> element to match where the user clicked on the chart. */
  function timeForClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth || 600;
    const x = clientX - rect.left;
    const maxT = currentMaxT();
    return Math.max(0, Math.min(maxT, (x / w) * maxT));
  }

  /** Linear-interpolates instant/average at an arbitrary time between the
   * two nearest recorded points, so a playhead readout stays smooth even
   * though progress events only arrive a few times per second. */
  function valueAtTime(t) {
    if (!points.length) return null;
    if (t <= points[0].t) return points[0];
    if (t >= points[points.length - 1].t) return points[points.length - 1];

    for (let i = 1; i < points.length; i += 1) {
      if (points[i].t >= t) {
        const prev = points[i - 1];
        const next = points[i];
        const span = next.t - prev.t;
        const ratio = span > 0 ? (t - prev.t) / span : 0;
        return {
          instant: prev.instant + (next.instant - prev.instant) * ratio,
          average: prev.average + (next.average - prev.average) * ratio,
        };
      }
    }
    return points[points.length - 1];
  }

  function draw() {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 180;

    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = '#05070e';
    ctx2d.fillRect(0, 0, w, h);

    // Gridlines at 0/25/50/75/100%
    ctx2d.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx2d.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const y = h - h * f;
      ctx2d.beginPath();
      ctx2d.moveTo(0, y);
      ctx2d.lineTo(w, y);
      ctx2d.stroke();
    });

    if (points.length === 0) {
      paintEmpty();
      return;
    }

    const maxT = currentMaxT();
    const xFor = (t) => (t / maxT) * w;
    const yFor = (pct) => h - (Math.max(0, Math.min(100, pct)) / 100) * h;

    // Shade the zones where the running average crosses the "likely
    // synthetic" threshold, so someone listening along sees at a glance
    // which parts of the track were flagged, not just the raw line.
    ctx2d.fillStyle = 'rgba(224, 67, 92, 0.18)';
    let bandStartX = null;
    points.forEach((p, i) => {
      const flagged = p.average >= threshold;
      const x = xFor(p.t);
      if (flagged && bandStartX === null) {
        bandStartX = x;
      } else if (!flagged && bandStartX !== null) {
        ctx2d.fillRect(bandStartX, 0, x - bandStartX, h);
        bandStartX = null;
      }
      if (flagged && i === points.length - 1 && bandStartX !== null) {
        ctx2d.fillRect(bandStartX, 0, x - bandStartX, h);
      }
    });

    function drawLine(key, color) {
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      points.forEach((p, i) => {
        const x = xFor(p.t);
        const y = yFor(p[key]);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      });
      ctx2d.stroke();
    }

    drawLine('instant', '#ff2b2b');
    drawLine('average', '#b18aff');

    // Playhead — synced to the original audio element's currentTime when
    // the user plays back the file (see setPlayhead), so they can see which
    // point on the curve corresponds to what they're currently hearing.
    if (playheadTime !== null) {
      const x = xFor(Math.min(playheadTime, maxT));
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, h);
      ctx2d.stroke();

      ctx2d.fillStyle = '#ffffff';
      ctx2d.beginPath();
      ctx2d.arc(x, 6, 4, 0, Math.PI * 2);
      ctx2d.fill();
    }

    const last = points[points.length - 1];
    ctx2d.font = '600 13px Inter, sans-serif';
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = 'right';
    ctx2d.fillStyle = '#ff2b2b';
    ctx2d.fillText(`Instantaneous: ${last.instant.toFixed(1)}%`, w - 8, 6);
    ctx2d.fillStyle = '#b18aff';
    ctx2d.fillText(`Average: ${last.average.toFixed(1)}%`, w - 8, 24);

    if (playheadTime !== null) {
      const atPlayhead = valueAtTime(playheadTime);
      if (atPlayhead) {
        ctx2d.fillStyle = '#ffffff';
        ctx2d.textAlign = 'left';
        ctx2d.fillText(`At playhead: ${atPlayhead.instant.toFixed(1)}%`, 8, 6);
      }
    }
  }

  function addPoint(t, instant, average) {
    points.push({ t, instant, average });
    draw();
  }

  function setThreshold(pct) {
    if (Number.isFinite(pct)) threshold = pct;
    draw();
  }

  function setPlayhead(t) {
    playheadTime = Number.isFinite(t) ? t : null;
    draw();
  }

  function clearPlayhead() {
    playheadTime = null;
    draw();
  }

  function reset() {
    points.length = 0;
    playheadTime = null;
    resizeCanvas();
    paintEmpty();
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
    draw();
  });

  resizeCanvas();
  paintEmpty();

  function resize() {
    resizeCanvas();
    draw();
  }

  return {
    addPoint,
    reset,
    resize,
    setThreshold,
    setPlayhead,
    clearPlayhead,
    timeForClientX,
    valueAtTime,
  };
}