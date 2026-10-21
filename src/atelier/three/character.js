import * as THREE from "three";
import { attachToBone, skinWeights } from "./rig.js";
import { shoeGeometry } from "./props.js";
import {
  eyeballs,
  hairGeometry,
  hairMaterial,
  handBones,
  handGeometry,
  headGeometry,
  poseHumanHand,
  skinMaterial,
} from "./human.js";

/*
 * The wearer, a member of the cast (characters.js): sculpted head with hair
 * and eyes, skinned hands with finger bones, and a skinned body under the
 * clothes. Every part can also render as the glowing hologram from the opening
 * shot; look.glow and look.solid cross-fade the two.
 */

// Where the head sits on the rig: chin just above the collar.
const HEAD_AT = new THREE.Vector3(0, 0.704, 0.012);
const HEAD_SCALE = 1.04;

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
  geo.userData.tube = true;
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
   * @param rig          skeleton from createRig
   * @param body         the body tubes
   * @param opts.cast    a member of CAST (characters.js)
   * @param opts.full    build the hologram and the bare body (hero only)
   * @param opts.quality 1 for close-ups, 0 for figures seen at a distance
   */
  constructor(rig, body, { cast, full = true, quality = 1 } = {}) {
    this.rig = rig;
    this.full = full;
    this.cast = cast;
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
    this.skinMat = skinMaterial(cast.skin, this.solidReveal);
    this.bodyMat = skinMaterial(cast.skin, this.solidReveal, { painted: false });
    this.hairMat = hairMaterial(cast.hair, this.solidReveal);

    this.solids = [];
    this.glows = [];
    this.group = new THREE.Group();

    // `bind` places geometry modelled in its own frame (the hands) at its
    // bind-pose transform; the mesh sits there and skins from there.
    const skinnedPair = (geo, skeleton, bind = new THREE.Matrix4(), material = this.bodyMat) => {
      const solid = new THREE.SkinnedMesh(geo, material);
      solid.castShadow = true;
      solid.receiveShadow = true;
      this.solids.push(solid);
      const meshes = [solid];
      if (full) {
        const glow = new THREE.SkinnedMesh(geo, this.glowMat);
        glow.renderOrder = 3;
        this.glows.push(glow);
        meshes.push(glow);
      }
      for (const m of meshes) {
        m.frustumCulled = false;
        bind.decompose(m.position, m.quaternion, m.scale);
        m.updateMatrix();
        m.bind(skeleton, bind.clone());
        m.bindMode = THREE.DetachedBindMode;
        this.group.add(m);
      }
    };

    // Torso and neck always (the neck shows above the collar); limbs for the hero.
    skinnedPair(tubeSkinGeometry(rig, body.torso, full ? -0.24 : 0.36, 0.66, 64, full ? 90 : 28), rig.skeleton);
    if (full) {
      for (const s of ["L", "R"]) {
        skinnedPair(tubeSkinGeometry(rig, body["arm" + s], -0.06, 1.02, 32, 56), rig.skeleton);
        skinnedPair(tubeSkinGeometry(rig, body["leg" + s], -0.08, 0.99, 32, 64, { foot: true }), rig.skeleton);
      }
    }

    // Rigid parts on bones, each with its hologram twin.
    const rigid = (geo, bone, material, place) => {
      const solid = new THREE.Mesh(geo, material);
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

    // Head, hair and eyes.
    const atHead = (m) => {
      m.position.copy(HEAD_AT);
      m.scale.setScalar(HEAD_SCALE);
    };
    rigid(headGeometry(cast, quality), "head", this.skinMat, atHead);
    rigid(hairGeometry(cast.hairStyle, quality), "head", this.hairMat, atHead);
    const eyes = eyeballs(cast.eyes, this.solidReveal);
    eyes.group.position.copy(HEAD_AT);
    eyes.group.scale.setScalar(HEAD_SCALE);
    attachToBone(rig, "head", eyes.group);
    this.solids.push(...eyes.eyes);
    this.eyeMat = eyes.material;

    // Hands: a small skeleton of finger bones under each wrist.
    rig.root.updateMatrixWorld(true);
    const hands = handGeometry();
    this.hands = {};
    for (const [s, side] of [
      ["L", 1],
      ["R", -1],
    ]) {
      const hb = handBones(side);
      const dir = body["arm" + s].axis.clone();
      hb.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      hb.root.position.copy(rig.bind["hand" + s]);
      attachToBone(rig, "hand" + s, hb.root);
      rig.root.updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton(hb.list);
      skinnedPair(side > 0 ? hands.left : hands.right, skeleton, hb.root.matrixWorld.clone(), this.skinMat);
      this.hands[s] = hb;
      poseHumanHand(hb, 0.24);
    }

    // Bare feet for the hologram; shoes replace them.
    this.feet = [];
    if (full) {
      const foot = shoeGeometry();
      for (const s of ["L", "R"]) {
        const { solid, glow } = rigid(foot, "foot" + s, this.bodyMat, (m) => {
          m.position.copy(rig.bind["foot" + s]).add(new THREE.Vector3(0, -0.0875, 0));
          m.scale.set(0.9, 0.85, 0.94);
        });
        this.feet.push(solid, glow);
      }
    }
  }

  setHandPose(curl, pinchL = 0, pinchR = 0) {
    poseHumanHand(this.hands.L, curl, pinchL);
    poseHumanHand(this.hands.R, curl, pinchR);
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
    // Heads, hair and hands are shared by every figure and kept for the
    // session; only this character's own geometry and materials go.
    this.group.traverse((o) => {
      if (o.geometry?.userData.tube) o.geometry.dispose();
    });
    for (const m of [this.glowMat, this.skinMat, this.bodyMat, this.hairMat, this.eyeMat]) m.dispose();
  }
}
