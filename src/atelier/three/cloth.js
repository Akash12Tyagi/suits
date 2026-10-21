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
 *
 * On top of the fold, in order: dynamic creases (elbows, knees), cloth
 * thickness (an inner shell plus edge strips), skirt sway, then the piece's
 * flight transform (uFly) — all in bind space, before three.js skins the result
 * to the skeleton. The same code runs in the shadow depth pass.
 */

const VERT_PARS = /* glsl */ `
uniform float uFold;
uniform float uTime;
uniform float uFlutter;
uniform float uSpread;
uniform float uBend;
uniform vec4 uBends;     // elbowL, elbowR, kneeL, kneeR — for baked (merged) suits
uniform float uThick;
uniform vec3 uSway;
uniform mat4 uFly;
uniform mat3 uFlyN;
attribute vec3 flatPos;
attribute vec3 flatNormal;
attribute vec3 ctrlPos;
attribute vec3 midNormal;
attribute float aDelay;
attribute vec2 aShell;   // x: 1 on the inner surface, y: normal sign
attribute vec2 aCoord;   // θ, metres along the tube
attribute float aCrease; // where bending gathers the cloth
attribute float aSwing;  // how freely the hem swings
attribute float aAO;     // baked contact shading
attribute float aBendId; // 0: this piece's uBend; 1–4: a joint in uBends

float clothWeight() {
  float w = clamp(uFold * (1.0 + uSpread) - aDelay * uSpread, 0.0, 1.0);
  return w * w * (3.0 - 2.0 * w);
}
vec3 clothMorphNormal(float w) {
  float iw = 1.0 - w;
  return normalize(iw * iw * flatNormal + 2.0 * w * iw * midNormal + w * w * normal + 1e-5);
}
vec3 clothMorphPosition(float w, vec3 n) {
  float iw = 1.0 - w;
  vec3 p = iw * iw * flatPos + 2.0 * w * iw * ctrlPos + w * w * position;
  float flutter = sin(uTime * 2.1 + aDelay * 9.0 + position.y * 6.0) * 0.6
                + sin(uTime * 3.7 + position.x * 11.0) * 0.4;
  p += n * flutter * uFlutter * iw * (0.25 + aDelay) * 0.018;
  // Compression folds: rings that rise as the joint bends.
  float ridge = sin(aCoord.y * 92.0 + sin(aCoord.x * 2.0 + aCoord.y * 21.0) * 1.7);
  float bend = aBendId < 0.5 ? uBend : aBendId < 1.5 ? uBends.x : aBendId < 2.5 ? uBends.y : aBendId < 3.5 ? uBends.z : uBends.w;
  p += n * ridge * aCrease * bend * 0.0042 * w;
  p -= n * aShell.x * uThick;
  p += uSway * aSwing * w;
  return p;
}
`;

const VERT_NORMAL = /* glsl */ `
float clothW = clothWeight();
vec3 clothN0 = clothMorphNormal(clothW);
vec3 objectNormal = uFlyN * (clothN0 * aShell.y);
vClothAO = mix(1.0, aAO, clothW);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const VERT_POSITION = /* glsl */ `
vec3 transformed = (uFly * vec4(clothMorphPosition(clothW, clothN0), 1.0)).xyz;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif
`;

const DEPTH_POSITION = /* glsl */ `
float clothW = clothWeight();
vec3 clothN0 = clothMorphNormal(clothW);
vec3 transformed = (uFly * vec4(clothMorphPosition(clothW, clothN0), 1.0)).xyz;
`;

export function createClothUniforms(shared) {
  return {
    uFold: { value: 0 },
    uSpread: { value: 0.55 },
    uReveal: { value: 0 },
    uBend: { value: 0 },
    uBends: shared.uBends ?? { value: new THREE.Vector4() },
    uThick: { value: 0 },
    uFly: { value: new THREE.Matrix4() },
    uFlyN: { value: new THREE.Matrix3() },
    uTime: shared.uTime,
    uFlutter: shared.uFlutter,
    uSway: shared.uSway ?? { value: new THREE.Vector3() },
    uAOStrength: shared.uAOStrength ?? { value: 1 },
  };
}

export function clothMaterial(params, uniforms) {
  const m = new THREE.MeshPhysicalMaterial(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS + "\nvarying float vClothAO;")
      .replace("#include <beginnormal_vertex>", VERT_NORMAL)
      .replace("#include <begin_vertex>", VERT_POSITION);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uReveal;\nuniform float uAOStrength;\nvarying float vClothAO;"
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal * mix(1.0, vClothAO, uAOStrength);"
      );
  };
  m.customProgramCacheKey = () => "atelier-cloth-2";
  return m;
}

/** Depth material so shadows follow the fold, flight and creases. */
export function clothDepthMaterial(uniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", DEPTH_POSITION);
  };
  m.customProgramCacheKey = () => "atelier-cloth-depth-2";
  return m;
}

/** Any standard material can fade in and out of the dark the same way. */
export function withReveal(material, reveal) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReveal;")
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal;");
  };
  material.customProgramCacheKey = () => "atelier-reveal-1";
  return material;
}

// ------------------------------------------------------------------ noise

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
// Soft undulation real cloth has once worn.
export function clothNoise(p) {
  return valueNoise(p.x * 9, p.y * 6, p.z * 9) * 0.65 + valueNoise(p.x * 23, p.y * 17, p.z * 23) * 0.35 - 0.5;
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
 * spec.wrinkle          amplitude (m) of soft surface undulation
 * spec.skin(θ, t, p)    → [[bone, weight] …]  skeleton influences
 * spec.crease(θ, t)     → 0..1 where bending gathers cloth
 * spec.swing(θ, t, p)   → 0..1 how freely the hem swings
 * spec.ao(θ, t, p)      → 0..1 baked contact shading
 * spec.thickness        cloth thickness (m); > 0 builds an inner shell and edges
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
      const wr = spec.wrinkle ?? 0;
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
  const coord = new Float32Array(count * 2);
  const crease = new Float32Array(count);
  const swing = new Float32Array(count);
  const ao = new Float32Array(count).fill(1);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const hingeArm = spec.hinge ? new Float32Array(count * 3) : null;
  const flat2D = new Float32Array(count * 2);
  let maxD = 1e-6;

  for (let i = 0; i < count; i++) {
    const th = thetas[i];
    const t = tees[i];
    const off = offs[i];
    const x = tube.arc(t, off, thc, th);
    const y = tube.arcAt(t) - arcC;
    flat2D[i * 2] = x;
    flat2D[i * 2 + 1] = y;
    uv[i * 2] = x * uvScale;
    uv[i * 2 + 1] = y * uvScale;
    coord[i * 2] = th;
    coord[i * 2 + 1] = t * tube.length;
    _p.fromArray(pos, i * 3);

    if (spec.skin) {
      const ws = spec.skin(th, t, _p);
      ws.forEach(([bi, w], n) => {
        skinIndex[i * 4 + n] = bi;
        skinWeight[i * 4 + n] = w;
      });
    } else {
      skinWeight[i * 4] = 1;
    }
    if (spec.crease) crease[i] = spec.crease(th, t);
    if (spec.swing) swing[i] = spec.swing(th, t, _p);
    if (spec.ao) ao[i] = spec.ao(th, t, _p);

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

  // Wrapped normals, flipping the winding if needed so the surface faces outward.
  const probe = new THREE.BufferGeometry();
  probe.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  probe.setIndex(index);
  probe.computeVertexNormals();
  const ci = Math.floor(rows / 2) * (cols + 1) + Math.floor(cols / 2);
  _n.fromBufferAttribute(probe.attributes.normal, ci);
  tube.outwardAt(thetas[ci], tees[ci], offs[ci], _q);
  if (_n.dot(_q) < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = tmp;
    }
    probe.setIndex(index);
    probe.computeVertexNormals();
  }
  const wrapN = probe.attributes.normal.array;

  const flatGeo = new THREE.BufferGeometry();
  flatGeo.setAttribute("position", new THREE.BufferAttribute(flat, 3));
  flatGeo.setIndex(index);
  flatGeo.computeVertexNormals();
  const flatN = flatGeo.attributes.normal.array;

  for (let i = 0; i < count; i++) {
    if (hingeArm) {
      _q.fromArray(hingeArm, i * 3);
      if (_q.lengthSq() < 1e-10) _q.fromArray(flatN, i * 3).add(_n.fromArray(wrapN, i * 3));
      if (_q.lengthSq() < 1e-10) _q.fromArray(wrapN, i * 3);
    } else {
      _q.fromArray(flatN, i * 3).add(_n.fromArray(wrapN, i * 3));
      if (_q.lengthSq() < 1e-8) _q.fromArray(wrapN, i * 3);
    }
    _q.normalize();
    mid.set([_q.x, _q.y, _q.z], i * 3);
  }

  const base = {
    position: [pos, 3],
    normal: [wrapN, 3],
    uv: [uv, 2],
    flatPos: [flat, 3],
    flatNormal: [flatN, 3],
    ctrlPos: [ctrl, 3],
    midNormal: [mid, 3],
    aDelay: [delay, 1],
    aCoord: [coord, 2],
    aCrease: [crease, 1],
    aSwing: [swing, 1],
    aAO: [ao, 1],
    skinIndex: [skinIndex, 4],
    skinWeight: [skinWeight, 4],
  };

  const thick = spec.thickness ?? 0;
  const geo = new THREE.BufferGeometry();
  if (thick <= 0) {
    for (const [name, [arr, size]] of Object.entries(base)) {
      geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    const shell = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) shell[i * 2 + 1] = 1;
    geo.setAttribute("aShell", new THREE.BufferAttribute(shell, 2));
    geo.setIndex(index);
    geo.addGroup(0, index.length, 0);
  } else {
    // Outer surface, inner surface (reversed winding, normals flipped in the
    // shader), and strips joining them along the boundary.
    const loop = [];
    for (let i = 0; i <= cols; i++) loop.push(i);
    for (let j = 1; j <= rows; j++) loop.push(j * (cols + 1) + cols);
    for (let i = cols - 1; i >= 0; i--) loop.push(rows * (cols + 1) + i);
    for (let j = rows - 1; j >= 1; j--) loop.push(j * (cols + 1));
    const L = loop.length;

    const src = [];
    const shell = [];
    for (let i = 0; i < count; i++) {
      src.push(i);
      shell.push(0, 1);
    }
    for (let i = 0; i < count; i++) {
      src.push(i);
      shell.push(1, -1);
    }
    for (let e = 0; e < L; e++) {
      src.push(loop[e]);
      shell.push(0, 1);
    }
    for (let e = 0; e < L; e++) {
      src.push(loop[e]);
      shell.push(1, 1);
    }
    for (const [name, [arr, size]] of Object.entries(base)) {
      const Ctor = arr.constructor;
      const out = new Ctor(src.length * size);
      src.forEach((s, n) => {
        for (let c = 0; c < size; c++) out[n * size + c] = arr[s * size + c];
      });
      geo.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
    geo.setAttribute("aShell", new THREE.BufferAttribute(new Float32Array(shell), 2));

    // Edge strips face outward across the cut edge, not along the cloth face;
    // otherwise they catch grazing light and sparkle.
    {
      const midP = new THREE.Vector3().fromArray(pos, ci * 3);
      const midF = new THREE.Vector3().fromArray(flat, ci * 3);
      const nA = geo.attributes.normal.array;
      const fA = geo.attributes.flatNormal.array;
      const mA = geo.attributes.midNormal.array;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const n = new THREE.Vector3();
      const ow = new THREE.Vector3();
      const of = new THREE.Vector3();
      const across = (arr, nrm, e, centre, out) => {
        a.fromArray(arr, loop[(e + L - 1) % L] * 3);
        b.fromArray(arr, loop[(e + 1) % L] * 3);
        c.fromArray(arr, loop[e] * 3);
        n.fromArray(nrm, loop[e] * 3);
        out.crossVectors(b.sub(a), n);
        if (out.lengthSq() < 1e-14) out.copy(c).sub(centre);
        if (out.dot(c.clone().sub(centre)) < 0) out.negate();
        return out.normalize();
      };
      for (let e = 0; e < L; e++) {
        across(pos, wrapN, e, midP, ow);
        across(flat, flatN, e, midF, of);
        const m = ow.clone().add(of).normalize();
        for (const base of [2 * count + e, 2 * count + L + e]) {
          nA.set([ow.x, ow.y, ow.z], base * 3);
          fA.set([of.x, of.y, of.z], base * 3);
          mA.set([m.x, m.y, m.z], base * 3);
        }
      }
    }

    const outer = index.slice();
    const inner = [];
    for (let i = 0; i < index.length; i += 3) {
      inner.push(index[i] + count, index[i + 2] + count, index[i + 1] + count);
    }
    // Edge strips: orient them to face away from the piece centre.
    const eo = 2 * count;
    const ei = 2 * count + L;
    const edges = [];
    for (let e = 0; e < L; e++) {
      const a = e;
      const b = (e + 1) % L;
      edges.push(eo + a, eo + b, ei + b, eo + a, ei + b, ei + a);
    }
    {
      const a = new THREE.Vector3().fromArray(pos, loop[0] * 3);
      const b = new THREE.Vector3().fromArray(pos, loop[1] * 3);
      const n = new THREE.Vector3().fromArray(wrapN, loop[0] * 3);
      const inA = a.clone().addScaledVector(n, -thick);
      const faceN = new THREE.Vector3().crossVectors(b.clone().sub(a), inA.clone().sub(a));
      // Outward in the surface plane = away from the piece's middle vertex.
      const midP = new THREE.Vector3().fromArray(pos, ci * 3);
      const outward = a.clone().sub(midP);
      outward.addScaledVector(n, -outward.dot(n));
      if (faceN.dot(outward) < 0) {
        for (let i = 0; i < edges.length; i += 3) {
          const tmp = edges[i + 1];
          edges[i + 1] = edges[i + 2];
          edges[i + 2] = tmp;
        }
      }
    }
    geo.setIndex([...outer, ...inner, ...edges]);
    geo.addGroup(0, outer.length, 0);
    geo.addGroup(outer.length, inner.length, 1);
    geo.addGroup(outer.length + inner.length, edges.length, 2);
  }
  probe.dispose();
  flatGeo.dispose();

  const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  box.union(new THREE.Box3().setFromBufferAttribute(geo.attributes.flatPos));
  box.union(new THREE.Box3().setFromBufferAttribute(geo.attributes.ctrlPos));
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

  return {
    geometry: geo,
    centre: Pc.clone(),
    normal: N0.clone(),
    frame: { T: T0.clone(), U: U0.clone(), N: N0.clone() },
    // Boundary of the flat pattern, for chalk outlines on the cutting table.
    outline: () => {
      const out = [];
      const add = (i) => out.push(new THREE.Vector2(flat2D[i * 2], flat2D[i * 2 + 1]));
      for (let i = 0; i <= cols; i++) add(i);
      for (let j = 1; j <= rows; j++) add(j * (cols + 1) + cols);
      for (let i = cols - 1; i >= 0; i--) add(rows * (cols + 1) + i);
      for (let j = rows - 1; j >= 0; j--) add(j * (cols + 1));
      return out;
    },
  };
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
