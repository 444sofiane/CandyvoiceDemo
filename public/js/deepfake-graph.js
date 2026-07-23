/**
 * Draws a live line chart of the deepfake detector's score over time:
 * red = instantaneous score for the current frame, purple = the running
 * average across the whole file so far. Fed one point per "progress" event
 * from the streaming API response — same canvas-drawing approach as
 * noise-filter-graph.js on the NoizeOff page.
 */
export function createDeepfakeGraph({ canvas }) {
  const ctx2d = canvas.getContext('2d');

  const points = []; // { t, instant, average }

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

    const maxT = Math.max(points[points.length - 1].t, 1);
    const xFor = (t) => (t / maxT) * w;
    const yFor = (pct) => h - (Math.max(0, Math.min(100, pct)) / 100) * h;

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

    const last = points[points.length - 1];
    ctx2d.font = '600 13px Inter, sans-serif';
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = 'right';
    ctx2d.fillStyle = '#ff2b2b';
    ctx2d.fillText(`Instantaneous: ${last.instant.toFixed(1)}%`, w - 8, 6);
    ctx2d.fillStyle = '#b18aff';
    ctx2d.fillText(`Average: ${last.average.toFixed(1)}%`, w - 8, 24);
  }

  function addPoint(t, instant, average) {
    points.push({ t, instant, average });
    draw();
  }


  function reset() {
    points.length = 0;
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

  return { addPoint, reset, resize };
}
