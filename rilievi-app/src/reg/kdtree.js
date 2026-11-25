// KD-tree statico implicito (stile kdbush) su Float32Array xyz.

export class KDTree {
  constructor(pos, leaf = 12) {
    this.pos = pos;
    const n = pos.length / 3;
    this.n = n;
    this.leaf = leaf;
    const ids = new Uint32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    this.ids = ids;
    this.#build(0, n - 1, 0);
  }

  #build(lo, hi, axis) {
    // pila esplicita per evitare ricorsione profonda
    const stack = [lo, hi, axis];
    while (stack.length) {
      const ax = stack.pop(), h = stack.pop(), l = stack.pop();
      if (h - l <= this.leaf) continue;
      const m = (l + h) >> 1;
      this.#select(m, l, h, ax);
      const na = (ax + 1) % 3;
      stack.push(l, m - 1, na, m + 1, h, na);
    }
  }

  #select(k, left, right, axis) {
    const { ids, pos } = this;
    while (right > left) {
      const pivot = pos[ids[(left + right) >> 1] * 3 + axis];
      let i = left, j = right;
      while (i <= j) {
        while (pos[ids[i] * 3 + axis] < pivot) i++;
        while (pos[ids[j] * 3 + axis] > pivot) j--;
        if (i <= j) { const t = ids[i]; ids[i] = ids[j]; ids[j] = t; i++; j--; }
      }
      if (k <= j) right = j;
      else if (k >= i) left = i;
      else return;
    }
  }

  // ritorna indice del punto piu vicino entro sqrt(maxD2), o -1. Distanza^2 in this.lastD2
  nearest(x, y, z, maxD2) {
    const { ids, pos, leaf } = this;
    let best = -1, bestD = maxD2;
    const stack = this._stack || (this._stack = new Int32Array(256));
    let sp = 0;
    stack[sp++] = 0; stack[sp++] = this.n - 1; stack[sp++] = 0;
    while (sp) {
      const axis = stack[--sp], hi = stack[--sp], lo = stack[--sp];
      if (hi - lo <= leaf) {
        for (let i = lo; i <= hi; i++) {
          const p = ids[i] * 3;
          const dx = pos[p] - x, dy = pos[p + 1] - y, dz = pos[p + 2] - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = ids[i]; }
        }
        continue;
      }
      const m = (lo + hi) >> 1;
      const p = ids[m] * 3;
      const dx = pos[p] - x, dy = pos[p + 1] - y, dz = pos[p + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = ids[m]; }
      const q = axis === 0 ? x : axis === 1 ? y : z;
      const diff = q - pos[p + axis];
      const na = (axis + 1) % 3;
      // prima il lato vicino (spinto per ultimo)
      if (diff * diff < bestD) {
        if (diff < 0) { stack[sp++] = m + 1; stack[sp++] = hi; stack[sp++] = na; }
        else { stack[sp++] = lo; stack[sp++] = m - 1; stack[sp++] = na; }
      }
      if (diff < 0) { stack[sp++] = lo; stack[sp++] = m - 1; stack[sp++] = na; }
      else { stack[sp++] = m + 1; stack[sp++] = hi; stack[sp++] = na; }
    }
    this.lastD2 = bestD;
    return best;
  }

  // k vicini entro raggio: riempie outIdx, ritorna quanti trovati
  knn(x, y, z, k, maxD2, outIdx, outD) {
    const { ids, pos, leaf } = this;
    let cnt = 0;
    let worst = maxD2;
    const insert = (id, d) => {
      let j;
      if (cnt < k) j = cnt++;
      else { if (d >= outD[k - 1]) return; j = k - 1; }
      while (j > 0 && outD[j - 1] > d) { outD[j] = outD[j - 1]; outIdx[j] = outIdx[j - 1]; j--; }
      outD[j] = d; outIdx[j] = id;
      if (cnt === k) worst = outD[k - 1];
    };
    const stack = this._stack2 || (this._stack2 = new Int32Array(256));
    let sp = 0;
    stack[sp++] = 0; stack[sp++] = this.n - 1; stack[sp++] = 0;
    while (sp) {
      const axis = stack[--sp], hi = stack[--sp], lo = stack[--sp];
      if (hi - lo <= leaf) {
        for (let i = lo; i <= hi; i++) {
          const p = ids[i] * 3;
          const dx = pos[p] - x, dy = pos[p + 1] - y, dz = pos[p + 2] - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < worst) insert(ids[i], d);
        }
        continue;
      }
      const m = (lo + hi) >> 1;
      const p = ids[m] * 3;
      const dx = pos[p] - x, dy = pos[p + 1] - y, dz = pos[p + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < worst) insert(ids[m], d);
      const q = axis === 0 ? x : axis === 1 ? y : z;
      const diff = q - pos[p + axis];
      const na = (axis + 1) % 3;
      if (diff * diff < worst) {
        if (diff < 0) { stack[sp++] = m + 1; stack[sp++] = hi; stack[sp++] = na; }
        else { stack[sp++] = lo; stack[sp++] = m - 1; stack[sp++] = na; }
      }
      if (diff < 0) { stack[sp++] = lo; stack[sp++] = m - 1; stack[sp++] = na; }
      else { stack[sp++] = m + 1; stack[sp++] = hi; stack[sp++] = na; }
    }
    return cnt;
  }
}
