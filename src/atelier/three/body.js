import * as THREE from "three";

/*
 * The body is described as a set of tubes with elliptical cross-sections.
 * A point on a tube is P(θ, t) = centre(t) + X·cosθ·(rx + off) + Z·sinθ·(rz + off)
 * where θ = π/2 faces the front (+Z) and t runs along the tube's axis.
 * Garment pieces are regions on these tubes; see cloth.js.
 */

// Monotone (Fritsch–Carlson) cubic through sorted keys [[x, a, b, …], …].
// Monotone so tight transitions like the shoulder slope never overshoot.
export function monotoneSpline(keys) {
  const n = keys.length;
  const dims = keys[0].length - 1;
  const xs = keys.map((k) => k[0]);
  const slopes = [];
  for (let d = 0; d < dims; d++) {
    const ys = keys.map((k) => k[d + 1]);
    const sec = [];
    for (let i = 0; i < n - 1; i++) sec.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    const m = new Array(n);
    m[0] = sec[0];
    m[n - 1] = sec[n - 2];
    for (let i = 1; i < n - 1; i++) {
      m[i] = sec[i - 1] * sec[i] <= 0 ? 0 : 2 / (1 / sec[i - 1] + 1 / sec[i]);
    }
    slopes.push({ ys, m });
  }
  const out = new Array(dims);
  return (x) => {
    const xc = Math.min(Math.max(x, xs[0]), xs[n - 1]);
    let i = 0;
    while (i < n - 2 && xc > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (xc - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    for (let d = 0; d < dims; d++) {
      const { ys, m } = slopes[d];
      out[d] = h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
    }
    return out;
  };
}

const _c = new THREE.Vector3();

export class Tube {
  /**
   * @param {object} o
   * @param {THREE.Vector3} o.origin  centre at t = 0
   * @param {THREE.Vector3} o.axis    unit direction of increasing t
   * @param {number} o.length         world length per unit t
   * @param {Array} o.keys            [[t, rx, rz, zc]] cross-section keyframes
   * @param {number} o.outward        +1/-1: which way X should point (limbs), 0 = keep
   */
  constructor({ origin, axis, length = 1, keys, outward = 0, t0, t1, kind = "torso", side = 0 }) {
    this.kind = kind;
    this.side = side;
    this.origin = origin.clone();
    this.axis = axis.clone().normalize();
    this.length = length;
    this.profile = monotoneSpline(keys);
    this.t0 = t0 ?? keys[0][0];
    this.t1 = t1 ?? keys[keys.length - 1][0];

    const front = new THREE.Vector3(0, 0, 1);
    this.Z = front.sub(this.axis.clone().multiplyScalar(this.axis.dot(front))).normalize();
    this.X = new THREE.Vector3().crossVectors(this.axis, this.Z).normalize();
    if (outward !== 0 && Math.sign(this.X.x) !== Math.sign(outward)) this.X.negate();

    this._buildArcTable();
  }

  section(t) {
    const [rx, rz, zc] = this.profile(t);
    return { rx, rz, zc: zc ?? 0 };
  }

  centre(t, target = new THREE.Vector3()) {
    const { zc } = this.section(t);
    return target
      .copy(this.origin)
      .addScaledVector(this.axis, t * this.length)
      .addScaledVector(this.Z, zc);
  }

  point(theta, t, off = 0, target = new THREE.Vector3()) {
    const { rx, rz } = this.section(t);
    this.centre(t, target);
    target.addScaledVector(this.X, Math.cos(theta) * (rx + off));
    target.addScaledVector(this.Z, Math.sin(theta) * (rz + off));
    return target;
  }

  tangentTheta(theta, t, off = 0, target = new THREE.Vector3()) {
    const { rx, rz } = this.section(t);
    return target
      .copy(this.X)
      .multiplyScalar(-Math.sin(theta) * (rx + off))
      .addScaledVector(this.Z, Math.cos(theta) * (rz + off));
  }

  outwardAt(theta, t, off, target = new THREE.Vector3()) {
    this.point(theta, t, off, target);
    return target.sub(this.centre(t, _c)).normalize();
  }

  // Length of the arc from θa to θb at height t (numerical).
  arc(t, off, a, b, steps = 20) {
    const { rx, rz } = this.section(t);
    const h = (b - a) / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const th = a + (i + 0.5) * h;
      const dx = -Math.sin(th) * (rx + off);
      const dz = Math.cos(th) * (rz + off);
      sum += Math.sqrt(dx * dx + dz * dz) * h;
    }
    return sum;
  }

  // Arc length along the profile (average radius) — used to space rows evenly
  // even where the surface turns nearly horizontal (the shoulder line).
  _buildArcTable(samples = 600) {
    this._ts = new Float32Array(samples + 1);
    this._as = new Float32Array(samples + 1);
    let prevR = 0;
    let prevA = 0;
    let acc = 0;
    for (let i = 0; i <= samples; i++) {
      const t = this.t0 + ((this.t1 - this.t0) * i) / samples;
      const { rx, rz } = this.section(t);
      const r = (rx + rz) * 0.5;
      const along = t * this.length;
      if (i > 0) acc += Math.hypot(r - prevR, along - prevA);
      this._ts[i] = t;
      this._as[i] = acc;
      prevR = r;
      prevA = along;
    }
  }

  arcAt(t) {
    const ts = this._ts;
    const n = ts.length - 1;
    const f = ((t - this.t0) / (this.t1 - this.t0)) * n;
    const i = Math.min(Math.max(Math.floor(f), 0), n - 1);
    const k = Math.min(Math.max(f - i, 0), 1);
    return this._as[i] + (this._as[i + 1] - this._as[i]) * k;
  }

  tAtArc(a) {
    const as = this._as;
    let lo = 0;
    let hi = as.length - 1;
    if (a <= as[0]) return this._ts[0];
    if (a >= as[hi]) return this._ts[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (as[mid] < a) lo = mid;
      else hi = mid;
    }
    const k = (a - as[lo]) / (as[hi] - as[lo] || 1);
    return this._ts[lo] + (this._ts[hi] - this._ts[lo]) * k;
  }

  // t at fraction f of the arc between ta and tb.
  tBetween(ta, tb, f) {
    const a = this.arcAt(ta);
    const b = this.arcAt(tb);
    return this.tAtArc(a + (b - a) * f);
  }
}

/*
 * Proportions in metres for a 1.83 m man, waist at y = 0, floor at y = -1.05.
 * zc nudges the section forward at the chest so the front is fuller than the back.
 */
export const FLOOR_Y = -1.05;
export const SHOULDER = new THREE.Vector3(0.168, 0.408, 0.0);
export const HIP = new THREE.Vector3(0.092, -0.145, 0.0);

// Limb names follow the wearer: the wearer faces +Z, so their left is +X.
export function createBody() {
  const body = {
    torso: new Tube({
      origin: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 1, 0),
      keys: [
        [-0.64, 0.19, 0.132, 0.0],
        [-0.42, 0.186, 0.132, 0.0],
        [-0.2, 0.177, 0.126, 0.0],
        [0.0, 0.153, 0.111, 0.006],
        [0.17, 0.164, 0.119, 0.013],
        [0.31, 0.178, 0.123, 0.016],
        [0.4, 0.19, 0.113, 0.008],
        [0.44, 0.198, 0.103, 0.003],
        [0.47, 0.188, 0.092, 0.0],
        [0.497, 0.152, 0.081, 0.0],
        [0.522, 0.092, 0.07, 0.003],
        [0.545, 0.067, 0.064, 0.006],
        [0.64, 0.061, 0.059, 0.008],
      ],
    }),
  };

  for (const side of [1, -1]) {
    const start = SHOULDER.clone().setX(SHOULDER.x * side);
    const dir = new THREE.Vector3(0.24 * side, -1, 0.05).normalize();
    body[side > 0 ? "armL" : "armR"] = new Tube({
      kind: "arm",
      side,
      origin: start,
      axis: dir,
      length: 0.62,
      outward: side,
      // Deltoid, biceps, elbow, forearm swell, wrist: a slim 1.87 m build
      // (biceps ~32 cm, wrist ~19 cm round).
      keys: [
        [-0.08, 0.062, 0.06, 0],
        [0.0, 0.058, 0.056, 0],
        [0.16, 0.051, 0.05, 0],
        [0.46, 0.045, 0.043, 0],
        [0.6, 0.044, 0.04, 0],
        [0.8, 0.037, 0.033, 0],
        [1.0, 0.033, 0.029, 0],
      ],
    });

    const hip = HIP.clone().setX(HIP.x * side);
    const legDir = new THREE.Vector3(0.012 * side, -1, 0).normalize();
    body[side > 0 ? "legL" : "legR"] = new Tube({
      kind: "leg",
      side,
      origin: hip,
      axis: legDir,
      length: hip.y - FLOOR_Y - 0.035,
      outward: side,
      // Anatomical leg: thigh, knee, calf, ankle. Trousers hang from it (figure.js).
      keys: [
        [-0.08, 0.112, 0.118, 0],
        [0.0, 0.104, 0.11, 0],
        [0.25, 0.088, 0.093, 0.004],
        [0.5, 0.064, 0.068, 0.006],
        [0.64, 0.066, 0.07, -0.004],
        [0.86, 0.048, 0.05, 0.0],
        [1.0, 0.045, 0.048, 0.006],
      ],
    });
  }

  return body;
}
