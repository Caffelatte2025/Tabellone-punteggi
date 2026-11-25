// Visualizzatore 3D / pianta con three.js. Z verso l'alto (come lo scanner).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PALETTE = [
  [0.35, 0.65, 1.0], [0.4, 0.9, 0.5], [0.95, 0.45, 0.85], [1.0, 0.85, 0.3], [0.4, 0.95, 0.95],
  [0.75, 0.6, 1.0], [1.0, 0.6, 0.45], [0.6, 1.0, 0.75], [0.9, 0.9, 0.9], [0.55, 0.75, 0.45],
];
const ACTIVE = [1.0, 0.55, 0.1];

export class Viewer {
  constructor(container) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x15181d);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
    this.persp.up.set(0, 0, 1);
    this.persp.position.set(-20, -20, 20);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
    this.ortho.position.set(0, 0, 1000);
    this.ortho.up.set(0, 1, 0);
    this.ortho.lookAt(0, 0, 0);
    this.viewH = 60; // metri visibili in verticale a zoom 1

    this.controls = new OrbitControls(this.persp, this.canvas);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());

    this.items = new Map(); // id -> { points, marker, label, station, cloud }
    this.colorMode = 'station';
    this.pointSize = 2;
    this.activeId = null;
    this.align = null; // { id, onChange }
    this.slice = { enabled: true, lo: -1.0, hi: 1.0, ref: 0 };
    this.clipPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];

    this.labels = document.createElement('div');
    this.labels.className = 'labels';
    container.appendChild(this.labels);

    this.mode = 'plan';
    this.#setupPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.setMode('plan');
  }

  get camera() {
    return this.mode === 'plan' ? this.ortho : this.persp;
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const a = w / h;
    this.ortho.left = (-this.viewH * a) / 2;
    this.ortho.right = (this.viewH * a) / 2;
    this.ortho.top = this.viewH / 2;
    this.ortho.bottom = -this.viewH / 2;
    this.ortho.updateProjectionMatrix();
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === '3d';
    this.#applyClipping();
    this.render();
  }

  setSlice(s) {
    Object.assign(this.slice, s);
    this.#applyClipping();
    this.render();
  }

  #applyClipping() {
    const on = this.mode === 'plan' && this.slice.enabled;
    const { lo, hi, ref } = this.slice;
    // tiene z in [ref+lo, ref+hi]
    this.clipPlanes[0].constant = ref + hi;
    this.clipPlanes[1].constant = -(ref + lo);
    for (const it of this.items.values()) it.points.material.clippingPlanes = on ? this.clipPlanes : null;
  }

  setStation(station, cloud, index) {
    let it = this.items.get(station.id);
    if (!it) {
      const geom = new THREE.BufferGeometry();
      const material = new THREE.PointsMaterial({ size: this.pointSize, sizeAttenuation: false, vertexColors: true });
      const points = new THREE.Points(geom, material);
      points.matrixAutoUpdate = false;
      points.frustumCulled = false;
      this.scene.add(points);
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.25, 0.4, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      );
      marker.renderOrder = 10;
      marker.matrixAutoUpdate = false;
      this.scene.add(marker);
      const label = document.createElement('div');
      label.className = 'label';
      this.labels.appendChild(label);
      it = { points, marker, label };
      this.items.set(station.id, it);
    }
    it.station = station;
    it.index = index;
    if (cloud && it.cloud !== cloud) {
      it.cloud = cloud;
      const disp = displaySubset(cloud, 400000);
      it.disp = disp;
      it.points.geometry.setAttribute('position', new THREE.BufferAttribute(disp.positions, 3));
      it.points.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(disp.count * 3), 3, true));
    }
    it.label.textContent = station.name;
    this.#applyClipping();
    this.#recolor(it);
    this.setMatrix(station.id, station.matrix);
  }

  setMatrix(id, m) {
    const it = this.items.get(id);
    if (!it) return;
    it.points.matrix.fromArray(m);
    it.points.matrixWorldNeedsUpdate = true;
    // il marker resta orizzontale: solo posizione
    it.marker.matrix.makeTranslation(m[12], m[13], m[14]);
    it.marker.matrixWorldNeedsUpdate = true;
    it.matrix = m;
    this.render();
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.points, it.marker);
    it.points.geometry.dispose();
    it.points.material.dispose();
    it.label.remove();
    this.items.delete(id);
    this.render();
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  setActive(id) {
    this.activeId = id;
    for (const it of this.items.values()) this.#recolor(it);
    this.render();
  }

  setColorMode(m) {
    this.colorMode = m;
    for (const it of this.items.values()) this.#recolor(it);
    this.render();
  }

  setPointSize(s) {
    this.pointSize = s;
    for (const it of this.items.values()) it.points.material.size = s;
    this.render();
  }

  #recolor(it) {
    if (!it.disp) return;
    const attr = it.points.geometry.getAttribute('color');
    const c = attr.array;
    const { intensity, colors, count } = it.disp;
    const active = it.station.id === this.activeId;
    const base = active ? ACTIVE : PALETTE[(it.index ?? 0) % PALETTE.length];
    const mode = this.colorMode;
    for (let i = 0; i < count; i++) {
      const v = intensity[i] / 255;
      if (mode === 'rgb' && colors && !active) {
        c[i * 3] = colors[i * 3]; c[i * 3 + 1] = colors[i * 3 + 1]; c[i * 3 + 2] = colors[i * 3 + 2];
      } else if (mode === 'intensity' && !active) {
        const g = Math.round(40 + v * 215);
        c[i * 3] = g; c[i * 3 + 1] = g; c[i * 3 + 2] = g;
      } else {
        const k = 0.35 + 0.65 * v;
        c[i * 3] = base[0] * k * 255; c[i * 3 + 1] = base[1] * k * 255; c[i * 3 + 2] = base[2] * k * 255;
      }
    }
    attr.needsUpdate = true;
    const st = it.station.status;
    it.marker.material.color.set(active ? 0xff8c1a : st === 'registered' || st === 'reference' ? 0x4cd964 : 0xff4d4d);
  }

  frameAll() {
    const box = new THREE.Box3();
    for (const it of this.items.values()) {
      const p = new THREE.Vector3(it.matrix[12], it.matrix[13], it.matrix[14]);
      box.expandByPoint(p);
      box.expandByScalar(0); // solo posizioni stazioni + margine sotto
    }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y) + 40;
    this.ortho.position.set(c.x, c.y, 1000);
    this.viewH = span;
    this.ortho.zoom = 1;
    this.persp.position.set(c.x - span * 0.5, c.y - span * 0.5, c.z + span * 0.5);
    this.controls.target.copy(c);
    this.controls.update();
    this.resize();
  }

  focusStation(id) {
    const it = this.items.get(id);
    if (!it) return;
    const m = it.matrix;
    this.ortho.position.x = m[12];
    this.ortho.position.y = m[13];
    this.controls.target.set(m[12], m[13], m[14]);
    this.controls.update();
    this.render();
  }

  // modalita allineamento manuale: in pianta il trascinamento sposta la stazione
  setAlign(id, onChange) {
    this.align = id ? { id, onChange } : null;
    this.render();
  }

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.renderer.render(this.scene, this.camera);
      this.#updateLabels();
    });
  }

  #updateLabels() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const it of this.items.values()) {
      v.set(it.matrix[12], it.matrix[13], it.matrix[14]).project(this.camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      it.label.style.display = vis ? '' : 'none';
      if (vis) it.label.style.transform = `translate(${((v.x + 1) / 2) * w + 10}px, ${((1 - v.y) / 2) * h - 10}px)`;
      it.label.classList.toggle('active', it.station.id === this.activeId);
    }
  }

  screenToWorld(px, py) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1, 0);
    v.unproject(this.ortho);
    return v;
  }

  #setupPointer() {
    const ptrs = new Map();
    let last = null;
    const cv = this.canvas;

    const state = () => {
      const arr = [...ptrs.values()];
      if (arr.length === 1) return { n: 1, x: arr[0].x, y: arr[0].y };
      const [a, b] = arr;
      return { n: 2, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    cv.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'plan') return;
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = state();
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.mode !== 'plan' || !ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const cur = state();
      if (!last || cur.n !== last.n) { last = cur; return; }
      const w0 = this.screenToWorld(last.x, last.y), w1 = this.screenToWorld(cur.x, cur.y);
      const al = this.align && this.items.get(this.align.id);
      if (cur.n === 1) {
        if (al) this.#moveAligned(al, w1.x - w0.x, w1.y - w0.y, 0);
        else { this.ortho.position.x -= w1.x - w0.x; this.ortho.position.y -= w1.y - w0.y; }
      } else {
        if (al) {
          // due dita: rotazione della stazione (torsione) + spostamento
          let da = cur.ang - last.ang;
          if (da > Math.PI) da -= 2 * Math.PI;
          if (da < -Math.PI) da += 2 * Math.PI;
          this.#moveAligned(al, w1.x - w0.x, w1.y - w0.y, -da);
        } else {
          this.ortho.position.x -= w1.x - w0.x; this.ortho.position.y -= w1.y - w0.y;
        }
        this.#zoomAt(cur.x, cur.y, cur.d / last.d);
      }
      last = cur;
      this.ortho.updateMatrixWorld();
      this.render();
    });
    const up = (e) => { ptrs.delete(e.pointerId); last = ptrs.size ? state() : null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (this.mode !== 'plan') return;
      e.preventDefault();
      this.#zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      this.render();
    }, { passive: false });
  }

  #zoomAt(px, py, f) {
    if (!Number.isFinite(f) || f <= 0) return;
    const before = this.screenToWorld(px, py);
    this.ortho.zoom = Math.min(200, Math.max(0.05, this.ortho.zoom * f));
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
    const after = this.screenToWorld(px, py);
    this.ortho.position.x += before.x - after.x;
    this.ortho.position.y += before.y - after.y;
    this.ortho.updateMatrixWorld();
  }

  #moveAligned(it, dx, dy, dyaw) {
    const m = it.matrix.slice();
    if (dyaw) {
      const c = Math.cos(dyaw), s = Math.sin(dyaw);
      // ruota attorno alla posizione dello scanner
      for (const col of [0, 4, 8]) {
        const x = m[col], y = m[col + 1];
        m[col] = c * x - s * y;
        m[col + 1] = s * x + c * y;
      }
    }
    m[12] += dx; m[13] += dy;
    this.setMatrix(it.station.id, m);
    this.align.onChange?.(m);
  }

  rotateAligned(deg) {
    const it = this.align && this.items.get(this.align.id);
    if (it) this.#moveAligned(it, 0, 0, (deg * Math.PI) / 180);
  }
}

function displaySubset(cloud, max) {
  const n = cloud.positions.length / 3;
  if (n <= max) return { positions: cloud.positions, intensity: cloud.intensity, colors: cloud.colors, count: n };
  const step = n / max;
  const P = new Float32Array(max * 3), I = new Uint8Array(max), C = cloud.colors ? new Uint8Array(max * 3) : null;
  for (let i = 0; i < max; i++) {
    const j = Math.floor(i * step);
    P[i * 3] = cloud.positions[j * 3]; P[i * 3 + 1] = cloud.positions[j * 3 + 1]; P[i * 3 + 2] = cloud.positions[j * 3 + 2];
    I[i] = cloud.intensity[j];
    if (C) { C[i * 3] = cloud.colors[j * 3]; C[i * 3 + 1] = cloud.colors[j * 3 + 1]; C[i * 3 + 2] = cloud.colors[j * 3 + 2]; }
  }
  return { positions: P, intensity: I, colors: C, count: max };
}
