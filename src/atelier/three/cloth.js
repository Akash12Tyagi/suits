import * as THREE from "three";

/*
 * Garment pieces carry two shapes per vertex:
 *   position  — the piece closed around the body (its final, "folded on" state)
 *   flatPos   — the piece laid out flat like a pattern piece, or for hinged
 *               pieces (collars, lapels, flaps) standing open about their fold line
 * A per-vertex control point turns the blend into a quadratic Bézier, so hinged
 * pieces swing through an arc instead of collapsing through the fold, and wrapped
 * pieces bow outward instead of cutting through the body. aDelay staggers the
 * blend so cloth closes from its centre (or fold line) outward.
 */

const VERT_PARS = /* glsl */ `
uniform float uFold;
uniform float uTime;
uniform float uFlutter;
uniform float uSpread;
attribute vec3 flatPos;
attribute vec3 flatNormal;
attribute vec3 ctrlPos;
attribute vec3 midNormal;
attribute float aDelay;
float clothW;
`;

const VERT_NORMAL = /* glsl */ `
clothW = clamp(uFold * (1.0 + uSpread) - aDelay * uSpread, 0.0, 1.0);
clothW = clothW * clothW * (3.0 - 2.0 * clothW);
float clothIw = 1.0 - clothW;
vec3 objectNormal = normalize(
  clothIw * clothIw * flatNormal + 2.0 * clothW * clothIw * midNormal + clothW * clothW * normal + 1e-5
);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const VERT_POSITION = /* glsl */ `
vec3 transformed = clothIw * clothIw * flatPos + 2.0 * clothW * clothIw * ctrlPos + clothW * clothW * position;
float clothFlutter = sin(uTime * 2.1 + aDelay * 9.0 + position.y * 6.0) * 0.6
                   + sin(uTime * 3.7 + position.x * 11.0) * 0.4;
transformed += objectNormal * clothFlutter * uFlutter * clothIw * (0.25 + aDelay) * 0.018;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uReveal;
`;

export function createClothUniforms(shared) {
  return {
    uFold: { value: 0 },
    uSpread: { value: 0.55 },
    uReveal: { value: 0 },
    uTime: shared.uTime,
    uFlutter: shared.uFlutter,
  };
}

export function clothMaterial(params, uniforms) {
  const m = new THREE.MeshPhysicalMaterial(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <beginnormal_vertex>", VERT_NORMAL)
      .replace("#include <begin_vertex>", VERT_POSITION);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal;"
      );
  };
  m.customProgramCacheKey = () => "atelier-cloth-1";
  return m;
}

// Smooth 3D value noise for the soft undulation real cloth has once worn.
function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (v) => v * v * (3 - 2 * v);
  const fx = s(x - xi);
  const fy = s(y - yi);
  const fz = s(z - zi);
  const l = THREE.MathUtils.lerp;
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz
  );
}
export function clothNoise(p) {
  return (
    valueNoise(p.x * 9, p.y * 6, p.z * 9) * 0.65 + valueNoise(p.x * 23, p.y * 17, p.z * 23) * 0.35 - 0.5
  );
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Build a garment patch on a body tube.
 *
 * spec.tRange(u)        → [ta, tb]  vertical extent of column u (allows shaped hems)
 * spec.thetaRange(t)    → [θa, θb]  horizontal extent of row t (necklines, lapels)
 * spec.off | spec.offFn(θ, t, u, v)  ease over the body
 * spec.hinge(θ, t, off) → { pos, pivot, out }  optional: the open state and its fold line
 * spec.centre           { theta, t } optional anchor of the flat layout
 * spec.wrinkle          amplitude (m) of soft surface undulation, default 2.2 mm
 */
export function buildPatch(tube, spec) {
  const cols = spec.cols ?? 40;
  const rows = spec.rows ?? 48;
  const count = (cols + 1) * (rows + 1);
  const uvScale = spec.uvScale ?? 1;

  const thetas = new Float32Array(count);
  const tees = new Float32Array(count);
  const offs = new Float32Array(count);
  const pos = new Float32Array(count * 3);

  let k = 0;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const [ta, tb] = spec.tRange(u);
      const t = tube.tBetween(ta, tb, v);
      const [a, b] = spec.thetaRange(t);
      const th = a + (b - a) * u;
      let off = spec.offFn ? spec.offFn(th, t, u, v) : spec.off ?? 0.01;
      const wr = spec.wrinkle ?? 0.0022;
      if (wr > 0) {
        tube.point(th, t, off, _p);
        off += clothNoise(_p) * wr;
      }
      tube.point(th, t, off, _p);
      thetas[k] = th;
      tees[k] = t;
      offs[k] = off;
      pos.set([_p.x, _p.y, _p.z], k * 3);
      k++;
    }
  }

  // Flat-layout frame at the piece centre.
  let tc;
  let thc;
  if (spec.centre) {
    tc = spec.centre.t;
    thc = spec.centre.theta;
  } else {
    const [ta, tb] = spec.tRange(0.5);
    tc = tube.tBetween(ta, tb, 0.5);
    const [a, b] = spec.thetaRange(tc);
    thc = (a + b) * 0.5;
  }
  const offC = spec.offFn ? spec.offFn(thc, tc, 0.5, 0.5) : spec.off ?? 0.01;
  const Pc = tube.point(thc, tc, offC, new THREE.Vector3());
  const T0 = tube.tangentTheta(thc, tc, offC, new THREE.Vector3()).normalize();
  const U0 = tube
    .point(thc, tc + 0.01, offC, new THREE.Vector3())
    .sub(tube.point(thc, tc - 0.01, offC, _q))
    .normalize();
  U0.addScaledVector(T0, -U0.dot(T0)).normalize();
  const N0 = new THREE.Vector3().crossVectors(T0, U0);
  if (N0.dot(tube.outwardAt(thc, tc, offC, _n)) < 0) N0.negate();
  const arcC = tube.arcAt(tc);

  const flat = new Float32Array(count * 3);
  const ctrl = new Float32Array(count * 3);
  const mid = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const uv = new Float32Array(count * 2);
  const hingeArm = spec.hinge ? new Float32Array(count * 3) : null;
  let maxD = 1e-6;

  for (let i = 0; i < count; i++) {
    const th = thetas[i];
    const t = tees[i];
    const off = offs[i];
    const x = tube.arc(t, off, thc, th);
    const y = tube.arcAt(t) - arcC;
    uv[i * 2] = x * uvScale;
    uv[i * 2 + 1] = y * uvScale;
    _p.fromArray(pos, i * 3);

    if (spec.hinge) {
      const h = spec.hinge(th, t, off);
      flat.set([h.pos.x, h.pos.y, h.pos.z], i * 3);
      const d = h.pos.distanceTo(h.pivot);
      // Control point: the fold line plus twice the arm length straight out.
      _q.copy(h.pivot).addScaledVector(h.out, 2 * d);
      ctrl.set([_q.x, _q.y, _q.z], i * 3);
      // Halfway through a fold the cloth stands straight out; its face then
      // points along the open-state arm.
      _n.copy(h.pos).sub(h.pivot);
      if (_n.lengthSq() > 1e-12) _n.normalize();
      hingeArm.set([_n.x, _n.y, _n.z], i * 3);
      delay[i] = d;
      maxD = Math.max(maxD, d);
    } else {
      _q.copy(Pc).addScaledVector(T0, x).addScaledVector(U0, y);
      flat.set([_q.x, _q.y, _q.z], i * 3);
      // Bow the path outward so wrapping never passes through the body.
      tube.outwardAt(th, t, off, _n);
      const lift = Math.abs(x) * 0.35 + 0.02;
      _q.add(_p).multiplyScalar(0.5).addScaledVector(_n, lift);
      ctrl.set([_q.x, _q.y, _q.z], i * 3);
      const d = Math.hypot(x, y * 0.6);
      delay[i] = d;
      maxD = Math.max(maxD, d);
    }
  }
  for (let i = 0; i < count; i++) delay[i] /= maxD;

  const index = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // Make the wrapped surface face outward.
  const ci = Math.floor(rows / 2) * (cols + 1) + Math.floor(cols / 2);
  _n.fromBufferAttribute(geo.attributes.normal, ci);
  tube.outwardAt(thetas[ci], tees[ci], offs[ci], _q);
  if (_n.dot(_q) < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = tmp;
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
  }

  // Normals of the flat/open shape, from the same winding.
  const flatGeo = new THREE.BufferGeometry();
  flatGeo.setAttribute("position", new THREE.BufferAttribute(flat, 3));
  flatGeo.setIndex(index);
  flatGeo.computeVertexNormals();
  const flatN = flatGeo.attributes.normal.array;

  const wrapN = geo.attributes.normal.array;
  for (let i = 0; i < count; i++) {
    if (hingeArm) {
      _q.fromArray(hingeArm, i * 3);
      if (_q.lengthSq() < 1e-10) _q.fromArray(flatN, i * 3).add(_n.fromArray(wrapN, i * 3));
      if (_q.lengthSq() < 1e-10) _q.fromArray(wrapN, i * 3);
      _q.normalize();
      mid.set([_q.x, _q.y, _q.z], i * 3);
    } else {
      _q.fromArray(flatN, i * 3).add(_n.fromArray(wrapN, i * 3));
      if (_q.lengthSq() < 1e-8) _q.fromArray(wrapN, i * 3);
      _q.normalize();
      mid.set([_q.x, _q.y, _q.z], i * 3);
    }
  }
  flatGeo.dispose();

  geo.setAttribute("flatPos", new THREE.BufferAttribute(flat, 3));
  geo.setAttribute("flatNormal", new THREE.BufferAttribute(new Float32Array(flatN), 3));
  geo.setAttribute("ctrlPos", new THREE.BufferAttribute(ctrl, 3));
  geo.setAttribute("midNormal", new THREE.BufferAttribute(mid, 3));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));

  // Bounds must cover the flat, wrapped and in-between shapes.
  const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  box.union(new THREE.Box3().setFromBufferAttribute(geo.attributes.flatPos));
  box.union(new THREE.Box3().setFromBufferAttribute(geo.attributes.ctrlPos));
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

  return { geometry: geo, centre: Pc.clone(), normal: N0.clone() };
}

/** A fold about a line of constant t (collars, flaps): mirror across that line. */
export function foldAcrossT(tube, tFold, openOff, { outward = true } = {}) {
  return (th, t) => {
    const tOpen = tFold + (tFold - t);
    const pos = tube.point(th, tOpen, openOff, new THREE.Vector3());
    const pivot = tube.point(th, tFold, openOff, new THREE.Vector3());
    const out = tube.outwardAt(th, tFold, openOff, new THREE.Vector3());
    if (!outward) out.negate();
    return { pos, pivot, out };
  };
}

/** A fold about a line of θ that varies with t (lapels): mirror across θroll(t). */
export function foldAcrossTheta(tube, thetaRoll, openOff) {
  return (th, t) => {
    const r = thetaRoll(t);
    const pos = tube.point(r + (r - th), t, openOff, new THREE.Vector3());
    const pivot = tube.point(r, t, openOff, new THREE.Vector3());
    const out = tube.outwardAt(r, t, openOff, new THREE.Vector3());
    return { pos, pivot, out };
  };
}
