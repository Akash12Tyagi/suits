import * as THREE from "three";
import {
  V3,
  capsule,
  ellipsoid,
  noise3,
  roundBox,
  sculpt,
  sdCapsule,
  sdRoundBox,
  sphere,
  surfaceNets,
  smax,
  taper,
} from "./sdf.js";
import { monotoneSpline } from "./body.js";

/*
 * Human parts sculpted as signed-distance fields: head (skull, jaw, brow,
 * sockets and lids, nose with nostrils, lips, ears, neck), hair styles, eyes,
 * and a skinned hand. Skin detail — brows, beard shadow, lip colour, warmth at
 * the nose, cheeks and ears — is painted into vertex colours.
 *
 * Head space: origin at ear level in the middle of the head, +Z is the face.
 */

const sm = THREE.MathUtils.smoothstep;
const g = (x, s) => Math.exp(-(x * x) / (s * s));
const _p = new THREE.Vector3();

// ------------------------------------------------------------------ head

const EYE = V3(0.0312, -0.002, 0.0785);
export const EYE_RADIUS = 0.0118;

/*
 * The face is lofted from profile keys rather than assembled from blobs, so its
 * silhouette is drawn directly: [y, half-width, front z] from brow to chin,
 * with a jaw underside plane that gives the jawline its edge.
 */
const FACE_KEYS = monotoneSpline([
  [-0.118, 0.027, 0.08],
  [-0.106, 0.041, 0.089],
  [-0.09, 0.053, 0.087],
  [-0.07, 0.059, 0.09],
  [-0.055, 0.0645, 0.089],
  [-0.035, 0.068, 0.089],
  [-0.014, 0.07, 0.089],
  [0.0, 0.069, 0.09],
  [0.014, 0.068, 0.096],
  [0.035, 0.066, 0.092],
  [0.055, 0.063, 0.086],
]);
// Jaw underside: from under the chin back and up to the angle of the jaw.
const JAW_A = [-0.118, 0.075];
const JAW_N = [-0.9285, -0.3714];

function faceLoft(J, C, K) {
  return (p) => {
    const y = Math.min(Math.max(p.y, -0.12), 0.055);
    let [w, f] = FACE_KEYS(y);
    w *= 1 + (J - 1) * sm(-y, 0.04, 0.08) + (K - 1) * g(y + 0.014, 0.02);
    f += (C - 1) * 0.03 * sm(-y, 0.085, 0.11);
    const front = p.z >= 0;
    const rz = front ? f : 0.075;
    const n = front ? 2.25 : 2.0;
    const x = Math.abs(p.x) / w;
    const z = Math.abs(p.z) / rz;
    const r = Math.pow(Math.pow(x, n) + Math.pow(z, n), 1 / n);
    let d = (r - 1) * Math.min(w, rz);
    const under = (p.y - JAW_A[0]) * JAW_N[0] + (p.z - JAW_A[1]) * JAW_N[1];
    d = smax(d, under, 0.009);
    return smax(d, p.y - 0.055, 0.02);
  };
}

function headField(d) {
  const J = d.jaw ?? 1;
  const C = d.chin ?? 1;
  const N = d.nose ?? 1;
  const K = d.cheek ?? 1;
  const B = d.brow ?? 1;
  const add = (part, k, mirror = false) => ({ op: "add", d: part, k, mirror });
  const cut = (part, k, mirror = false) => ({ op: "cut", d: part, k, mirror });
  // Laid out on the facial thirds: hairline +0.065, brow +0.014, nose base
  // -0.052, chin -0.118; eyes on the horizontal midline of the head.
  const parts = [
    // Cranium, and the lofted face.
    add(ellipsoid(V3(0, 0.035, -0.014), V3(0.0755, 0.089, 0.098)), 0),
    add(faceLoft(J, C, K), 0.022),
    // Zygomatic arch; the chin's mental protuberance.
    add(ellipsoid(V3(0.056, -0.012, 0.05), V3(0.01 * K, 0.009, 0.022)), 0.024, true),
    add(ellipsoid(V3(0, -0.103 * C, 0.08), V3(0.021, 0.012, 0.012)), 0.01),
    add(ellipsoid(V3(0, -0.058, 0.086), V3(0.017, 0.012, 0.012)), 0.012), // philtrum
    // Mentolabial fold between the lower lip and the chin.
    cut(capsule(V3(-0.011, -0.0865, 0.093), V3(0.011, -0.0865, 0.093), 0.0026), 0.006),
    // Brow ridge; temples gently flattened.
    add(capsule(V3(0, 0.016, 0.093), V3(0.046, 0.014, 0.081), 0.0088 * B), 0.012, true),
    cut(ellipsoid(V3(0.08, 0.028, 0.036), V3(0.008, 0.018, 0.018)), 0.012, true),
    // Eye sockets, lids around the eyeball, and the eye opening.
    cut(sphere(V3(EYE.x, 0.0, 0.096), 0.017), 0.01, true),
    add(sphere(EYE, 0.0126), 0.004, true),
    cut(ellipsoid(V3(EYE.x, EYE.y - 0.0002, 0.0915), V3(0.0128, 0.0056, 0.012)), 0.0018, true),
    // Upper lid fold, which shades the top of the iris; a soft lower lid.
    add(capsule(V3(EYE.x - 0.009, EYE.y + 0.0062, 0.0895), V3(EYE.x + 0.009, EYE.y + 0.0058, 0.0875), 0.0021), 0.003, true),
    add(capsule(V3(EYE.x - 0.008, EYE.y - 0.0078, 0.0885), V3(EYE.x + 0.009, EYE.y - 0.0072, 0.0868), 0.0016), 0.004, true),
    // Nose: bridge, tip, alae; small nostrils on the underside.
    add(capsule(V3(0, 0.012, 0.095), V3(0, -0.032, 0.109 + 0.004 * (N - 1)), 0.0072), 0.01),
    add(sphere(V3(0, -0.039, 0.1085 + 0.006 * (N - 1)), 0.0088), 0.008),
    add(sphere(V3(0.0108, -0.0462, 0.1015), 0.0066), 0.006, true),
    cut(ellipsoid(V3(0.0064, -0.0522, 0.1045), V3(0.003, 0.0018, 0.0036)), 0.003, true),
    // Lips, fuller at the centre (the line between them is painted, not carved).
    add(capsule(V3(0, -0.0655, 0.0975), V3(0.0175, -0.0688, 0.0885), 0.0044), 0.005, true),
    add(capsule(V3(0, -0.0755, 0.0965), V3(0.0155, -0.073, 0.0875), 0.0052), 0.005, true),
    // Ears, top level with the brow, bottom with the nose; the concha.
    add(ellipsoid(V3(0.076, -0.016, -0.014), V3(0.0105, 0.031, 0.02)), 0.006, true),
    cut(ellipsoid(V3(0.0825, -0.02, -0.008), V3(0.0055, 0.016, 0.01)), 0.003, true),
    // Neck set back under the skull, the larynx, the sternomastoids.
    add(capsule(V3(0, -0.07, -0.032), V3(0, -0.2, -0.018), 0.056), 0.012),
    add(sphere(V3(0, -0.13, 0.024), 0.0085), 0.01),
    add(capsule(V3(0.046, -0.07, -0.03), V3(0.016, -0.2, 0.03), 0.011), 0.014, true),
  ];
  const outer = ellipsoid(V3(0, 0.0, 0.01), V3(0.095, 0.13, 0.12));
  const neck = capsule(V3(0, -0.06, -0.025), V3(0, -0.2, -0.02), 0.063);
  return sculpt(parts, (p) => Math.min(outer(p), neck(p)));
}

function paintSkin(geo, d) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const st = d.stubble ?? 0.4;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const ax = Math.abs(p.x);
    const front = sm(p.z, 0.05, 0.08);
    let r = 1;
    let gC = 1;
    let b = 1;
    const n = noise3(p.x * 300, p.y * 300, p.z * 300);
    const fine = noise3(p.x * 1400, p.y * 1400, p.z * 1400);
    // Skin variation, warmth at nose tip, cheeks and ears.
    const v = 0.96 + 0.06 * noise3(p.x * 60, p.y * 60, p.z * 60);
    r *= v;
    gC *= v;
    b *= v;
    const warm =
      0.6 * g(p.y + 0.04, 0.012) * g(p.x, 0.014) * front +
      0.35 * g(ax - 0.048, 0.02) * g(p.y + 0.03, 0.02) * front +
      0.5 * sm(ax, 0.07, 0.085) * g(p.y + 0.016, 0.035);
    gC *= 1 - 0.12 * warm;
    b *= 1 - 0.16 * warm;
    // Lips.
    const lips = Math.max(
      g(p.y + 0.0665, 0.0045) * sm(0.023, 0.016, ax),
      g(p.y + 0.0752, 0.0052) * sm(0.021, 0.014, ax)
    ) * sm(p.z, 0.082, 0.092);
    // The line where the lips meet.
    const mouth = g(p.y + 0.0706, 0.001) * sm(0.022, 0.016, ax) * sm(p.z, 0.084, 0.093);
    r *= 1 - 0.55 * mouth;
    gC *= 1 - 0.6 * mouth;
    b *= 1 - 0.6 * mouth;
    r *= 1 - 0.04 * lips;
    gC *= 1 - 0.24 * lips;
    b *= 1 - 0.2 * lips;
    // Beard shadow: jaw, chin, upper lip, a little down the neck.
    // The cheek line runs from the sideburn down to the corner of the mouth.
    const beardTop = -0.058 + 0.046 * sm(ax, 0.022, 0.07);
    const beard =
      st *
      sm(beardTop - p.y, -0.004, 0.016) *
      sm(p.z, -0.035, 0.0) *
      (1 - sm(-p.y, 0.125, 0.15)) *
      (1 - lips) *
      (0.55 + 0.45 * fine);
    r = r * (1 - 0.3 * beard);
    gC = gC * (1 - 0.29 * beard);
    b = b * (1 - 0.24 * beard);
    // Brows.
    const browY = 0.016 - 0.004 * sm(ax, 0.028, 0.05);
    const brow =
      g(p.y - browY, 0.0044) * sm(ax, 0.008, 0.017) * (1 - sm(ax, 0.046, 0.055)) * sm(p.z, 0.07, 0.085) * (0.6 + 0.4 * n);
    const bk = 1 - 0.86 * Math.min(1, brow * 1.15) * (d.brow ?? 1);
    r *= bk;
    gC *= bk;
    b *= bk;
    // Lash line and lid crease.
    const lid = g(ax - EYE.x, 0.013) * g(p.y - EYE.y, 0.0052) * sm(p.z, 0.088, 0.094);
    const lk = 1 - 0.55 * lid;
    r *= lk;
    gC *= lk;
    b *= lk;
    col.set([r, gC, b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/*
 * Sculpt resolution (cell size in metres) per quality level:
 * 2 close-ups and the lookbook, 1 mid-distance, 0 figures seen from afar.
 */
const STEP = {
  head: [0.0038, 0.003, 0.0025],
  hair: [0.004, 0.0032, 0.0027],
  hand: [0.0031, 0.0025, 0.002],
};

const headCache = new Map();
export function headGeometry(d, quality = 2) {
  const key = `${d.name}-${quality}`;
  if (headCache.has(key)) return headCache.get(key);
  const step = STEP.head[quality];
  const geo = surfaceNets(
    headField(d),
    new THREE.Box3(V3(-0.095, -0.205, -0.125), V3(0.095, 0.13, 0.13)),
    step
  );
  paintSkin(geo, d);
  geo.userData.shared = true;
  headCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------ hair

function hairline(ax, z) {
  const yBack = -0.064 + 0.03 * sm(z, -0.1, -0.04);
  const ySide = ax > 0.052 ? 0.022 - 0.045 * g(z - 0.012, 0.009) : 0.046;
  const yFront = 0.062 + 0.012 * sm(ax, 0.02, 0.052);
  let y = yBack + (ySide - yBack) * sm(z, -0.05, -0.012);
  y = y + (yFront - y) * sm(z, 0.03, 0.062);
  return y;
}

/*
 * Hair is the scalp grown outward: a skull-hugging shell thickened by each
 * style's volume. The thickness ramps up from nothing at the hairline, so the
 * hair thins into the skin instead of ending in a hard edge like a cap.
 */
function hairField(style) {
  const add = (part, k) => ({ op: "add", d: part, k });
  const detail = (fn) => ({ op: "detail", d: fn });
  const grow = (vol) => detail((p) => -vol(p) * sm(p.y - hairline(Math.abs(p.x), p.z), 0.0, 0.022));
  const scalp = [
    add(ellipsoid(V3(0, 0.035, -0.014), V3(0.0775, 0.091, 0.1)), 0),
    add(ellipsoid(V3(0, 0.032, 0.03), V3(0.07, 0.064, 0.064)), 0.02),
  ];
  let parts;
  if (style === "wave") {
    // Thick on top and swept back, a loose wave across the head, short at the nape.
    parts = [
      ...scalp,
      grow(
        (p) =>
          0.004 +
          0.017 * sm(p.y, 0.02, 0.1) * (0.75 + 0.25 * sm(p.z, -0.06, 0.05)) +
          0.004 * sm(p.y, 0.0, 0.06) * sm(Math.abs(p.x), 0.04, 0.07)
      ),
      detail((p) => 0.0032 * Math.sin(p.x * 110 + 2.6 * Math.sin(p.z * 34)) * sm(p.y, 0.03, 0.09) + 0.0012 * Math.sin(p.x * 300 + p.z * 50)),
    ];
  } else if (style === "part") {
    // Short, side-parted on the wearer's left, fuller on top and combed across.
    parts = [
      ...scalp,
      grow((p) => 0.0025 + 0.012 * sm(p.y, 0.03, 0.1) * sm(-0.03, 0.012, p.x - 0.028 + 0.05)),
      detail(
        (p) =>
          0.0024 * g(p.x - 0.03, 0.003) * sm(p.y, 0.06, 0.09) * sm(p.z, -0.04, 0.03) +
          0.0011 * Math.sin(p.z * 240 + p.x * 70) * sm(p.y, 0.05, 0.1)
      ),
    ];
  } else {
    parts = [
      ...scalp,
      grow((p) => 0.002 + 0.0035 * sm(p.y, 0.04, 0.11)),
      detail((p) => 0.0007 * Math.sin(p.x * 400 + p.z * 300)),
    ];
  }
  // Only where hair grows, and clear of the ears.
  parts.push({ op: "clip", d: (p) => hairline(Math.abs(p.x), p.z) - p.y, k: 0.003 });
  parts.push({ op: "cut", d: ellipsoid(V3(0.079, -0.016, -0.014), V3(0.016, 0.036, 0.026)), k: 0.004, mirror: true });
  const bound = ellipsoid(V3(0, 0.03, -0.005), V3(0.1, 0.125, 0.125));
  return sculpt(parts, bound);
}

const hairCache = new Map();
export function hairGeometry(style, quality = 2) {
  const key = `${style}-${quality}`;
  if (hairCache.has(key)) return hairCache.get(key);
  const geo = surfaceNets(
    hairField(style),
    new THREE.Box3(V3(-0.1, -0.09, -0.13), V3(0.1, 0.16, 0.13)),
    STEP.hair[quality]
  );
  geo.userData.shared = true;
  hairCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------ materials

/** Skin: wrapped diffuse with a red terminator — a cheap stand-in for subsurface scattering. */
export function skinMaterial(color, reveal, { painted = true } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    vertexColors: painted, // heads and hands carry painted detail; the body does not
    roughness: 0.5,
    sheen: 0.4,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color("#ffd9cc"),
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    const src = THREE.ShaderChunk.lights_physical_pars_fragment;
    const direct = /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/;
    const diffuse = /reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\( material\.diffuseContribution \) \* \( 1\.0 - F \);/;
    let chunk = src;
    if (direct.test(src) && diffuse.test(src)) {
      chunk = src
        .replace(
          direct,
          `float rawNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( rawNL );
	vec3 irradiance = dotNL * directLight.color;
	float wrapNL = saturate( ( rawNL + 0.3 ) / 1.3 );
	vec3 skinIrr = mix( vec3( 1.0, 0.62, 0.52 ), vec3( 1.0 ), smoothstep( -0.2, 0.6, rawNL ) ) * wrapNL * directLight.color;`
        )
        .replace(diffuse, "reflectedLight.directDiffuse += skinIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );");
    } else {
      console.warn("Atelier skin: three.js lighting chunk changed; using standard diffuse.");
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_physical_pars_fragment>", chunk)
      .replace("#include <common>", "#include <common>\nuniform float uReveal;")
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal;");
  };
  m.customProgramCacheKey = () => "atelier-skin-2";
  return m;
}

/** Hair: dark, soft sheen, with strand-direction detail from object position. */
export function hairMaterial(color, reveal) {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.48,
    sheen: 1,
    sheenRoughness: 0.32,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color("#c8a080"), 0.35),
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHairPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHairPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReveal;\nvarying vec3 vHairPos;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // Strands run front to back: ripple the normal across them.
        float strand = sin(vHairPos.x * 2600.0 + sin(vHairPos.z * 90.0) * 6.0) * 0.5 + 0.5;
        float clump = sin(vHairPos.x * 420.0 + vHairPos.z * 30.0) * 0.5 + 0.5;
        normal = normalize(normal + vec3(0.22 * (strand - 0.5) + 0.12 * (clump - 0.5), 0.0, 0.0));`
      )
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal * (0.85 + 0.15 * sin(vHairPos.x * 900.0));");
  };
  m.customProgramCacheKey = () => "atelier-hair-1";
  return m;
}

function eyeTexture(iris) {
  const w = 256;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ad9f90";
  ctx.fillRect(0, 0, w, h);
  // The sphere's pole faces forward, so the iris is the top rows.
  const ic = new THREE.Color(iris);
  const irisRows = h * 0.23;
  for (let y = 0; y < irisRows; y++) {
    const t = y / irisRows;
    const k = t < 0.32 ? 0.04 : t > 0.88 ? 0.45 : 1.25 + 0.3 * Math.sin(t * 20);
    const col = ic.clone().multiplyScalar(k);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let x = 0; x < w; x += 3) ctx.fillRect(x, h * 0.07, 1, h * 0.11);
  ctx.strokeStyle = "rgba(170,70,60,0.18)";
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    const x = Math.random() * w;
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x + 10, h * 0.5, x + Math.random() * 20 - 10, h * 0.2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function eyeballs(iris, reveal) {
  const geo = new THREE.SphereGeometry(EYE_RADIUS, 32, 20);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    map: eyeTexture(iris),
    roughness: 0.4,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.12,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReveal;")
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal;");
  };
  mat.customProgramCacheKey = () => "atelier-eye-1";
  const group = new THREE.Group();
  const eyes = [];
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(geo, mat);
    e.position.set(EYE.x * s, EYE.y, EYE.z - 0.0004);
    e.rotation.y = -s * 0.04; // slight convergence
    group.add(e);
    eyes.push(e);
  }
  return { group, eyes, material: mat };
}

// ------------------------------------------------------------------ hand

/*
 * Hand built hanging (fingers -Y, palm toward -X, thumb +Z) for the left side;
 * the right is mirrored. Skinned to a small chain of finger bones.
 */
const FINGERS = [
  { z: 0.031, y: -0.097, len: [0.043, 0.026, 0.02], r: 0.0094 },
  { z: 0.0105, y: -0.1, len: [0.047, 0.03, 0.022], r: 0.0097 },
  { z: -0.0105, y: -0.098, len: [0.044, 0.028, 0.021], r: 0.0092 },
  { z: -0.03, y: -0.091, len: [0.034, 0.021, 0.018], r: 0.0081 },
];
const THUMB = {
  at: V3(-0.008, -0.03, 0.03),
  dir: V3(-0.32, -0.74, 0.58).normalize(),
  len: [0.038, 0.03, 0.024],
  r: 0.0112,
};

function handJoints() {
  // [start, end, radiusStart, radiusEnd, boneIndex]; bone 0 is the palm/root.
  const segs = [];
  const bones = []; // [parentIndex, position (canonical)]
  bones.push([-1, V3(0, 0, 0)]);
  FINGERS.forEach((f) => {
    let at = V3(0, f.y, f.z);
    let parent = 0;
    f.len.forEach((L, k) => {
      const end = at.clone().add(V3(0, -L, 0));
      const r0 = f.r * (1 - k * 0.1);
      const r1 = f.r * (1 - (k + 1) * 0.1) * (k === 2 ? 0.92 : 1);
      bones.push([parent, at.clone()]);
      const bi = bones.length - 1;
      segs.push([at.clone(), end.clone(), r0, r1, bi]);
      parent = bi;
      at = end;
    });
  });
  {
    let at = THUMB.at.clone();
    let parent = 0;
    THUMB.len.forEach((L, k) => {
      const end = at.clone().addScaledVector(THUMB.dir, L);
      bones.push([parent, at.clone()]);
      const bi = bones.length - 1;
      segs.push([at.clone(), end.clone(), THUMB.r * (1 - k * 0.1), THUMB.r * (1 - (k + 1) * 0.1), bi]);
      parent = bi;
      at = end;
    });
  }
  return { segs, bones };
}

const handCache = new Map();
export function handGeometry(quality = 2) {
  if (handCache.has(quality)) return handCache.get(quality);
  const { segs, bones } = handJoints();
  const parts = [
    { op: "add", d: roundBox(V3(0, -0.056, 0.0), V3(0.0125, 0.046, 0.041), 0.011), k: 0 },
    { op: "add", d: ellipsoid(V3(0, 0.014, 0), V3(0.019, 0.042, 0.027)), k: 0.014 }, // wrist
    { op: "add", d: ellipsoid(V3(-0.006, -0.046, 0.027), V3(0.013, 0.03, 0.017)), k: 0.01 }, // thenar
    { op: "add", d: ellipsoid(V3(-0.004, -0.062, -0.028), V3(0.011, 0.032, 0.014)), k: 0.01 }, // hypothenar
    ...segs.map(([a, b, ra, rb]) => ({ op: "add", d: taper(a, b, ra, rb), k: 0.006 })),
    // Knuckles: slight bumps on the back of the hand.
    ...FINGERS.map((f) => ({ op: "add", d: sphere(V3(0.006, f.y + 0.002, f.z), 0.008), k: 0.006 })),
  ];
  const field = sculpt(parts, roundBox(V3(0, -0.08, 0.015), V3(0.03, 0.12, 0.07), 0.02));
  const geo = surfaceNets(field, new THREE.Box3(V3(-0.062, -0.218, -0.064), V3(0.036, 0.06, 0.104)), STEP.hand[quality]);

  // Skin weights: inverse-distance to each bone's segment.
  const pos = geo.attributes.position;
  const si = new Uint16Array(pos.count * 4);
  const sw = new Float32Array(pos.count * 4);
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const ws = [];
    ws.push([0, 1 / Math.pow(Math.max(sdRoundBox(p, V3(0, -0.05, 0.0), V3(0.012, 0.042, 0.038), 0.01) + 0.01, 0.002), 4)]);
    for (const [a, b, ra, , bi] of segs) {
      const d = Math.max(sdCapsule(p, a, b, ra) + ra, 0.002);
      ws.push([bi, 1 / Math.pow(d, 4)]);
    }
    ws.sort((x, y) => y[1] - x[1]);
    const top = ws.slice(0, 4);
    const sum = top.reduce((s, w) => s + w[1], 0);
    top.forEach(([b, w], k) => {
      si[i * 4 + k] = b;
      sw[i * 4 + k] = w / sum;
    });
    // Nails: paler, on the back of each fingertip.
    let nail = 0;
    for (const f of FINGERS) {
      const tip = f.y - f.len[0] - f.len[1] - f.len[2] * 0.6;
      nail = Math.max(nail, g(p.y - tip, 0.008) * g(p.z - f.z, 0.006) * sm(p.x, 0.002, 0.007));
    }
    const k = 0.97 + 0.05 * noise3(p.x * 400, p.y * 400, p.z * 400);
    const palmSide = sm(-p.x, 0.0, 0.01);
    col.set([k * (1 + 0.04 * palmSide) + 0.12 * nail, k * (1 - 0.06 * palmSide) + 0.08 * nail, k * (1 - 0.08 * palmSide) + 0.06 * nail], i * 3);
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  // Mirror for the right hand.
  const right = geo.clone();
  const rp = right.attributes.position;
  const rn = right.attributes.normal;
  for (let i = 0; i < rp.count; i++) {
    rp.setX(i, -rp.getX(i));
    rn.setX(i, -rn.getX(i));
  }
  const ia = right.index.array;
  for (let i = 0; i < ia.length; i += 3) {
    const t = ia[i + 1];
    ia[i + 1] = ia[i + 2];
    ia[i + 2] = t;
  }
  geo.userData.shared = true;
  right.userData.shared = true;
  const hands = { left: geo, right, bones };
  handCache.set(quality, hands);
  return hands;
}

/** Bones for one hand; returns { root, list, fingers, thumb, side }. */
export function handBones(side) {
  const { bones } = handJoints();
  const list = bones.map(() => new THREE.Bone());
  bones.forEach(([parent, at], i) => {
    const local = at.clone();
    if (parent >= 0) local.sub(bones[parent][1]);
    local.x *= side;
    list[i].position.copy(local);
    if (parent >= 0) list[parent].add(list[i]);
  });
  const fingers = [];
  for (let f = 0; f < 4; f++) fingers.push([list[1 + f * 3], list[2 + f * 3], list[3 + f * 3]]);
  const thumb = [list[13], list[14], list[15]];
  return { root: list[0], list, fingers, thumb, side };
}

/** Curl the fingers toward the palm: 0 open, 1 fist. pinch closes thumb + index. */
export function poseHumanHand(hand, curl, pinch = 0) {
  const s = hand.side;
  hand.fingers.forEach((joints, f) => {
    const extra = f === 0 ? pinch * 0.55 : pinch * 0.2;
    const c = curl + extra + f * 0.07;
    joints[0].rotation.set(0, 0, -s * c * 0.85);
    joints[1].rotation.set(0, 0, -s * c * 1.2);
    joints[2].rotation.set(0, 0, -s * c * 0.8);
    // A natural fan: fingers spread slightly from the middle.
    joints[0].rotation.x = (f - 1.5) * 0.045 * (1 - curl);
  });
  hand.thumb[0].rotation.set(0, -s * (0.1 + pinch * 0.35), -s * (0.1 + pinch * 0.2));
  hand.thumb[1].rotation.set(0, 0, -s * (0.2 + pinch * 0.45));
  hand.thumb[2].rotation.set(0, 0, -s * (0.15 + pinch * 0.4));
}

// ------------------------------------------------------------------ off-thread sculpting

function unpack({ attrs, index }) {
  const geo = new THREE.BufferGeometry();
  for (const [name, { array, itemSize }] of Object.entries(attrs)) {
    geo.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.userData.shared = true;
  return geo;
}

/**
 * Sculpt every head, hair style and hand set a scene needs — `needs` is a list
 * of [castMember, quality] — in parallel workers, filling the caches
 * headGeometry / hairGeometry / handGeometry read. Falls back to the main
 * thread if workers are unavailable. onProgress(done, total) reports progress.
 */
export async function prepareCast(needs, onProgress = () => {}) {
  const jobs = [];
  const queued = new Set();
  const queue = (key, job) => {
    if (queued.has(key)) return;
    queued.add(key);
    jobs.push({ ...job, key });
  };
  for (const [d, quality] of needs) {
    if (!headCache.has(`${d.name}-${quality}`)) queue(`head:${d.name}-${quality}`, { kind: "head", def: d, quality, cacheKey: `${d.name}-${quality}` });
    if (!hairCache.has(`${d.hairStyle}-${quality}`)) queue(`hair:${d.hairStyle}-${quality}`, { kind: "hair", style: d.hairStyle, quality, cacheKey: `${d.hairStyle}-${quality}` });
    if (!handCache.has(quality)) queue(`hand:${quality}`, { kind: "hand", quality });
  }
  if (!jobs.length) return;
  let done = 0;
  const tick = () => onProgress(++done, jobs.length);

  let workers = [];
  try {
    const n = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 4));
    for (let i = 0; i < n; i++) workers.push(new Worker(new URL("./human.worker.js", import.meta.url), { type: "module" }));
  } catch {
    workers = [];
  }
  if (!workers.length) {
    for (const j of jobs) {
      if (j.kind === "head") headGeometry(j.def, j.quality);
      else if (j.kind === "hair") hairGeometry(j.style, j.quality);
      else handGeometry(j.quality);
      tick();
    }
    return;
  }

  let next = 0;
  const run = (w) =>
    new Promise((resolve, reject) => {
      const step = () => {
        if (next >= jobs.length) return resolve();
        const id = next++;
        const job = jobs[id];
        w.onmessage = ({ data }) => {
          if (job.kind === "head") headCache.set(job.cacheKey, unpack(data.data));
          else if (job.kind === "hair") hairCache.set(job.cacheKey, unpack(data.data));
          else handCache.set(job.quality, { left: unpack(data.data.left), right: unpack(data.data.right), bones: handJoints().bones });
          tick();
          step();
        };
        w.onerror = reject;
        w.postMessage({ ...job, id });
      };
      step();
    });
  try {
    await Promise.all(workers.map(run));
  } finally {
    workers.forEach((w) => w.terminate());
  }
}
