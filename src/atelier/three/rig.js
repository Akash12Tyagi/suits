import * as THREE from "three";
import { HIP, SHOULDER } from "./body.js";

/*
 * A 20-bone skeleton laid over the body tubes. In the bind pose every bone has
 * an identity rotation, so a bone's bind-space position is simply where it sits
 * on the tubes; garments and the body are skinned to it, and the motion system
 * (motion.js) poses it with FK curves and two-bone IK.
 */

export const BONE_NAMES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "clavL",
  "upperArmL",
  "foreArmL",
  "handL",
  "clavR",
  "upperArmR",
  "foreArmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
];

const PARENT = {
  hips: "root",
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  clavL: "chest",
  upperArmL: "clavL",
  foreArmL: "upperArmL",
  handL: "foreArmL",
  clavR: "chest",
  upperArmR: "clavR",
  foreArmR: "upperArmR",
  handR: "foreArmR",
  thighL: "hips",
  shinL: "thighL",
  footL: "shinL",
  thighR: "hips",
  shinR: "thighR",
  footR: "shinR",
};

export const ELBOW_T = 0.47;
export const KNEE_T = 0.5;
export const ANKLE_T = 0.94;

export function createRig(body) {
  const at = {
    root: new THREE.Vector3(0, 0, 0),
    hips: new THREE.Vector3(0, -0.17, 0),
    spine: new THREE.Vector3(0, 0.02, 0.0),
    chest: new THREE.Vector3(0, 0.24, 0.008),
    neck: new THREE.Vector3(0, 0.52, 0.005),
    head: new THREE.Vector3(0, 0.62, 0.012),
  };
  for (const [s, side] of [
    ["L", 1],
    ["R", -1],
  ]) {
    const arm = body["arm" + s];
    const leg = body["leg" + s];
    at["clav" + s] = new THREE.Vector3(0.035 * side, 0.45, 0.0);
    at["upperArm" + s] = SHOULDER.clone().setX(SHOULDER.x * side);
    at["foreArm" + s] = arm.centre(ELBOW_T);
    at["hand" + s] = arm.centre(1.0);
    at["thigh" + s] = HIP.clone().setX(HIP.x * side);
    at["shin" + s] = leg.centre(KNEE_T);
    at["foot" + s] = leg.centre(ANKLE_T);
  }

  const bones = {};
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    if (name === "root") continue;
    const parent = bones[PARENT[name]];
    parent.add(bones[name]);
    bones[name].position.copy(at[name]).sub(at[PARENT[name]]);
  }
  const root = bones.root;
  root.updateMatrixWorld(true);
  const list = BONE_NAMES.map((n) => bones[n]);
  const skeleton = new THREE.Skeleton(list);
  const index = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const rest = Object.fromEntries(BONE_NAMES.map((n) => [n, bones[n].position.clone()]));

  return { root, bones, list, skeleton, index, bind: at, rest };
}

const sm = THREE.MathUtils.smoothstep;

function pack(entries) {
  // Keep the four strongest influences, normalised.
  const list = entries.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = list.reduce((s, e) => s + e[1], 0) || 1;
  return list.map(([i, w]) => [i, w / sum]);
}

/**
 * Skin weights for a point on a body tube.
 * opts.leg       how much hip-level cloth follows the thighs (trousers 1, jacket skirt ~0.2)
 * opts.shoulder  how much upper torso near the armpit follows the arm
 * opts.foot      whether the bottom of a leg tube follows the foot (bare leg yes, trousers no)
 */
export function skinWeights(rig, tube, theta, t, p, opts = {}) {
  const I = rig.index;
  if (tube.kind === "arm") {
    const s = tube.side > 0 ? "L" : "R";
    const a = sm(t, -0.08, 0.1);
    return pack([
      [I.chest, (1 - a) * 0.55],
      [I["clav" + s], (1 - a) * 0.45],
      [I["upperArm" + s], a * (1 - sm(t, ELBOW_T - 0.06, ELBOW_T + 0.06))],
      [I["foreArm" + s], sm(t, ELBOW_T - 0.06, ELBOW_T + 0.06) * (1 - sm(t, 0.97, 1.03))],
      [I["hand" + s], sm(t, 0.97, 1.03)],
    ]);
  }
  if (tube.kind === "leg") {
    const s = tube.side > 0 ? "L" : "R";
    const h = sm(t, -0.1, 0.06);
    const f = opts.foot === false ? 0 : sm(t, 0.95, 1.0);
    return pack([
      [I.hips, 1 - h],
      [I["thigh" + s], h * (1 - sm(t, KNEE_T - 0.07, KNEE_T + 0.07))],
      [I["shin" + s], sm(t, KNEE_T - 0.07, KNEE_T + 0.07) * (1 - f)],
      [I["foot" + s], f],
    ]);
  }
  // Torso: a vertical blend up the spine, with shoulder and thigh influences.
  const y = p.y;
  const ax = Math.abs(p.x);
  const s = p.x >= 0 ? "L" : "R";
  const chain = [
    [I.hips, 1 - sm(y, -0.12, 0.06)],
    [I.spine, sm(y, -0.12, 0.06) * (1 - sm(y, 0.14, 0.32))],
    [I.chest, sm(y, 0.14, 0.32) * (1 - sm(y, 0.5, 0.57))],
    [I.neck, sm(y, 0.5, 0.57) * (1 - sm(y, 0.62, 0.68))],
    [I.head, sm(y, 0.62, 0.68)],
  ];
  const shoulder = sm(ax, 0.1, 0.2) * sm(y, 0.27, 0.42) * (opts.shoulder ?? 0.4);
  const clav = sm(ax, 0.04, 0.13) * sm(y, 0.4, 0.5) * 0.35 * (1 - sm(y, 0.53, 0.58));
  const leg = sm(-y, 0.2, 0.42) * sm(ax, 0.0, 0.09) * (opts.leg ?? 0);
  const k = Math.max(0, 1 - shoulder - clav - leg);
  return pack([
    ...chain.map(([i, w]) => [i, w * k]),
    [I["upperArm" + s], shoulder],
    [I["clav" + s], clav],
    [I["thigh" + s], leg],
  ]);
}

/** Re-parent an object built in bind space onto a bone, keeping its place. */
export function attachToBone(rig, boneName, obj) {
  obj.position.sub(rig.bind[boneName]);
  rig.bones[boneName].add(obj);
  return obj;
}

export function boneForTorsoY(y) {
  if (y < -0.03) return "hips";
  if (y < 0.23) return "spine";
  if (y < 0.51) return "chest";
  return "neck";
}
