// Allineamento a punti su due panorami 360° affiancati (come in Trimble Perspective):
// a sinistra una stazione già registrata, a destra quella da allineare. Toccando lo stesso
// dettaglio nei due panorami si crea una coppia; con 2+ coppie si calcola la posizione.

import { panoPoint, pixelFor, solvePairs, applyM, invertM } from './pano.js';

const COLORS = ['#ff8c1a', '#4cd964', '#3da5ff', '#ff4dd2', '#ffe14d', '#4de1e1', '#c38bff', '#ff6b6b'];

/**
 * @param {object} o
 *  refs: [{ station, pano }] stazioni registrate con panorama (la prima è quella proposta)
 *  cur:  { station, pano } stazione da allineare
 *  levelled: bool
 *  onApply(matrix, refine)
 */
export function openPairAlign(o) {
  const root = document.createElement('div');
  root.id = 'pairAlign';
  root.innerHTML = `
    <div class="pa-head">
      <b>Allineamento a punti</b>
      <span class="pa-help muted">Tocca lo stesso dettaglio nei due panorami (spigoli, pali, finestre). Bastano 2 coppie, meglio 3-4 ben distribuite. Un dito sposta, due dita zoom.</span>
      <span class="spacer"></span>
      <button data-a="undo">Annulla ultimo</button>
      <button data-a="clear">Azzera</button>
      <button data-a="apply">Applica</button>
      <button data-a="applyRefine" class="primary">Applica e affina</button>
      <button data-a="close" class="icon" title="Chiudi">✕</button>
    </div>
    <div class="pa-panes">
      <div class="pa-pane" data-side="L"><div class="pa-label"><select class="pa-ref"></select></div><canvas></canvas></div>
      <div class="pa-pane" data-side="R"><div class="pa-label"></div><canvas></canvas></div>
    </div>
    <div class="pa-foot"><span class="pa-status"></span><div class="pa-pairs"></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);

  let ref = o.refs[0];
  const L = new PanoPane(root.querySelector('[data-side=L]'), () => redraw());
  const R = new PanoPane(root.querySelector('[data-side=R]'), () => redraw());
  const ptsL = [], ptsR = []; // { px, py, p (locale) }
  let sol = null;

  const sel = $('.pa-ref');
  o.refs.forEach((r, i) => sel.add(new Option(`Riferimento: ${r.station.name}`, i)));
  sel.onchange = () => { ref = o.refs[+sel.value]; ptsL.length = 0; ptsR.length = 0; L.setPano(ref.pano); update(); };
  root.querySelector('[data-side=R] .pa-label').textContent = `Da allineare: ${o.cur.station.name}`;
  L.setPano(ref.pano);
  R.setPano(o.cur.pano);

  // proposta iniziale: dalla posizione attuale della stazione, guarda nella stessa direzione nei due panorami
  L.onTap = (px, py) => {
    const hit = panoPoint(ref.pano, px, py);
    if (!hit) return flash('Nessuna misura in quel punto (cielo o troppo lontano): scegli un altro dettaglio');
    ptsL.push(hit);
    update();
    // con una soluzione già calcolata, centra il panorama di destra sul punto corrispondente previsto
    const m = sol ? sol.matrix : o.cur.station.matrix;
    const world = applyM(ref.station.matrix, hit.p);
    const loc = applyM(invertM(m), world);
    const pix = pixelFor(o.cur.pano, loc);
    if (pix && (sol || ptsR.length < ptsL.length)) { R.predicted = pix; R.centerOn(pix.px, pix.py, sol ? 2.5 : null); }
  };
  R.onTap = (px, py) => {
    const hit = panoPoint(o.cur.pano, px, py);
    if (!hit) return flash('Nessuna misura in quel punto (cielo o troppo lontano): scegli un altro dettaglio');
    ptsR.push(hit);
    R.predicted = null;
    update();
  };

  function update() {
    const n = Math.min(ptsL.length, ptsR.length);
    sol = null;
    if (n >= (o.levelled ? 2 : 3)) {
      const src = ptsR.slice(0, n).map((h) => h.p);
      const dst = ptsL.slice(0, n).map((h) => applyM(ref.station.matrix, h.p));
      sol = solvePairs(src, dst, o.levelled);
    }
    const need = o.levelled ? 2 : 3;
    let msg;
    if (ptsL.length > ptsR.length) msg = `Punto ${ptsL.length}: ora toccalo nel panorama di destra`;
    else if (ptsR.length > ptsL.length) msg = `Punto ${ptsR.length}: ora toccalo nel panorama di sinistra`;
    else if (!sol) msg = `${n} coppie: servono almeno ${need} coppie`;
    else {
      // geometria: punti troppo vicini tra loro (rispetto alla stazione) danno una rotazione incerta
      const dst = ptsL.slice(0, n).map((h) => applyM(ref.station.matrix, h.p));
      let spread = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) spread = Math.max(spread, Math.hypot(dst[i][0] - dst[j][0], dst[i][1] - dst[j][1]));
      msg = `${n} coppie · scarto medio ${(sol.rms * 100).toFixed(1)} cm` + (sol.rms > 0.1 ? ' — troppo alto: controlla le coppie in rosso' : spread < 3 ? ' — punti troppo vicini tra loro: scegline uno da un\'altra parte' : n < 3 ? ' — aggiungi una terza coppia per controllo' : '');
    }
    $('.pa-status').textContent = msg;
    $('.pa-status').className = 'pa-status ' + (!sol ? 'muted' : sol.rms > 0.1 ? 'q-bad' : sol.rms > 0.04 ? 'q-warn' : 'q-good');
    const box = $('.pa-pairs');
    box.innerHTML = '';
    for (let i = 0; i < Math.max(ptsL.length, ptsR.length); i++) {
      const s = document.createElement('span');
      s.className = 'pa-pair';
      const r = sol && i < sol.residuals.length ? sol.residuals[i] : null;
      s.style.borderColor = COLORS[i % COLORS.length];
      s.innerHTML = `<b>${i + 1}</b> ${r == null ? (i < ptsL.length && i < ptsR.length ? '' : '…') : `${(r * 100).toFixed(1)} cm`}`;
      if (r != null && r > 0.1) s.classList.add('bad');
      box.appendChild(s);
    }
    $('[data-a=apply]').disabled = !sol;
    $('[data-a=applyRefine]').disabled = !sol;
    redraw();
  }

  function redraw() {
    L.draw(ptsL, sol ? sol.residuals : null);
    R.draw(ptsR, sol ? sol.residuals : null);
    R.drawPredicted();
  }

  let flashT;
  function flash(t) {
    const s = $('.pa-status');
    s.textContent = t; s.className = 'pa-status q-warn';
    clearTimeout(flashT); flashT = setTimeout(update, 2500);
  }

  const close = () => { L.dispose(); R.dispose(); root.remove(); window.removeEventListener('resize', onResize); };
  const onResize = () => { L.resize(); R.resize(); redraw(); };
  window.addEventListener('resize', onResize);
  root.querySelector('.pa-head').onclick = (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'close') close();
    else if (a === 'undo') { if (ptsL.length > ptsR.length) ptsL.pop(); else if (ptsR.length > ptsL.length) ptsR.pop(); else { ptsL.pop(); ptsR.pop(); } update(); }
    else if (a === 'clear') { ptsL.length = 0; ptsR.length = 0; update(); }
    else if ((a === 'apply' || a === 'applyRefine') && sol) { const m = sol.matrix; close(); o.onApply(m, a === 'applyRefine', sol); }
  };
  requestAnimationFrame(() => { onResize(); L.fitHeight(); R.fitHeight(); update(); });
}

// ---------- un panorama con pan/zoom a tocco ----------
class PanoPane {
  constructor(el, onChange) {
    this.el = el;
    this.cv = el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.onChange = onChange;
    this.s = 1; this.ox = 0; this.oy = 0; // pixel schermo per pixel panorama; pixel panorama al bordo sinistro/alto
    this.ptrs = new Map();
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => this.#down(e));
    cv.addEventListener('pointermove', (e) => this.#move(e));
    cv.addEventListener('pointerup', (e) => this.#up(e));
    cv.addEventListener('pointercancel', (e) => this.ptrs.delete(e.pointerId));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.#zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }

  setPano(p) {
    this.pano = p;
    // immagine in scala di grigi con contrasto stirato (2-98 percentile)
    const { w, h, grey } = p;
    const hist = new Uint32Array(256);
    for (let i = 0; i < grey.length; i += 7) hist[grey[i]]++;
    const tot = hist.reduce((a, b) => a + b, 0);
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < tot * 0.01) lo = v; if (acc < tot * 0.995) hi = v; }
    // curva con gamma: le intensità laser sono quasi tutte alte, così i dettagli restano leggibili
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / Math.max(1, hi - lo))), 2.2));
    const img = new ImageData(w, h);
    for (let i = 0; i < grey.length; i++) {
      const v = lut[grey[i]];
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    this.img = document.createElement('canvas');
    this.img.width = w; this.img.height = h;
    this.img.getContext('2d').putImageData(img, 0, 0);
    this.fitHeight();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height - 34;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fitHeight() {
    if (!this.pano || !this.H) return;
    this.s = this.H / this.pano.h;
    this.oy = 0;
    this.#clamp();
    this.onChange?.();
  }

  centerOn(px, py, zoom) {
    if (zoom) this.s = Math.max(this.s, (this.H / this.pano.h) * zoom);
    this.ox = px - this.W / 2 / this.s;
    this.oy = py - this.H / 2 / this.s;
    this.#clamp();
    this.onChange?.();
  }

  #clamp() {
    const { w, h } = this.pano;
    this.s = Math.min(Math.max(this.s, this.H / h), 12);
    this.ox = ((this.ox % w) + w) % w; // 360°: si gira all'infinito
    this.oy = Math.min(Math.max(this.oy, 0), Math.max(0, h - this.H / this.s));
  }

  #zoomAt(sx, sy, f) {
    const px = this.ox + sx / this.s, py = this.oy + sy / this.s;
    this.s *= f;
    this.#clamp();
    this.ox = px - sx / this.s; this.oy = py - sy / this.s;
    this.#clamp();
    this.onChange?.();
  }

  #down(e) {
    this.cv.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t: performance.now() });
    if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; this.multi = true; }
  }

  #move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    if (this.ptrs.size === 1) {
      this.ox -= dx / this.s; this.oy -= dy / this.s;
      this.#clamp();
      this.onChange?.();
    } else if (this.ptrs.size === 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.#zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch.d);
      this.pinch.d = d;
    }
  }

  #up(e) {
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (!p) return;
    const moved = Math.hypot(e.offsetX - p.x0, e.offsetY - p.y0);
    if (!this.multi && moved < 10 && performance.now() - p.t < 600) {
      const px = (((this.ox + e.offsetX / this.s) % this.pano.w) + this.pano.w) % this.pano.w;
      const py = this.oy + e.offsetY / this.s;
      this.onTap?.(px, py);
    }
    if (this.ptrs.size === 0) { this.multi = false; this.pinch = null; }
  }

  draw(pts, residuals) {
    if (!this.img || !this.W) return;
    const { ctx, s } = this;
    const { w } = this.pano;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.imageSmoothingEnabled = s < 2;
    // il panorama si ripete orizzontalmente (360°)
    for (let k = -1; k <= Math.ceil(this.W / (w * s)) + 1; k++) {
      ctx.drawImage(this.img, (k * w - this.ox) * s, -this.oy * s, w * s, this.pano.h * s);
    }
    pts.forEach((h, i) => {
      const bad = residuals && i < residuals.length && residuals[i] > 0.1;
      let x = (h.px - this.ox) * s;
      x = ((x % (w * s)) + w * s) % (w * s);
      const y = (h.py - this.oy) * s;
      ctx.lineWidth = 3;
      ctx.strokeStyle = bad ? '#ff3b3b' : COLORS[i % COLORS.length];
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 18, y);
      ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 18); ctx.stroke();
      ctx.font = 'bold 15px system-ui'; ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(String(i + 1), x + 13, y - 13);
    });
  }

  dispose() { this.img = null; }

  drawPredicted() {
    if (!this.predicted || !this.W) return;
    const { ctx, s } = this, w = this.pano.w;
    let x = (this.predicted.px - this.ox) * s;
    x = ((x % (w * s)) + w * s) % (w * s);
    const y = (this.predicted.py - this.oy) * s;
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '13px system-ui'; ctx.fillStyle = '#ffffff'; ctx.fillText('previsto', x + 28, y + 4);
  }
}
