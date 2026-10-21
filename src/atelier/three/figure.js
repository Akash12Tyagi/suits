import * as THREE from "three";
import { SHOULDER } from "./body.js";
import {
  buildPatch,
  clothDepthMaterial,
  clothMaterial,
  createClothUniforms,
  foldAcrossT,
  foldAcrossTheta,
} from "./cloth.js";
import { createRig, skinWeights, attachToBone, boneForTorsoY, ELBOW_T, KNEE_T } from "./rig.js";
import { Motion } from "./motion.js";
import { Character } from "./character.js";
import {
  buttonGeometry,
  fedora,
  hornMaterial,
  placeOnTube,
  pocketSquareGeometry,
  shoeGeometry,
  sleeveStitches,
} from "./props.js";

const PI = Math.PI;
const HALF = PI / 2;
const sm = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const gauss = (x, s) => Math.exp(-(x * x) / (s * s));

// Proportions of the cut (y in metres; the natural waist is y = 0).
export const JACKET_HEM = -0.3;
const BUTTON_STANCE = -0.02;
const VEST_SIDE = -0.1;
const VEST_POINT = -0.19;
const HAT_AT = new THREE.Vector3(0, 0.792, 0.014);

export const COLOURWAYS = {
  midnight: { label: "Midnight", wool: "#1a1d26", lining: "#4a1020", tie: "#0e0f14", hat: "#0d0d10", shoes: "#0b0b0c" },
  flannel: { label: "Flannel", wool: "#6f7279", lining: "#23262e", tie: "#15171c", hat: "#2c2d31", shoes: "#0b0b0c" },
  ivory: { label: "Ivory", wool: "#d9d2c3", lining: "#7b5b3c", tie: "#1e1f24", hat: "#d4cbb8", shoes: "#3b2416" },
  bordeaux: { label: "Bordeaux", wool: "#561321", lining: "#14090c", tie: "#141015", hat: "#3a0b14", shoes: "#0b0b0c" },
};

const th = (sigma, phi) => HALF - sigma * phi;

function jitter(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

const _m = new THREE.Matrix4();
const _t1 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _I = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/*
 * A pattern piece. Its flight is a path through up to three poses of its
 * anchor point: lying on the cutting table (fly = -1), hovering beside the
 * figure (fly = 0) and in place (fly = 1). The path is written into the
 * piece's uFly matrix and applied in the vertex shader before skinning.
 */
class Piece {
  constructor(name, patch, mesh, uniforms) {
    this.name = name;
    this.patch = patch;
    this.mesh = mesh;
    this.uniforms = uniforms;
    this.anchor = patch.centre.clone();
    this.hover = { pos: this.anchor.clone(), quat: new THREE.Quaternion() };
    this.table = null;
    this.state = { fly: 0, fold: 0, reveal: 0 };
    this.details = [];
    this.flutter = { value: 0 };
    uniforms.uFlutter = this.flutter;
    this.bendSource = null;
  }

  setHover(offset, rot) {
    this.hover.pos.copy(this.anchor).add(offset);
    this.hover.quat.setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z));
  }

  /** Lay the piece flat, face up, on a table: its vertical along `along`. */
  setTable(pos, yaw) {
    const { T, U, N } = this.patch.frame;
    const handed = Math.sign(new THREE.Vector3().crossVectors(T, U).dot(N)) || 1;
    const b = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const c = UP.clone();
    const a = new THREE.Vector3().crossVectors(b, c).multiplyScalar(handed);
    const target = new THREE.Matrix4().makeBasis(a, b, c);
    const source = new THREE.Matrix4().makeBasis(T, U, N);
    const R = target.multiply(source.transpose());
    this.table = { pos: pos.clone(), quat: new THREE.Quaternion().setFromRotationMatrix(R), a, b };
  }

  /** The chalk outline of the flat piece as it lies on the table (world points). */
  tableOutline(margin = 0.012) {
    const pts = this.patch.outline();
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
    return pts.map((p) => {
      const d = p.clone().sub(c);
      const len = d.length() || 1;
      const q = p.clone().add(d.multiplyScalar(margin / len));
      return this.table.pos.clone().addScaledVector(this.table.a, q.x).addScaledVector(this.table.b, q.y);
    });
  }

  addDetail(obj) {
    this.details.push({ obj, base: obj.scale.clone() });
    return obj;
  }

  apply(globalReveal, flutter) {
    const { fly, fold } = this.state;
    const reveal = this.state.reveal * globalReveal;
    const pos = _v;
    if (fly < 0 && this.table) {
      const e = fly + 1;
      pos.lerpVectors(this.table.pos, this.hover.pos, e).addScaledVector(UP, Math.sin(PI * e) * 0.32);
      _q.slerpQuaternions(this.table.quat, this.hover.quat, e);
    } else {
      const e = Math.max(fly, 0);
      pos.lerpVectors(this.hover.pos, this.anchor, e);
      _q.slerpQuaternions(this.hover.quat, _I, e);
    }
    const M = this.uniforms.uFly.value;
    M.makeTranslation(pos.x, pos.y, pos.z)
      .multiply(_m.makeRotationFromQuaternion(_q))
      .multiply(_t1.makeTranslation(-this.anchor.x, -this.anchor.y, -this.anchor.z));
    this.uniforms.uFlyN.value.setFromMatrix4(_m);
    this.uniforms.uFold.value = fold;
    this.uniforms.uReveal.value = reveal;
    const inFlight = fly < 0 ? Math.sin(PI * (fly + 1)) : 1 - fly;
    this.flutter.value = flutter * Math.max(0, inFlight);
    this.mesh.visible = reveal > 0.002;
    const pop = sm(fold, 0.86, 1) * sm(reveal, 0.5, 1) * (fly > 0.97 ? 1 : 0);
    for (const d of this.details) {
      d.obj.visible = pop > 0.001;
      d.obj.scale.copy(d.base).multiplyScalar(Math.max(pop, 0.0001));
    }
  }
}

export class Figure {
  constructor(body, shared, { colourway = "midnight", detail = "full" } = {}) {
    this.body = body;
    this.shared = shared;
    this.full = detail === "full";
    this.root = new THREE.Group();
    this.rig = createRig(body);
    this.root.add(this.rig.root);
    this.motion = new Motion(this.rig);
    this.character = new Character(this.rig, body, { full: this.full });
    this.root.add(this.character.group);

    this.pieces = [];
    this.byName = {};
    this.byGroup = { shirt: [], tie: [], vest: [], jacket: [], trousers: [] };
    this.mats = { wool: [], lining: [], tie: [], shoes: [], hat: [] };
    this.look = { reveal: 1, scan: this.full ? 0 : 1, glow: this.full ? 1 : 0, solid: this.full ? 0 : 1 };
    this.uSway = { value: new THREE.Vector3() };
    this.hand = { curl: 0.24, pinchL: 0, pinchR: 0 };
    this.colourway = colourway;

    const cw = COLOURWAYS[colourway];
    const tex = shared.textures;
    this.horn = hornMaterial(colourway === "ivory" ? "#3a2a1e" : "#17120f");
    this.stitchMat = new THREE.MeshStandardMaterial({ color: "#8e8a83", roughness: 0.8 });

    this.params = {
      cotton: (side) => ({
        color: new THREE.Color("#dedbd3"),
        roughness: 0.72,
        sheen: 0.7,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color("#ffffff"),
        map: tex.cotton.map,
        bumpMap: tex.cotton.bump,
        bumpScale: 0.6,
        side,
      }),
      wool: (side) => {
        const c = new THREE.Color(cw.wool);
        return {
          color: c,
          roughness: 0.84,
          sheen: 1,
          sheenRoughness: 0.42,
          sheenColor: c.clone().lerp(new THREE.Color("#c9d2e6"), 0.35),
          map: tex.wool.map,
          bumpMap: tex.wool.bump,
          bumpScale: 1.4,
          side,
        };
      },
      lining: (side) => ({
        color: new THREE.Color(cw.lining),
        roughness: 0.34,
        sheen: 1,
        sheenRoughness: 0.25,
        sheenColor: new THREE.Color(cw.lining).lerp(new THREE.Color("#ff9db0"), 0.35),
        map: tex.silk.map,
        bumpMap: tex.silk.bump,
        bumpScale: 0.4,
        side,
      }),
      tie: (side) => ({
        color: new THREE.Color(cw.tie),
        roughness: 0.36,
        sheen: 1,
        sheenRoughness: 0.3,
        sheenColor: new THREE.Color("#4a5068"),
        bumpMap: tex.silk.bump,
        bumpScale: 1.2,
        map: tex.silk.map,
        side,
      }),
    };

    this._shirt();
    this._tie();
    this._vest();
    this._jacket();
    this._trousers();
    this._shoes(cw);
    this._hat(cw);
    this.update(0, 0);
  }

  // ---------------------------------------------------------------- helpers

  _ao(tube, p) {
    const { torso, armL, armR, legL, legR } = this.body;
    let ao = 1;
    if (tube.kind === "torso") {
      if (p.y < SHOULDER.y + 0.01) {
        for (const arm of [armL, armR]) {
          // Distance to the arm's axis segment, less its radius.
          const a = arm.origin;
          const d = arm.axis;
          const t = THREE.MathUtils.clamp(_v.copy(p).sub(a).dot(d) / arm.length, 0, 1);
          const c = arm.centre(t);
          const r = arm.section(t).rx + 0.02;
          const dist = Math.max(0, c.distanceTo(p) - r);
          ao *= 1 - 0.5 * gauss(dist, 0.035) * sm(SHOULDER.y + 0.01 - p.y, 0, 0.08);
        }
      }
      if (p.y < -0.18) {
        for (const leg of [legL, legR]) {
          const dist = Math.max(0, Math.hypot(p.x - leg.origin.x, p.z) - 0.13);
          ao *= 1 - 0.25 * gauss(dist, 0.05);
        }
      }
    } else if (tube.kind === "arm") {
      const { rx, rz, zc } = torso.section(p.y);
      const ang = Math.atan2(p.z - zc, p.x);
      const re = 1 / Math.sqrt((Math.cos(ang) / rx) ** 2 + (Math.sin(ang) / rz) ** 2);
      const dist = Math.max(0, Math.hypot(p.x, p.z - zc) - re - 0.03);
      ao *= 1 - 0.5 * gauss(dist, 0.035) * (p.y > -0.35 ? 1 : 0);
    } else if (tube.kind === "leg") {
      const other = tube.side > 0 ? legR : legL;
      const dist = Math.max(0, Math.hypot(p.x - other.origin.x, p.z) - 0.11);
      ao *= 1 - 0.45 * gauss(dist, 0.045);
      ao *= 1 - 0.25 * sm(p.y, -0.2, -0.05) * gauss(p.x - 0, 0.06);
    }
    return ao;
  }

  _piece(group, name, tube, spec, kind, opts = {}) {
    const full = this.full;
    const thickness = full ? opts.thickness ?? 0 : 0;
    const uniforms = createClothUniforms({ ...this.shared, uSway: this.uSway });
    uniforms.uThick.value = thickness;
    const patch = buildPatch(tube, {
      uvScale: kind === "cotton" ? 18 : 12,
      wrinkle: spec.hinge || kind === "tie" ? 0 : kind === "cotton" ? 0.0026 : 0.0016,
      skin: (theta, t, p) => skinWeights(this.rig, tube, theta, t, p, opts.skin),
      ao: full && !spec.hinge ? (theta, t, p) => this._ao(tube, p) : undefined,
      thickness,
      ...spec,
    });

    const make = (params) => clothMaterial(params, uniforms);
    const outerSide = thickness > 0 ? THREE.FrontSide : THREE.DoubleSide;
    let outer;
    let inner;
    if (kind === "cotton") {
      outer = make(this.params.cotton(outerSide));
      inner = outer;
    } else if (kind === "tie") {
      outer = make(this.params.tie(outerSide));
      this.mats.tie.push(outer);
      inner = outer;
    } else if (kind === "lining") {
      outer = make(this.params.lining(THREE.DoubleSide));
      this.mats.lining.push(outer);
      inner = outer;
    } else {
      outer = make(this.params.wool(outerSide));
      this.mats.wool.push(outer);
      inner = outer;
      if (kind === "wool+lining" && thickness > 0) {
        inner = make(this.params.lining(THREE.FrontSide));
        this.mats.lining.push(inner);
      }
    }
    // Cut edges: the same cloth without the weave bump, which only aliases there.
    let edge = outer;
    if (thickness > 0) {
      edge = make({ ...this.params[kind === "cotton" ? "cotton" : kind === "tie" ? "tie" : "wool"](THREE.DoubleSide), bumpMap: null, sheen: 0.25 });
      if (kind !== "cotton" && kind !== "tie") this.mats.wool.push(edge);
      if (kind === "tie") this.mats.tie.push(edge);
    }
    const materials = thickness > 0 ? [outer, inner, edge] : [outer];
    const mesh = new THREE.SkinnedMesh(patch.geometry, materials);
    mesh.bind(this.rig.skeleton, new THREE.Matrix4());
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = clothDepthMaterial(uniforms);
    this.root.add(mesh);

    const piece = new Piece(name, patch, mesh, uniforms);
    piece.bendSource = opts.bend ?? null;
    piece.setHover(patch.normal.clone().multiplyScalar(0.55), new THREE.Vector3());
    this.pieces.push(piece);
    this.byName[name] = piece;
    this.byGroup[group].push(piece);
    return piece;
  }

  _hoverOut(piece, normal, dist, lift, seed, tumble = 0.5) {
    piece.setHover(
      normal.clone().normalize().multiplyScalar(dist).add(new THREE.Vector3(0, lift, 0)),
      new THREE.Vector3(jitter(seed) * tumble, jitter(seed + 1) * tumble * 1.6, jitter(seed + 2) * tumble)
    );
  }

  _hoverRing(piece, index, total, radius, y, seed) {
    // Jacket parts orbit the figure like the reference's exploded ring.
    const a = (index / total) * PI * 2 + 0.4;
    const target = new THREE.Vector3(Math.cos(a) * radius, y + jitter(seed) * 0.25, Math.sin(a) * radius * 0.55);
    piece.setHover(
      target,
      new THREE.Vector3(jitter(seed + 3) * 0.6, jitter(seed + 4) * 1.4, jitter(seed + 5) * 0.8)
    );
  }

  _attach(piece, bone, obj) {
    attachToBone(this.rig, bone, obj);
    piece.addDetail(obj);
    obj.castShadow = true;
    return obj;
  }

  _button(piece, tube, theta, t, off, radius, bone) {
    if (!this.full && radius < 0.008) return;
    const b = new THREE.Mesh(buttonGeometry(radius), this.horn);
    placeOnTube(b, tube, theta, t, off);
    this._attach(piece, bone ?? boneForTorsoY(b.position.y), b);
  }

  // ---------------------------------------------------------------- shirt

  _shirt() {
    const { torso, armL, armR } = this.body;
    const off = 0.006;
    let seed = 10;
    // Tucked in: a little blousing gathers just above the waist.
    const blouse = (t) => 0.005 * gauss(t + 0.04, 0.07);

    for (const s of [1, -1]) {
      const p = this._piece(
        "shirt",
        `shirt-front-${s}`,
        torso,
        {
          cols: 34,
          rows: 60,
          offFn: (theta, t) => (s > 0 ? off + 0.0012 : off) + blouse(t),
          tRange: () => [-0.24, 0.532],
          thetaRange: () => [th(s, s > 0 ? -0.04 : 0.0), th(s, HALF + 0.03)],
        },
        "cotton",
        { skin: { shoulder: 0.4, leg: 0.2 } }
      );
      this._hoverOut(p, new THREE.Vector3(s * 0.55, 0, 0.85), 0.7, 0.05, seed++);
      if (s > 0) {
        for (const t of [0.47, 0.36, 0.245, 0.13, 0.015, -0.1]) this._button(p, torso, HALF, t, off + 0.0028, 0.0052);
      }
    }

    const back = this._piece(
      "shirt",
      "shirt-back",
      torso,
      {
        cols: 56,
        rows: 60,
        offFn: (theta, t) => off + blouse(t),
        tRange: () => [-0.24, 0.532],
        thetaRange: () => [th(1, HALF - 0.03), th(1, PI * 1.5 + 0.03)],
      },
      "cotton",
      { skin: { shoulder: 0.4, leg: 0.2 } }
    );
    this._hoverOut(back, new THREE.Vector3(0, 0, -1), 0.6, 0.25, seed++);

    const band = this._piece(
      "shirt",
      "shirt-collar-band",
      torso,
      {
        cols: 64,
        rows: 6,
        off: 0.009,
        tRange: () => [0.526, 0.578],
        thetaRange: () => [th(1, 0.07), th(1, PI * 2 - 0.07)],
        centre: { theta: -HALF, t: 0.55 },
      },
      "cotton",
      { thickness: 0.0014 }
    );
    this._hoverOut(band, new THREE.Vector3(0, 1, -0.3), 0.45, 0, seed++, 0.3);

    const leafTop = 0.582;
    const leafPhi = (u) => 0.13 + u * (PI * 2 - 0.26);
    const leaf = this._piece(
      "shirt",
      "shirt-collar-leaf",
      torso,
      {
        cols: 72,
        rows: 10,
        offFn: (theta, t) => 0.013 + (leafTop - t) * 0.42,
        tRange: (u) => {
          const p = leafPhi(u);
          const fromFront = Math.min(p, PI * 2 - p);
          return [leafTop - 0.05 - 0.032 * (1 - sm(fromFront, 0.13, 0.7)), leafTop];
        },
        thetaRange: () => [th(1, 0.13), th(1, PI * 2 - 0.13)],
        centre: { theta: -HALF, t: 0.56 },
        hinge: foldAcrossT(torso, leafTop, 0.01),
      },
      "cotton",
      { thickness: 0.0014 }
    );
    this._hoverOut(leaf, new THREE.Vector3(0, 1, 0.2), 0.5, 0, seed++, 0.3);

    for (const [arm, s] of [
      [armL, 1],
      [armR, -1],
    ]) {
      const S = s > 0 ? "L" : "R";
      const sleeve = this._piece(
        "shirt",
        `shirt-sleeve-${s}`,
        arm,
        {
          cols: 40,
          rows: 48,
          off,
          tRange: () => [-0.06, 0.86],
          thetaRange: () => [-PI, PI],
          centre: { theta: 0, t: 0.4 },
          crease: (theta, t) => gauss(t - ELBOW_T, 0.09) * (0.55 + 0.45 * Math.sin(theta)),
        },
        "cotton",
        { bend: "elbow" + S }
      );
      this._hoverOut(sleeve, new THREE.Vector3(s, 0.15, 0.2), 0.75, 0.1, seed++);

      const cuff = this._piece(
        "shirt",
        `shirt-cuff-${s}`,
        arm,
        {
          cols: 40,
          rows: 8,
          off: 0.0125,
          tRange: () => [0.828, 0.918],
          thetaRange: () => [-PI, PI],
          centre: { theta: 0, t: 0.87 },
        },
        "cotton",
        { thickness: 0.0018 }
      );
      this._hoverOut(cuff, new THREE.Vector3(s, -0.4, 0.4), 0.55, -0.1, seed++);
      if (this.full) {
        const link = new THREE.Group();
        const face = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0062, 0.0062, 0.0026, 32),
          new THREE.MeshPhysicalMaterial({ color: "#050506", roughness: 0.08, clearcoat: 1 })
        );
        face.scale.set(1, 1, 0.78);
        face.position.y = 0.0022;
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.0064, 0.0009, 10, 40),
          new THREE.MeshStandardMaterial({ color: "#c8a46a", metalness: 1, roughness: 0.25 })
        );
        rim.rotation.x = HALF;
        rim.scale.set(1, 0.78, 1);
        rim.position.y = 0.0022;
        link.add(face, rim);
        placeOnTube(link, arm, HALF, 0.874, 0.0145);
        this._attach(cuff, "foreArm" + S, link);
      }
    }
  }

  // ---------------------------------------------------------------- tie

  _tie() {
    const { torso } = this.body;
    const off = 0.0115;
    const tip = -0.05;
    const halfWidth = (t) => {
      const w = lerp(0.043, 0.024, sm(t, tip + 0.06, 0.49));
      return w * THREE.MathUtils.clamp((t - tip) / 0.05, 0, 1);
    };
    const blade = this._piece(
      "tie",
      "tie-blade",
      torso,
      {
        cols: 10,
        rows: 56,
        off,
        tRange: () => [tip, 0.512],
        thetaRange: (t) => {
          const { rx } = torso.section(t);
          const h = halfWidth(t) / (rx + off);
          return [HALF - h, HALF + h];
        },
      },
      "tie",
      { thickness: 0.0022 }
    );
    blade.setHover(new THREE.Vector3(0, 0.9, 0.35), new THREE.Vector3(-0.5, 0.2, 0.15));

    const knot = this._piece(
      "tie",
      "tie-knot",
      torso,
      {
        cols: 10,
        rows: 10,
        offFn: (theta, t, u, v) => 0.019 + Math.sin(u * PI) * 0.007 * (1 - v * 0.4),
        tRange: () => [0.5, 0.553],
        thetaRange: (t) => {
          const { rx } = torso.section(t);
          const w = lerp(0.024, 0.015, sm(t, 0.5, 0.553));
          const h = w / (rx + 0.02);
          return [HALF - h, HALF + h];
        },
      },
      "tie"
    );
    knot.setHover(new THREE.Vector3(0, 0.6, 0.45), new THREE.Vector3(0.4, -0.6, 0.3));
  }

  // ---------------------------------------------------------------- waistcoat

  _vest() {
    const { torso } = this.body;
    const off = 0.018;
    let seed = 40;
    const armhole = (t) => Math.sin(PI * THREE.MathUtils.clamp((t - 0.24) / 0.235, 0, 1));

    for (const s of [1, -1]) {
      const base = s > 0 ? -0.035 : 0.0;
      const phiIn = (t) => base + 0.74 * Math.pow(sm(t, 0.13, 0.52), 0.85);
      const phiOut = (t) => HALF + 0.02 - 0.55 * armhole(t);
      const p = this._piece(
        "vest",
        `vest-front-${s}`,
        torso,
        {
          cols: 34,
          rows: 64,
          offFn: () => (s > 0 ? off + 0.0015 : off),
          tRange: (u) => {
            const phi = lerp(base, HALF, u);
            return [VEST_SIDE + (VEST_POINT - VEST_SIDE) * (1 - sm(phi, 0.0, 0.5)), 0.528];
          },
          thetaRange: (t) => [th(s, phiIn(t)), th(s, phiOut(t))],
        },
        "wool",
        { thickness: 0.0025, skin: { shoulder: 0.3 } }
      );
      this._hoverOut(p, new THREE.Vector3(s * 0.8, 0.1, 0.7), 0.75, 0.05, seed++);
      if (s > 0) {
        for (const t of [0.15, 0.075, 0.0, -0.075, -0.15]) this._button(p, torso, HALF, t, off + 0.0034, 0.0062);
      }
    }

    const back = this._piece(
      "vest",
      "vest-back",
      torso,
      {
        cols: 50,
        rows: 56,
        off: off - 0.002,
        tRange: () => [VEST_SIDE - 0.02, 0.528],
        thetaRange: (t) => [th(1, HALF - 0.02 + 0.55 * armhole(t)), th(1, PI * 1.5 + 0.02 - 0.55 * armhole(t))],
      },
      "lining",
      { skin: { shoulder: 0.3 } }
    );
    this._hoverOut(back, new THREE.Vector3(0, 0, -1), 0.7, 0.2, seed++);
  }

  // ---------------------------------------------------------------- jacket

  _jacket() {
    const { torso, armL, armR } = this.body;
    const off = 0.034;
    const tB = BUTTON_STANCE;
    const ring = [];
    const base = -0.075;
    const pin = (t) =>
      t < tB ? base + 0.52 * Math.pow(sm(t, tB, JACKET_HEM), 1.1) : base + 0.69 * sm(t, tB, 0.545);
    const lapelWidth = (t) => {
      const body = 0.088 * Math.pow(sm(t, tB, 0.33), 0.75);
      const notch = 1 - 0.62 * sm(t, 0.355, 0.372) * (1 - sm(t, 0.392, 0.41));
      return body * notch * (1 - sm(t, 0.47, 0.5) * 0.4);
    };
    // The skirt below the waist swings with the walk.
    const swing = (theta, t, p) => Math.pow(sm(p.y, -0.02, JACKET_HEM), 1.4);
    // A light shoulder pad rounds the shoulder line out toward the sleeve head.
    const pad = (theta, t) => 0.008 * gauss(t - 0.452, 0.04) * Math.abs(Math.cos(theta));
    const jSkin = { shoulder: 0.45, leg: 0.22 };

    for (const s of [1, -1]) {
      const fOff = s > 0 ? off + 0.003 : off;
      const front = this._piece(
        "jacket",
        `jacket-front-${s}`,
        torso,
        {
          cols: 40,
          rows: 76,
          offFn: (theta, t) => fOff + pad(theta, t),
          tRange: (u) => {
            const phi = lerp(0, HALF + 0.32, u);
            return [JACKET_HEM + 0.055 * (1 - sm(phi, 0.0, 0.55)), 0.538];
          },
          thetaRange: (t) => [th(s, pin(t)), th(s, HALF + 0.32)],
          swing,
        },
        "wool+lining",
        { thickness: 0.0035, skin: jSkin }
      );
      ring.push(front);
      this["front" + s] = front;
      if (s > 0) {
        this._button(front, torso, HALF, tB, fOff + 0.004, 0.0085);
        this._button(front, torso, HALF, tB - 0.13, fOff + 0.004, 0.0085);
      }

      const lapel = this._piece(
        "jacket",
        `jacket-lapel-${s}`,
        torso,
        {
          cols: 14,
          rows: 70,
          // A soft roll: the lapel stands slightly proud along its fold line.
          offFn: (theta, t) => {
            const { rx } = torso.section(t);
            const fromRoll = Math.abs(theta - th(s, pin(t))) * (rx + fOff);
            return fOff + 0.0075 + pad(theta, t) + 0.004 * gauss(fromRoll, 0.012);
          },
          tRange: () => [tB + 0.005, 0.5],
          thetaRange: (t) => {
            const { rx } = torso.section(t);
            const w = lapelWidth(t) / (rx + fOff);
            return [th(s, pin(t)), th(s, pin(t) + w)];
          },
          hinge: foldAcrossTheta(torso, (t) => th(s, pin(t)), fOff + 0.001),
        },
        "wool",
        { thickness: 0.0035, skin: jSkin }
      );
      lapel.uniforms.uSpread.value = 0.35;
      this["lapel" + s] = lapel;

      const flapTop = -0.135;
      const flap = this._piece(
        "jacket",
        `jacket-flap-${s}`,
        torso,
        {
          cols: 14,
          rows: 5,
          off: fOff + 0.0065,
          tRange: () => [flapTop - 0.055, flapTop],
          thetaRange: () => [th(s, 0.62), th(s, 1.12)],
          hinge: foldAcrossT(torso, flapTop, fOff + 0.0065),
          swing,
        },
        "wool",
        { thickness: 0.003, skin: jSkin }
      );
      this["flap" + s] = flap;
    }

    const welt = this._piece(
      "jacket",
      "jacket-welt",
      torso,
      {
        cols: 10,
        rows: 3,
        off: off + 0.0085,
        tRange: () => [0.232, 0.252],
        thetaRange: () => [th(1, 0.33), th(1, 0.6)],
      },
      "wool",
      { thickness: 0.003 }
    );
    this.welt = welt;
    {
      const sq = new THREE.Mesh(
        pocketSquareGeometry(),
        new THREE.MeshPhysicalMaterial({
          color: "#f4f2ee",
          roughness: 0.45,
          sheen: 1,
          sheenColor: new THREE.Color("#ffffff"),
          side: THREE.DoubleSide,
        })
      );
      const at = torso.point(th(1, 0.465), 0.252, off + 0.004, new THREE.Vector3());
      const n = torso.outwardAt(th(1, 0.465), 0.252, off, new THREE.Vector3());
      sq.position.copy(at);
      sq.lookAt(at.clone().add(n));
      sq.rotateZ(0.05);
      sq.scale.setScalar(0.85);
      this._attach(welt, "chest", sq);
    }

    const back = this._piece(
      "jacket",
      "jacket-back",
      torso,
      {
        cols: 48,
        rows: 76,
        offFn: (theta, t) => off + pad(theta, t),
        tRange: () => [JACKET_HEM, 0.538],
        thetaRange: () => [th(1, HALF + 0.32), th(1, PI * 1.5 - 0.32)],
        swing,
      },
      "wool+lining",
      { thickness: 0.0035, skin: jSkin }
    );
    ring.push(back);

    const collarTop = 0.568;
    const collar = this._piece(
      "jacket",
      "jacket-collar",
      torso,
      {
        cols: 64,
        rows: 10,
        offFn: (theta, t) => 0.026 + (collarTop - t) * 0.28,
        tRange: () => [0.5, collarTop],
        thetaRange: () => [th(1, 0.6), th(1, PI * 2 - 0.6)],
        centre: { theta: -HALF, t: 0.52 },
        hinge: foldAcrossT(torso, collarTop, 0.022),
      },
      "wool",
      { thickness: 0.004 }
    );
    ring.push(collar);

    for (const [arm, s] of [
      [armL, 1],
      [armR, -1],
    ]) {
      const S = s > 0 ? "L" : "R";
      const sleeve = this._piece(
        "jacket",
        `jacket-sleeve-${s}`,
        arm,
        {
          cols: 44,
          rows: 60,
          // Soft gathering just above the cuff.
          offFn: (theta, t) =>
            0.022 +
            0.006 * (1 - sm(t, -0.075, 0.1)) * (0.5 + 0.5 * Math.cos(theta)) +
            0.0022 * Math.sin(t * arm.length * 70 + theta * 2) * sm(t, 0.7, 0.84) * (1 - sm(t, 0.84, 0.87)),
          tRange: () => [-0.075, 0.885],
          thetaRange: () => [-PI, PI],
          centre: { theta: 0, t: 0.4 },
          crease: (theta, t) => gauss(t - ELBOW_T, 0.085) * (0.5 + 0.5 * Math.sin(theta)),
        },
        "wool+lining",
        { thickness: 0.0032, bend: "elbow" + S }
      );
      ring.push(sleeve);
      const btnTheta = -0.6;
      for (const t of [0.858, 0.836, 0.814, 0.792]) this._button(sleeve, arm, btnTheta, t, 0.0262, 0.0064, "foreArm" + S);
      if (this.full) {
        const st = sleeveStitches(arm, { tHem: 0.874, tVentTop: 0.76, thetaVent: btnTheta + 0.24, off: 0.0256 }, this.stitchMat);
        this._attach(sleeve, "foreArm" + S, st);
      }
      if (s > 0) this.cuffArm = { tube: arm, theta: btnTheta, sleeve };
    }

    ring.forEach((p, i) => this._hoverRing(p, i, ring.length, 0.95, 0.05, 70 + i));
    // Lapels, flaps and the welt are cut with their fronts and travel with them.
    for (const s of [1, -1]) {
      for (const p of [this["lapel" + s], this["flap" + s]]) {
        p.hover.pos.copy(p.anchor).add(this["front" + s].hover.pos).sub(this["front" + s].anchor);
        p.hover.quat.copy(this["front" + s].hover.quat);
      }
    }
    this.welt.hover.pos.copy(this.welt.anchor).add(this.front1.hover.pos).sub(this.front1.anchor);
    this.welt.hover.quat.copy(this.front1.hover.quat);
  }

  // ---------------------------------------------------------------- trousers

  _trousers() {
    const { torso, legL, legR } = this.body;
    const top = this._piece(
      "trousers",
      "trousers-top",
      torso,
      {
        cols: 64,
        rows: 20,
        off: 0.012,
        tRange: () => [-0.23, 0.03],
        thetaRange: () => [th(1, -PI), th(1, PI)],
      },
      "wool",
      { skin: { leg: 0.85 } }
    );
    top.setHover(new THREE.Vector3(0, -0.6, 0.4), new THREE.Vector3(0.3, 0, 0));

    for (const [leg, s] of [
      [legL, 1],
      [legR, -1],
    ]) {
      const S = s > 0 ? "L" : "R";
      const p = this._piece(
        "trousers",
        `trousers-leg-${s}`,
        leg,
        {
          cols: 40,
          rows: 72,
          offFn: (theta, t) => {
            // Pressed crease down the front, and the soft break over the shoe.
            const d = Math.atan2(Math.sin(theta - HALF), Math.cos(theta - HALF));
            const crease = 0.006 * Math.exp(-(d * d) / 0.012);
            const brk = 0.0045 * Math.sin(t * leg.length * 48 + d * 1.5) * sm(t, 0.88, 0.99) * (0.4 + 0.6 * Math.cos(d));
            return 0.012 + crease * (1 - sm(t, 0.9, 1.0) * 0.6) + brk;
          },
          tRange: () => [-0.06, 1.0],
          thetaRange: () => [HALF - PI, HALF + PI],
          centre: { theta: HALF, t: 0.5 },
          crease: (theta, t) => gauss(t - KNEE_T, 0.09) * (0.5 - 0.5 * Math.sin(theta)),
        },
        "wool",
        { thickness: 0.002, skin: { foot: false }, bend: "knee" + S }
      );
      p.setHover(new THREE.Vector3(s * 0.55, -0.35, 0.5), new THREE.Vector3(0.4, s * 0.6, s * 0.25));
    }
  }

  _shoes(cw) {
    const geo = shoeGeometry();
    this.shoes = [];
    for (const [s, side] of [
      ["L", 1],
      ["R", -1],
    ]) {
      const m = new THREE.MeshPhysicalMaterial({ color: cw.shoes, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, envMapIntensity: 0.4 });
      this.mats.shoes.push(m);
      const shoe = new THREE.Mesh(geo, m);
      shoe.position.copy(this.rig.bind["foot" + s]).add(new THREE.Vector3(0, -0.0875, 0));
      shoe.rotation.y = side * 0.06;
      shoe.castShadow = true;
      attachToBone(this.rig, "foot" + s, shoe);
      this.shoes.push(shoe);
    }
    this.shoeState = { reveal: 0 };
  }

  _hat(cw) {
    const hat = fedora(cw.hat);
    hat.position.copy(HAT_AT);
    hat.rotation.x = 0.06;
    hat.traverse((o) => o.isMesh && (o.castShadow = true));
    this.mats.hat.push(hat.userData.materials[0]);
    attachToBone(this.rig, "head", hat);
    this.hat = hat;
    this.hatBase = hat.position.clone();
    this.hatState = { drop: 0 };
  }

  // ---------------------------------------------------------------- API

  set(group, key, value) {
    for (const p of this.byGroup[group]) p.state[key] = value;
  }

  /** Lay pieces flat on the cutting table: pile centre, yaw, and stacking. */
  layOnTable(names, centre, yaw, seed = 1) {
    names.forEach((n, i) => {
      const p = this.byName[n];
      const j = new THREE.Vector3(jitter(seed + i) * 0.06, 0.0025 * i, jitter(seed + i + 9) * 0.05);
      p.setTable(centre.clone().add(j), yaw + jitter(seed + i + 3) * 0.12);
      p.state.fly = -1;
    });
  }

  setColourway(name, t = 1) {
    const cw = COLOURWAYS[name];
    if (!cw) return;
    const w = new THREE.Color(cw.wool);
    const sheen = w.clone().lerp(new THREE.Color("#c9d2e6"), 0.35);
    for (const m of this.mats.wool) {
      m.color.lerp(w, t);
      m.sheenColor.lerp(sheen, t);
    }
    for (const m of this.mats.lining) m.color.lerp(new THREE.Color(cw.lining), t);
    for (const m of this.mats.tie) m.color.lerp(new THREE.Color(cw.tie), t);
    for (const m of this.mats.hat) m.color.lerp(new THREE.Color(cw.hat), t);
    for (const m of this.mats.shoes) m.color.lerp(new THREE.Color(cw.shoes), t);
    if (t >= 1) this.colourway = name;
  }

  setPattern(tex) {
    for (const m of this.mats.wool) {
      m.map = tex.map;
      m.bumpMap = tex.bump;
    }
  }

  /** Root-bone placement in the world (the rig carries the whole figure). */
  place(x, y, z, yaw = 0) {
    this.rig.root.position.set(x, y, z);
    this.rig.root.rotation.set(0, yaw, 0);
  }

  update(time, dt) {
    this.motion.update(time, dt);
    const out = this.motion.out;
    this.uSway.value.copy(out.sway);

    const flutter = this.shared.uFlutter.value;
    const reveal = this.look.reveal;
    for (const p of this.pieces) {
      if (p.bendSource) p.uniforms.uBend.value = out[p.bendSource];
      p.apply(reveal, flutter);
    }

    const sr = this.shoeState.reveal * reveal;
    for (const s of this.shoes) {
      s.visible = sr > 0.01;
      s.scale.setScalar(Math.max(sr, 0.001));
    }
    const hd = this.hatState.drop;
    this.hat.visible = hd > 0.01 && reveal > 0.01;
    this.hat.position.copy(this.hatBase);
    this.hat.position.y += (1 - hd) * 0.55;
    this.hat.rotation.y = (1 - hd) * 1.2;
    this.hat.scale.setScalar(lerp(0.6, 1, hd));

    const L = this.look;
    this.character.setHandPose(this.hand.curl, this.hand.pinchL, this.hand.pinchR);
    this.character.update(time, {
      scan: L.scan,
      glow: L.glow * reveal,
      solid: L.solid * reveal,
      feet: sr < 0.5 ? 1 : 0,
    });
  }

  dispose() {
    const geos = new Set();
    const mats = new Set();
    this.root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      if (o.customDepthMaterial) mats.add(o.customDepthMaterial);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.character.dispose();
  }
}

