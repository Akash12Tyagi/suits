import * as THREE from "three";

/*
 * Procedural motion for the rig:
 *  - idle: breathing, a slow weight shift, small head drift
 *  - walk: a gait cycle on a treadmill (the street moves, not the figure);
 *    each foot is placed by two-bone IK and travels backward at exactly the
 *    ground speed while planted, so it never slides; heel-strike and toe-off
 *    roll the foot; pelvis bobs, sways and rotates; the chest counter-rotates
 *    and the arms swing opposite the legs with a lagging elbow
 *  - gesture: both arms reach by IK so the right hand straightens the left cuff
 *  - pose: an editorial stance — weight on one leg, the other foot turned
 *    out or crossed in front, one hand in a trouser pocket, the other at the
 *    jacket button, the head turned off-camera
 * Everything blends by weight, and with all weights at 0 the rig is in its
 * bind pose, which is the pose every garment piece was cut for.
 */

const V = THREE.Vector3;
const Q = THREE.Quaternion;
const E = THREE.Euler;
const sm = THREE.MathUtils.smoothstep;
const TAU = Math.PI * 2;

const _A = new V();
const _B = new V();
const _C = new V();
const _T = new V();
const _P = new V();
const _d = new V();
const _e = new V();
const _q = new Q();
const _qw = new Q();
const _qp = new Q();
const _eul = new E();

function aimBone(bone, from, to) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  _q.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_qw));
  bone.updateMatrixWorld(true);
}

/** Classic analytic two-bone IK with a pole target, in world space. */
export function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(_A);
  lower.getWorldPosition(_B);
  end.getWorldPosition(_C);
  const lab = _A.distanceTo(_B);
  const lbc = _B.distanceTo(_C);
  _d.copy(target).sub(_A);
  const dist = THREE.MathUtils.clamp(_d.length(), 1e-4, (lab + lbc) * 0.9995);
  _d.normalize();
  const cosA = THREE.MathUtils.clamp((lab * lab + dist * dist - lbc * lbc) / (2 * lab * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _e.copy(pole).sub(_A);
  _e.addScaledVector(_d, -_e.dot(_d));
  if (_e.lengthSq() < 1e-10) _e.set(0, 0, 1);
  _e.normalize();
  const knee = _P.copy(_A).addScaledVector(_d, cosA * lab).addScaledVector(_e, sinA * lab);
  aimBone(upper, _B.clone().sub(_A), knee.clone().sub(_A));
  end.getWorldPosition(_C);
  _T.copy(_A).addScaledVector(_d, dist);
  aimBone(lower, _C.clone().sub(knee), _T.clone().sub(knee));
}

/** Roll a bone about a world axis so `from` (projected) turns toward `to`. */
function twistAbout(bone, axis, from, to) {
  const a = axis.clone().normalize();
  const f = from.clone().addScaledVector(a, -from.dot(a));
  const t = to.clone().addScaledVector(a, -to.dot(a));
  if (f.lengthSq() < 1e-10 || t.lengthSq() < 1e-10) return;
  f.normalize();
  t.normalize();
  let ang = Math.acos(THREE.MathUtils.clamp(f.dot(t), -1, 1));
  if (new V().crossVectors(f, t).dot(a) < 0) ang = -ang;
  _q.setFromAxisAngle(a, ang);
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_qw));
  bone.updateMatrixWorld(true);
}

function angleOf(q) {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

export class Motion {
  constructor(rig) {
    this.rig = rig;
    this.state = {
      walk: 0, // 0 idle … 1 walking
      gesture: 0, // 0 … 1 adjusting the left cuff
      pose: 0, // 0 … 1 the editorial stance described by poseDef
      breathe: 1,
      lookDown: 0,
      speed: 0.95, // m/s — the street must move at this speed
      cycle: 1.15, // seconds per stride (two steps)
      phase: 0,
    };
    this.out = { elbowL: 0, elbowR: 0, kneeL: 0, kneeR: 0, sway: new V(), groundSpeed: 0 };
    this._phase = 0;
    this._prevHips = new V();
    this._swayVel = new V();
    this._ankleY = rig.bind.footL.y;
    this._saved = {};
    // The stance a lookbook figure holds; see setPose().
    this.poseDef = { weight: "R", pocket: "R", button: "L", cross: false, headYaw: 0.35, headPitch: -0.04 };
    // Which way each palm faces in its hand bone's frame (hands hang palm-in).
    this.palm = {};
    for (const [s, side] of [
      ["L", 1],
      ["R", -1],
    ]) {
      const axis = rig.bind["hand" + s].clone().sub(rig.bind["foreArm" + s]).normalize();
      const q0 = new Q().setFromUnitVectors(new V(0, -1, 0), axis);
      this.palm[s] = new V(-side, 0, 0).applyQuaternion(q0);
    }
  }

  update(time, dt) {
    const { rig, state } = this;
    const b = rig.bones;
    const walk = state.walk;
    const gesture = state.gesture;
    const br = state.breathe;

    this._phase = (this._phase + (dt * walk) / state.cycle) % 1;
    const p = (this._phase + state.phase) % 1;

    // The root bone carries the figure's placement in the world; leave it alone.
    for (const name in b) {
      if (name === "root") continue;
      b[name].quaternion.identity();
      b[name].position.copy(rig.rest[name]);
    }

    // ---- pelvis
    const breath = Math.sin(time * 1.55) * br;
    const shift = Math.sin(time * 0.37) * br;
    const bob = -0.045 + 0.017 * Math.cos(TAU * 2 * (p - 0.3));
    const hips = b.hips;
    const pose = state.pose;
    const pd = this.poseDef;
    const wSide = pd.weight === "L" ? 1 : -1;
    hips.position.x += THREE.MathUtils.lerp(0.006 * shift, 0.02 * Math.sin(TAU * (p - 0.05)), walk) + 0.024 * wSide * pose;
    hips.position.y += THREE.MathUtils.lerp(-0.004 * br, bob, walk) - 0.012 * pose;
    const hipYaw = -0.085 * Math.cos(TAU * p) * walk + (pd.cross ? 0.12 : 0.06) * -wSide * pose;
    const hipRoll = THREE.MathUtils.lerp(0.012 * shift, -0.05 * Math.sin(TAU * (p - 0.05)), walk) + 0.045 * wSide * pose;
    hips.quaternion.setFromEuler(_eul.set(0.03 * walk, hipYaw, hipRoll));

    // ---- spine, chest, head
    b.spine.quaternion.setFromEuler(_eul.set(-0.01 * walk, -hipYaw * 0.45, -hipRoll * 0.5));
    b.chest.quaternion.setFromEuler(
      _eul.set(-0.012 * breath - 0.02 * walk, -hipYaw * 0.9 + 0.11 * Math.cos(TAU * p) * walk, -hipRoll * 0.4)
    );
    b.clavL.position.y += 0.0018 * breath;
    b.clavR.position.y += 0.0018 * breath;
    const look = state.lookDown + gesture * 0.34;
    const turn = pd.headYaw * pose;
    b.neck.quaternion.setFromEuler(_eul.set(look * 0.3 + pd.headPitch * 0.4 * pose, 0.02 * Math.sin(time * 0.23) * br + turn * 0.4, 0));
    b.head.quaternion.setFromEuler(
      _eul.set(
        look * 0.7 + 0.03 * Math.sin(TAU * 2 * p) * walk + pd.headPitch * 0.6 * pose,
        0.04 * Math.sin(time * 0.21) * br * (1 - walk) + turn * 0.6,
        -0.04 * wSide * pose
      )
    );
    rig.root.updateMatrixWorld(true);

    // ---- legs: two-bone IK onto the ground
    const S = state.speed * state.cycle; // stride length
    const stance = 0.6;
    for (const [s, off] of [
      ["L", 0],
      ["R", 0.5],
    ]) {
      const ph = (p + off) % 1;
      let z;
      let lift = 0;
      let pitch = 0;
      if (ph < stance) {
        const u = ph / stance;
        z = (stance * S) / 2 - stance * S * u;
        pitch = 0.22 * (1 - sm(u, 0, 0.16)) - 0.62 * sm(u, 0.62, 1);
      } else {
        const u = (ph - stance) / (1 - stance);
        const e = u * u * (3 - 2 * u);
        z = -(stance * S) / 2 + stance * S * e;
        lift = 0.085 * Math.sin(Math.PI * Math.min(1, u * 1.1));
        pitch = THREE.MathUtils.lerp(-0.62, 0.22, sm(u, 0.15, 0.95));
      }
      // Heel-up pivots about the toe; toe-up pivots about the heel.
      const heel = pitch < 0 ? 0.13 * Math.sin(-pitch) : 0.03 * Math.sin(pitch);
      const bindFoot = rig.bind["foot" + s];
      const target = new V(
        bindFoot.x * THREE.MathUtils.lerp(1, 1.05, walk),
        this._ankleY + (lift + heel) * walk,
        z * walk + (pitch < 0 ? -0.04 * Math.sin(-pitch) : 0) * walk
      );
      // Stance: the weight leg plumb under the hip, the free foot turned out
      // and a little forward — or crossed in front of the other.
      let yaw = 0;
      if (pose > 0.001) {
        const side = s === "L" ? 1 : -1;
        const free = side !== wSide;
        const st = free
          ? pd.cross
            ? new V(-side * 0.03, this._ankleY + 0.012, 0.11)
            : new V(bindFoot.x * 1.55, this._ankleY, 0.075)
          : new V(bindFoot.x * 0.92 + wSide * 0.012, this._ankleY, -0.02);
        target.lerp(st, pose);
        yaw = (free ? (pd.cross ? -side * 0.15 : side * 0.38) : side * 0.12) * pose;
        if (free && pd.cross) pitch = -0.18 * pose;
      }
      rig.root.localToWorld(target);
      const pole = rig.root.localToWorld(new V(bindFoot.x * 1.1, -0.5, 1.2));
      solveTwoBone(b["thigh" + s], b["shin" + s], b["foot" + s], target, pole);

      // Foot attitude: level with the ground, rolled by the gait.
      rig.root.getWorldQuaternion(_qw);
      _qw.multiply(_q.setFromEuler(_eul.set(-pitch * Math.max(walk, pose), yaw, 0)));
      b["shin" + s].getWorldQuaternion(_qp).invert();
      b["foot" + s].quaternion.copy(_qp.multiply(_qw));
      b["foot" + s].updateMatrixWorld(true);
      this.out["knee" + s] = Math.min(1, angleOf(b["shin" + s].quaternion) / 1.2);
    }

    // ---- arms: swing opposite the legs, elbows lag
    for (const [s, side, off] of [
      ["L", 1, 0.5],
      ["R", -1, 0],
    ]) {
      const fwd = Math.cos(TAU * (p - off));
      const swing = -0.3 * fwd * walk;
      b["upperArm" + s].quaternion.setFromEuler(
        _eul.set(swing + 0.03 * breath * (1 - walk), 0, -side * (0.05 * walk + 0.015 * br))
      );
      const bend = 0.16 + 0.2 * walk + 0.22 * Math.max(0, -swing / 0.3) * walk;
      b["foreArm" + s].quaternion.setFromEuler(_eul.set(-bend, 0.0, 0));
      b["hand" + s].quaternion.setFromEuler(_eul.set(-0.05, side * 0.1, 0));
    }
    rig.root.updateMatrixWorld(true);

    if (gesture > 0.001) this._gesture(time, gesture);
    if (pose > 0.001) this._pose(time, pose);

    for (const s of ["L", "R"]) {
      this.out["elbow" + s] = Math.min(1, angleOf(b["foreArm" + s].quaternion) / 1.7);
    }

    // ---- secondary motion: the jacket skirt lags behind the pelvis
    hips.getWorldPosition(_A);
    if (dt > 0) {
      const vel = _B.copy(_A).sub(this._prevHips).divideScalar(Math.max(dt, 1e-3));
      if (vel.lengthSq() > 25) vel.set(0, 0, 0);
      const target = vel.multiplyScalar(-0.045);
      target.z -= 0.012 * walk;
      target.x += -hipYaw * 0.05;
      // Damped spring toward the target.
      const sway = this.out.sway;
      this._swayVel.addScaledVector(_C.copy(target).sub(sway), dt * 60);
      this._swayVel.multiplyScalar(Math.exp(-dt * 9));
      sway.addScaledVector(this._swayVel, dt);
      sway.clampLength(0, 0.03);
    }
    this._prevHips.copy(_A);
    this.out.groundSpeed = state.speed * walk;
  }

  setPose(def) {
    Object.assign(this.poseDef, def);
  }

  _pose(time, w) {
    const { rig } = this;
    const b = rig.bones;
    const pd = this.poseDef;
    const names = ["upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR"];
    for (const n of names) this._saved[n] = (this._saved[n] || new Q()).copy(b[n].quaternion);
    rig.root.getWorldQuaternion(_qw);
    const rootQ = _qw.clone();

    // One hand slides into the trouser pocket, under the jacket skirt.
    const P = pd.pocket === "L" ? 1 : -1;
    const ps = pd.pocket;
    solveTwoBone(
      b["upperArm" + ps],
      b["foreArm" + ps],
      b["hand" + ps],
      rig.root.localToWorld(new V(P * 0.168, -0.15, 0.04)),
      rig.root.localToWorld(new V(P * 0.6, 0.05, -0.5))
    );
    // The other takes the jacket's top button.
    const Bt = pd.button === "L" ? 1 : -1;
    const bs = pd.button;
    const breath = Math.sin(time * 1.55) * 0.004;
    solveTwoBone(
      b["upperArm" + bs],
      b["foreArm" + bs],
      b["hand" + bs],
      rig.root.localToWorld(new V(Bt * 0.085, 0.02 + breath, 0.215)),
      rig.root.localToWorld(new V(Bt * 0.55, -0.35, 0.05))
    );
    for (const [s, want, flex] of [
      [ps, new V(-P, -0.2, 0.25), 0.35],
      [bs, new V(0.0, 0.1, -1), 0.2],
    ]) {
      const fore = b["foreArm" + s];
      const hand = b["hand" + s];
      hand.quaternion.setFromEuler(_eul.set(flex, 0, 0));
      hand.updateMatrixWorld(true);
      const axis = hand.getWorldPosition(new V()).sub(fore.getWorldPosition(new V()));
      const palm = this.palm[s].clone().applyQuaternion(hand.getWorldQuaternion(new Q()));
      twistAbout(fore, axis, palm, want.applyQuaternion(rootQ));
    }
    for (const n of names) {
      _q.copy(b[n].quaternion);
      b[n].quaternion.copy(this._saved[n]).slerp(_q, w);
    }
    rig.root.updateMatrixWorld(true);
  }

  _gesture(time, w) {
    const { rig } = this;
    const b = rig.bones;
    const names = ["upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR"];
    for (const n of names) this._saved[n] = (this._saved[n] || new Q()).copy(b[n].quaternion);

    // Left forearm across the waist, palm turned down; the right hand comes
    // over the top and takes the edge of the left cuff between finger and thumb.
    const tug = Math.sin(time * 2.4) * 0.5 + 0.5;
    const L = rig.root.localToWorld(new V(0.045, 0.0, 0.25));
    const R = rig.root.localToWorld(new V(-0.035 + 0.01 * tug, 0.05, 0.268));
    solveTwoBone(b.upperArmL, b.foreArmL, b.handL, L, rig.root.localToWorld(new V(0.55, 0.1, -0.3)));
    solveTwoBone(b.upperArmR, b.foreArmR, b.handR, R, rig.root.localToWorld(new V(-0.55, 0.15, -0.3)));
    rig.root.getWorldQuaternion(_qw);
    const rootQ = _qw.clone();
    for (const [s, want] of [
      ["L", new V(0, -1, -0.3)],
      ["R", new V(0.15, -1, 0.15)],
    ]) {
      const fore = b["foreArm" + s];
      const hand = b["hand" + s];
      hand.quaternion.setFromEuler(_eul.set(s === "L" ? 0.05 : 0.12, 0, 0));
      hand.updateMatrixWorld(true);
      const axis = hand.getWorldPosition(new V()).sub(fore.getWorldPosition(new V()));
      const palm = this.palm[s].clone().applyQuaternion(hand.getWorldQuaternion(new Q()));
      twistAbout(fore, axis, palm, want.applyQuaternion(rootQ));
    }

    for (const n of names) {
      _q.copy(b[n].quaternion);
      b[n].quaternion.copy(this._saved[n]).slerp(_q, w);
    }
    rig.root.updateMatrixWorld(true);
  }
}
