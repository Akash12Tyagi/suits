import * as THREE from "three";
import { attachToBone, skinWeights } from "./rig.js";
import { withReveal } from "./cloth.js";
import { shoeGeometry } from "./props.js";

/*
 * The wearer: an articulated atelier mannequin. Head, hands and feet are
 * rigid sculpted parts on their bones; torso, arms and legs are skinned to
 * the rig. Every part renders twice: a solid lacquered graphite surface and
 * the glowing hologram from the opening shot, cross-faded by look.solid / look.glow.
 */

const sm = THREE.MathUtils.smoothstep;
const g = (x, s) => Math.exp(-(x * x) / (s * s));

// ------------------------------------------------------------------ head

export function headGeometry() {
  const geo = new THREE.SphereGeometry(1, 120, 90);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const { x, y, z } = v; // unit sphere: x right, y up, z forward (face)
    const front = sm(z, 0.35, 0.95);
    const ax = Math.abs(x);

    let X = x * 0.074;
    let Y = y * 0.114;
    let Z = z * 0.098;

    // Cranium fuller behind and above; face flatter.
    if (z < 0) Z *= 1.07;
    Y += 0.006 * sm(y, 0.2, 1) * (z < 0 ? 1 : 0.5);
    Z -= 0.01 * sm(z, 0.6, 1.0);

    // Jaw and chin: narrow toward a defined chin, with a firm jawline.
    const low = sm(-y, 0.05, 0.9);
    X *= 1 - 0.3 * low * (0.55 + 0.45 * Math.max(z, 0));
    Z += 0.014 * g(y + 0.8, 0.16) * Math.max(z, 0);
    Z *= 1 - 0.22 * sm(-y, 0.5, 0.98) * (z < 0.2 ? 1 : 0.35);

    // Brow ridge, eye sockets, cheekbones.
    const n = new THREE.Vector3(X, Y, Z).normalize();
    let d = 0;
    d += 0.0065 * g(y - 0.24, 0.08) * g(x, 0.6) * front;
    d -= 0.0075 * g(ax - 0.36, 0.17) * g(y - 0.1, 0.11) * front;
    d += 0.0055 * g(ax - 0.55, 0.16) * g(y + 0.04, 0.12) * sm(z, 0.2, 0.7);

    // Nose: a straight bridge widening to the base, sharply undercut.
    const ramp = sm(y, 0.17, -0.12) * (1 - sm(y, -0.13, -0.24));
    const width = 0.08 + 0.09 * sm(y, 0.1, -0.15);
    d += 0.024 * ramp * g(x, width) * sm(z, 0.75, 0.97);

    // Lips and the line between them.
    d += 0.0055 * g(x, 0.3) * g(y + 0.39, 0.065) * front;
    d -= 0.0022 * g(x, 0.26) * g(y + 0.375, 0.012) * front;

    // Ears.
    d += 0.017 * g(y - 0.05, 0.17) * g(z + 0.06, 0.17) * sm(ax, 0.82, 1.0);

    X += n.x * d;
    Y += n.y * d;
    Z += n.z * d;
    p.setXYZ(i, X, Y, Z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ hands

function roundedBox(w, h, d, r, seg = 5) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z)
    );
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 0) v.copy(c).addScaledVector(dir.normalize(), r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A jointed hand for side s (+1 left, -1 right). Built hanging: fingers point
 * down (-Y), the palm faces the body (-s·X), the thumb points forward (+Z).
 * Returns the group plus its finger joints so poses can curl them.
 */
export function buildHand(side, material) {
  const s = side;
  const group = new THREE.Group();
  const palm = roundedBox(0.026, 0.098, 0.084, 0.011);
  palm.translate(0, -0.056, 0.004);
  const palmMesh = new THREE.Mesh(palm, material);
  group.add(palmMesh);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.029, 0.04, 20), material);
  wrist.scale.set(0.75, 1, 1.25);
  wrist.position.y = -0.006;
  group.add(wrist);

  const fingers = [];
  const defs = [
    { z: 0.031, len: [0.044, 0.027, 0.021], r: 0.0088 },
    { z: 0.0105, len: [0.049, 0.031, 0.023], r: 0.0091 },
    { z: -0.0105, len: [0.046, 0.029, 0.022], r: 0.0086 },
    { z: -0.031, len: [0.036, 0.022, 0.019], r: 0.0075 },
  ];
  for (const d of defs) {
    const joints = [];
    let parent = group;
    let y = -0.103;
    d.len.forEach((len, k) => {
      const j = new THREE.Group();
      j.position.set(0, k === 0 ? y : -d.len[k - 1], k === 0 ? d.z : 0);
      const r = d.r * (1 - k * 0.09);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(len - r * 1.4, 0.004), 4, 10), material);
      seg.position.y = -len / 2;
      j.add(seg);
      parent.add(j);
      joints.push(j);
      parent = j;
      y = 0;
    });
    fingers.push(joints);
  }
  // Thumb: rooted at the heel of the palm, angled forward and across.
  const thumb = [];
  {
    let parent = group;
    const lens = [0.042, 0.03, 0.025];
    lens.forEach((len, k) => {
      const j = new THREE.Group();
      if (k === 0) {
        j.position.set(-0.008 * s, -0.035, 0.036);
        j.rotation.set(0.75, 0, 0.25 * s);
      } else {
        j.position.set(0, -lens[k - 1], 0);
      }
      const r = 0.0105 * (1 - k * 0.1);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(len - r * 1.4, 0.004), 4, 10), material);
      seg.position.y = -len / 2;
      j.add(seg);
      parent.add(j);
      thumb.push(j);
      parent = j;
    });
  }
  return { group, fingers, thumb, side: s };
}

/** Curl the fingers toward the palm: 0 open, 1 fist. pinch closes thumb+index. */
export function poseHand(hand, curl, pinch = 0) {
  const s = hand.side;
  hand.fingers.forEach((joints, f) => {
    const extra = f === 0 ? pinch * 0.6 : pinch * 0.25;
    const c = curl + extra + f * 0.06;
    joints[0].rotation.z = -s * c * 0.9;
    joints[1].rotation.z = -s * c * 1.25;
    joints[2].rotation.z = -s * c * 0.9;
  });
  hand.thumb[1].rotation.z = -s * (0.25 + pinch * 0.55);
  hand.thumb[2].rotation.z = -s * (0.2 + pinch * 0.45);
  hand.thumb[0].rotation.y = -s * pinch * 0.35;
}

// ------------------------------------------------------------------ body skin

function tubeSkinGeometry(rig, tube, t0, t1, cols, rows, opts) {
  const pos = [];
  const skinI = [];
  const skinW = [];
  const idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = tube.tBetween(t0, t1, j / rows);
    for (let i = 0; i <= cols; i++) {
      const th = (i / cols) * Math.PI * 2;
      const p = tube.point(th, t, 0);
      pos.push(p.x, p.y, p.z);
      const w = skinWeights(rig, tube, th, t, p, opts);
      for (let n = 0; n < 4; n++) {
        skinI.push(w[n]?.[0] ?? 0);
        skinW.push(w[n]?.[1] ?? 0);
      }
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinI, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinW, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Make sure the surface faces outward (tube winding depends on the frame).
  const n = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, Math.floor(rows / 2) * (cols + 1));
  const p = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, Math.floor(rows / 2) * (cols + 1));
  const c = tube.centre(tube.tBetween(t0, t1, 0.5));
  if (n.dot(p.sub(c)) < 0) {
    const a = geo.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const tmp = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = tmp;
    }
    geo.computeVertexNormals();
  }
  return geo;
}

const GLOW_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vNormalV = normalize(normalMatrix * objectNormal);
  vViewV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uScan;
uniform float uGlow;
uniform float uTime;
uniform vec3 uColor;
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  float scanY = mix(-1.15, 0.95, uScan);
  if (vWorld.y > scanY) discard;
  vec3 n = normalize(vNormalV);
  float facing = abs(dot(n, normalize(vViewV)));
  float rim = pow(1.0 - facing, 2.4);
  float contour = smoothstep(0.985, 1.0, abs(sin(vWorld.y * 48.0))) * 0.12;
  float edge = exp(-abs(vWorld.y - scanY) * 55.0) * (1.0 - step(0.999, uScan));
  float shimmer = 0.85 + 0.15 * sin(uTime * 1.3 + vWorld.y * 6.0);
  vec3 col = uColor * (0.015 + rim * 1.6 * shimmer + contour * rim * 2.0);
  col += vec3(0.9, 0.95, 1.0) * edge * 1.6;
  gl_FragColor = vec4(col * uGlow, 1.0);
}
`;

export class Character {
  /**
   * @param rig      skeleton from createRig
   * @param body     the body tubes
   * @param opts.full  build the hologram and the bare body (hero only)
   */
  constructor(rig, body, { full = true } = {}) {
    this.rig = rig;
    this.full = full;
    this.uniforms = {
      uScan: { value: 0 },
      uGlow: { value: full ? 1 : 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#c9d6ee") },
    };
    this.solidReveal = { value: full ? 0 : 1 };
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.solidMat = withReveal(
      new THREE.MeshPhysicalMaterial({
        color: "#3b3836",
        roughness: 0.5,
        clearcoat: 0.18,
        clearcoatRoughness: 0.45,
        sheen: 0.35,
        sheenColor: new THREE.Color("#8a8f9c"),
        sheenRoughness: 0.5,
      }),
      this.solidReveal
    );

    this.skinned = [];
    this.solids = [];
    this.glows = [];
    this.group = new THREE.Group();

    const addSkinned = (geo) => {
      const solid = new THREE.SkinnedMesh(geo, this.solidMat);
      solid.castShadow = true;
      solid.receiveShadow = true;
      this.solids.push(solid);
      this.skinned.push(solid);
      this.group.add(solid);
      if (full) {
        const glow = new THREE.SkinnedMesh(geo, this.glowMat);
        glow.renderOrder = 3;
        this.glows.push(glow);
        this.skinned.push(glow);
        this.group.add(glow);
      }
    };
    // Torso and neck always (the neck shows above the collar); limbs for the hero.
    addSkinned(tubeSkinGeometry(rig, body.torso, full ? -0.24 : 0.42, 0.66, 64, full ? 90 : 24));
    if (full) {
      for (const s of ["L", "R"]) {
        addSkinned(tubeSkinGeometry(rig, body["arm" + s], -0.06, 1.02, 32, 56));
        addSkinned(tubeSkinGeometry(rig, body["leg" + s], -0.08, 0.99, 32, 64, { foot: true }));
      }
    }
    for (const m of this.skinned) {
      m.frustumCulled = false;
      m.bind(rig.skeleton, new THREE.Matrix4());
      m.bindMode = THREE.DetachedBindMode;
    }

    // Rigid parts on bones, each with its hologram twin.
    const rigid = (geo, bone, place) => {
      const solid = new THREE.Mesh(geo, this.solidMat);
      solid.castShadow = true;
      solid.receiveShadow = true;
      place(solid);
      attachToBone(rig, bone, solid);
      this.solids.push(solid);
      let glow = null;
      if (full) {
        glow = new THREE.Mesh(geo, this.glowMat);
        glow.renderOrder = 3;
        place(glow);
        attachToBone(rig, bone, glow);
        this.glows.push(glow);
      }
      return { solid, glow };
    };

    const head = headGeometry();
    rigid(head, "head", (m) => m.position.set(0, 0.738, 0.022));

    this.hands = {};
    for (const [s, side] of [
      ["L", 1],
      ["R", -1],
    ]) {
      const hand = buildHand(side, this.solidMat);
      const dir = body["arm" + s].axis.clone();
      hand.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      hand.group.position.copy(rig.bind["hand" + s]);
      attachToBone(rig, "hand" + s, hand.group);
      hand.group.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          this.solids.push(o);
        }
      });
      if (full) {
        const glowHand = buildHand(side, this.glowMat);
        glowHand.group.quaternion.copy(hand.group.quaternion);
        glowHand.group.position.copy(rig.bind["hand" + s]);
        attachToBone(rig, "hand" + s, glowHand.group);
        glowHand.group.traverse((o) => o.isMesh && (o.renderOrder = 3) && this.glows.push(o));
        this.hands[s + "glow"] = glowHand;
      }
      this.hands[s] = hand;
      poseHand(hand, 0.32);
      if (this.hands[s + "glow"]) poseHand(this.hands[s + "glow"], 0.32);
    }

    // Bare feet for the hologram; shoes replace them.
    this.feet = [];
    if (full) {
      const foot = shoeGeometry();
      for (const s of ["L", "R"]) {
        const { solid, glow } = rigid(foot, "foot" + s, (m) => {
          m.position.copy(rig.bind["foot" + s]).add(new THREE.Vector3(0, -0.077, 0));
          m.scale.set(0.9, 0.85, 0.94);
        });
        this.feet.push(solid, glow);
      }
    }
  }

  setHandPose(curl, pinchL = 0, pinchR = 0) {
    for (const s of ["L", "R"]) {
      const pinch = s === "L" ? pinchL : pinchR;
      poseHand(this.hands[s], curl, pinch);
      if (this.hands[s + "glow"]) poseHand(this.hands[s + "glow"], curl, pinch);
    }
  }

  update(time, { scan, glow, solid, feet }) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScan.value = scan;
    this.uniforms.uGlow.value = glow;
    this.solidReveal.value = solid;
    const showGlow = glow > 0.004 && scan > 0.001;
    for (const m of this.glows) m.visible = showGlow;
    for (const m of this.solids) m.visible = solid > 0.004;
    for (const m of this.feet) m.visible = m.visible && feet > 0.5;
  }

  dispose() {
    const geos = new Set();
    this.group.traverse((o) => o.geometry && geos.add(o.geometry));
    for (const bone of this.rig.list) bone.traverse((o) => o.geometry && geos.add(o.geometry));
    geos.forEach((g) => g.dispose());
    this.glowMat.dispose();
    this.solidMat.dispose();
  }
}
