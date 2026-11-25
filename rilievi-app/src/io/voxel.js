// Decimazione a griglia di voxel in streaming: tiene il primo punto di ogni voxel.
// Usa una hash table ad indirizzamento aperto per non esplodere in memoria su tablet.

const OFF = 65536; // 17 bit per asse: +-65536 voxel (a 2 cm = +-1.3 km)

export class VoxelGrid {
  constructor(voxel, maxRange = Infinity, minRange = 0) {
    this.inv = 1 / voxel;
    this.maxR2 = maxRange * maxRange;
    this.minR2 = minRange * minRange;
    this.cap = 1 << 20;
    this.keys = new Float64Array(this.cap).fill(-1);
    this.count = 0;
    this.pos = new Float32Array(3 << 18);
    this.int = new Uint8Array(1 << 18);
    this.col = null; // Uint8Array rgb, creato al primo colore
    this.seen = 0;
  }

  add(x, y, z, intensity, r, g, b) {
    this.seen++;
    const d2 = x * x + y * y + z * z;
    if (d2 > this.maxR2 || d2 < this.minR2) return;
    const ix = Math.floor(x * this.inv) + OFF;
    const iy = Math.floor(y * this.inv) + OFF;
    const iz = Math.floor(z * this.inv) + OFF;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= 2 * OFF || iy >= 2 * OFF || iz >= 2 * OFF) return;
    const key = ix * 17179869184 + iy * 131072 + iz; // ix*2^34 + iy*2^17 + iz
    let mask = this.cap - 1;
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    const keys = this.keys;
    while (true) {
      const k = keys[h];
      if (k === key) return;
      if (k === -1) break;
      h = (h + 1) & mask;
    }
    keys[h] = key;
    const n = this.count++;
    if (n * 3 + 3 > this.pos.length) this.#growPoints();
    this.pos[n * 3] = x;
    this.pos[n * 3 + 1] = y;
    this.pos[n * 3 + 2] = z;
    this.int[n] = intensity === undefined ? 128 : Math.max(0, Math.min(255, Math.round(intensity * 255)));
    if (r !== undefined) {
      if (!this.col) this.col = new Uint8Array(this.int.length * 3);
      this.col[n * 3] = r;
      this.col[n * 3 + 1] = g;
      this.col[n * 3 + 2] = b;
    }
    if (this.count * 2 > this.cap) this.#rehash();
  }

  #growPoints() {
    const p = new Float32Array(this.pos.length * 2);
    p.set(this.pos);
    this.pos = p;
    const i = new Uint8Array(this.int.length * 2);
    i.set(this.int);
    this.int = i;
    if (this.col) {
      const c = new Uint8Array(this.col.length * 2);
      c.set(this.col);
      this.col = c;
    }
  }

  #rehash() {
    const old = this.keys;
    this.cap *= 2;
    const mask = this.cap - 1;
    const keys = new Float64Array(this.cap).fill(-1);
    for (let j = 0; j < old.length; j++) {
      const key = old[j];
      if (key === -1) continue;
      const ix = Math.floor(key / 17179869184);
      const rem = key - ix * 17179869184;
      const iy = Math.floor(rem / 131072);
      const iz = rem - iy * 131072;
      let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
      while (keys[h] !== -1) h = (h + 1) & mask;
      keys[h] = key;
    }
    this.keys = keys;
  }

  result() {
    const n = this.count;
    return {
      count: n,
      positions: this.pos.slice(0, n * 3),
      intensity: this.int.slice(0, n),
      colors: this.col ? this.col.slice(0, n * 3) : null,
      rawCount: this.seen,
    };
  }
}
