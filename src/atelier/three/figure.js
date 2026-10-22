import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
import { CAST } from "./characters.js";
import { photoClothTexture } from "./textures.js";
import sageCloth from "../assets/cloth-sage.jpg";
import chestnutCloth from "../assets/cloth-chestnut.jpg";
import {
  buttonGeometry,
  fedora,
  hornMaterial,
  placeOnTube,
  pocketSquareGeometry,
  pocketPuffGeometry,
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

// Fibre sheen: a cool lift on the plain wools; the photographed cloths keep
// their own hue, or the sheen greys them out.
const woolSheen = (cw) =>
  cw.sheen ? new THREE.Color(cw.sheen) : new THREE.Color(cw.wool).lerp(new THREE.Color("#c9d2e6"), 0.35);

export const COLOURWAYS = {
  midnight: { label: "Midnight", wool: "#1a1d26", lining: "#4a1020", tie: "#0e0f14", hat: "#0d0d10", shoes: "#0b0b0c" },
  flannel: { label: "Flannel", wool: "#6f7279", lining: "#23262e", tie: "#15171c", hat: "#2c2d31", shoes: "#0b0b0c" },
  ivory: { label: "Ivory", wool: "#d9d2c3", lining: "#7b5b3c", tie: "#1e1f24", hat: "#d4cbb8", shoes: "#3b2416" },
  bordeaux: { label: "Bordeaux", wool: "#561321", lining: "#14090c", tie: "#141015", hat: "#3a0b14", shoes: "#0b0b0c" },
  // The two reference suits.
  // The two reference suits wear cloth sampled from the supplied photographs.
  // The colour lives in the map; `wool` only scales the photo's brightness
  // back to an albedo (the photographs were lit, and so is the set).
  sage: {
    label: "Sage",
    wool: "#e0e0e0", // matched against photo 2: lit chest ~#80957f, trousers ~#627661
    cloth: sageCloth, // photo 3, front panel below the waist button
    sheen: "#4e6a4c", // a deeper shade of the cloth, for the fibre sheen
    lining: "#c9d3c0",
    tie: "#1b1d22",
    hat: "#5f7a5a",
    shoes: "#3a2216",
    square: "#e9a3ae",
  },
  chestnut: {
    label: "Chestnut",
    wool: "#c4c4c4",
    cloth: chestnutCloth, // photo 4: chocolate ground, beaded cream stripe every ~10 mm
    sheen: "#3a2010",
    lining: "#3a1622",
    tie: "#1b1d22",
    hat: "#3a2416",
    shoes: "#2c1810",
    square: "#5b1b38",
  },
};

/*
 * How the suit is worn: the story figure wears a three-piece with a tie; the
 * reference looks are two-piece, the shirt open at the neck, black buttons,
 * a puffed silk square and a slimmer trouser.
 */
export const STYLES = {
  threePiece: { collar: "closed", tie: true, vest: true, buttons: "horn", square: "points", slim: false },
  openTwoPiece: { collar: "open", tie: false, vest: false, buttons: "black", square: "puff", slim: true },
};

const th = (sigma, phi) => HALF - sigma * phi;

// Which joint's bend drives a piece's creases, as stored per vertex once baked.
const BEND_IDS = { elbowL: 1, elbowR: 2, kneeL: 3, kneeR: 4 };

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

/**
 * One material group of a piece, finished (fold 1, in place), with the cloth
 * thickness applied — ready to merge with the rest of its material.
 */
function bakeGroup(geo, group, thick, bendId) {
  const src = geo.index.array.subarray(group.start, group.start + group.count);
  const remap = new Map();
  const index = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let v = remap.get(src[i]);
    if (v === undefined) {
      v = remap.size;
      remap.set(src[i], v);
    }
    index[i] = v;
  }
  const n = remap.size;
  const order = new Uint32Array(n);
  for (const [from, to] of remap) order[to] = from;
  const out = new THREE.BufferGeometry();
  const pick = (name) => {
    const a = geo.attributes[name];
    const arr = new a.array.constructor(n * a.itemSize);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.array[order[i] * a.itemSize + c];
    }
    return new THREE.BufferAttribute(arr, a.itemSize);
  };
  const pos = pick("position");
  const nor = pick("normal");
  const shell = pick("aShell");
  for (let i = 0; i < n; i++) {
    const sx = shell.getX(i);
    const sy = shell.getY(i);
    pos.setXYZ(i, pos.getX(i) - nor.getX(i) * sx * thick, pos.getY(i) - nor.getY(i) * sx * thick, pos.getZ(i) - nor.getZ(i) * sx * thick);
    nor.setXYZ(i, nor.getX(i) * sy, nor.getY(i) * sy, nor.getZ(i) * sy);
  }
  out.setAttribute("position", pos);
  out.setAttribute("normal", nor);
  // At fold 1 the shader only reads the wrapped shape; share it for the others.
  out.setAttribute("flatPos", pos);
  out.setAttribute("ctrlPos", pos);
  out.setAttribute("flatNormal", nor);
  out.setAttribute("midNormal", nor);
  for (const name of ["uv", "aCoord", "aCrease", "aSwing", "aAO", "skinIndex", "skinWeight"]) out.setAttribute(name, pick(name));
  out.setAttribute("aDelay", new THREE.BufferAttribute(new Float32Array(n), 1));
  const flat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) flat[i * 2 + 1] = 1;
  out.setAttribute("aShell", new THREE.BufferAttribute(flat, 2));
  out.setAttribute("aBendId", new THREE.BufferAttribute(new Float32Array(n).fill(bendId), 1));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

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
  /**
   * @param opts.detail    "full" (buttons, stitching, linings, thickness) or "lite"
   * @param opts.cast      who wears it (characters.js)
   * @param opts.style     how it is worn (STYLES)
   * @param opts.hologram  start as the glowing hologram (the story's hero)
   * @param opts.quality   sculpt quality of head and hands (human.js), 0–2
   */
  constructor(body, shared, { colourway = "midnight", detail = "full", cast = CAST.luca, style = STYLES.threePiece, hologram = false, quality } = {}) {
    this.body = body;
    this.shared = shared;
    this.full = detail === "full";
    this.style = style;
    this.cast = cast;
    this.root = new THREE.Group();
    this.rig = createRig(body);
    this.root.add(this.rig.root);
    this.motion = new Motion(this.rig);
    this.character = new Character(this.rig, body, { cast, full: hologram, quality: quality ?? (this.full ? 2 : 0) });
    this.root.add(this.character.group);

    this.pieces = [];
    this.byName = {};
    this.byGroup = { shirt: [], tie: [], vest: [], jacket: [], trousers: [] };
    this.mats = { wool: [], lining: [], tie: [], shoes: [], hat: [] };
    this.look = { reveal: 1, scan: hologram ? 0 : 1, glow: hologram ? 1 : 0, solid: hologram ? 0 : 1 };
    this.uSway = { value: new THREE.Vector3() };
    this.uBends = { value: new THREE.Vector4() };
    this.bakeSpecs = new Map(); // material key → params, for baking
    this.baked = null;
    this.hand = { curl: 0.24, pinchL: 0, pinchR: 0 };
    this.colourway = colourway;

    const cw = COLOURWAYS[colourway];
    this.cw = cw;
    const tex = shared.textures;
    this.horn =
      style.buttons === "black"
        ? new THREE.MeshPhysicalMaterial({ color: "#0b0b0c", vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 })
        : hornMaterial(colourway === "ivory" ? "#3a2a1e" : "#17120f");
    this.cloth = cw.cloth ? photoClothTexture(cw.cloth) : null;
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
          // Wool barely reflects; a full dielectric specular greys photo cloth.
          specularIntensity: this.cloth ? 0.45 : 1,
          sheen: 1,
          sheenRoughness: 0.42,
          sheenColor: woolSheen(cw),
          map: this.cloth ? this.cloth.map : tex.wool.map,
          bumpMap: this.cloth ? this.cloth.bump : tex.wool.bump,
          bumpScale: this.cloth ? 0.8 : 1.4,
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
    if (style.tie) this._tie();
    if (style.vest) this._vest();
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
    const uniforms = createClothUniforms({ ...this.shared, uSway: this.uSway, uBends: this.uBends });
    uniforms.uThick.value = thickness;
    const patch = buildPatch(tube, {
      uvScale: kind === "cotton" ? 18 : 12,
      wrinkle: spec.hinge || kind === "tie" ? 0 : kind === "cotton" ? 0.0026 : 0.0016,
      skin: (theta, t, p) => skinWeights(this.rig, tube, theta, t, p, opts.skin),
      ao: full && !spec.hinge ? (theta, t, p) => this._ao(tube, p) : undefined,
      thickness,
      ...spec,
    });

    const keys = [];
    const make = (params, key) => {
      if (!this.bakeSpecs.has(key)) this.bakeSpecs.set(key, params);
      keys.push(key);
      return clothMaterial(params, uniforms);
    };
    const outerSide = thickness > 0 ? THREE.FrontSide : THREE.DoubleSide;
    let outer;
    let inner;
    if (kind === "cotton") {
      outer = make(this.params.cotton(outerSide), `cotton|${outerSide}`);
      inner = outer;
    } else if (kind === "tie") {
      outer = make(this.params.tie(outerSide), `tie|${outerSide}`);
      this.mats.tie.push(outer);
      inner = outer;
    } else if (kind === "lining") {
      outer = make(this.params.lining(THREE.DoubleSide), "lining|double");
      this.mats.lining.push(outer);
      inner = outer;
    } else {
      outer = make(this.params.wool(outerSide), `wool|${outerSide}`);
      this.mats.wool.push(outer);
      inner = outer;
      if (kind === "wool+lining" && thickness > 0) {
        inner = make(this.params.lining(THREE.FrontSide), "lining|front");
        this.mats.lining.push(inner);
      }
    }
    // Cut edges: the same cloth without the weave bump, which only aliases there.
    let edge = outer;
    if (thickness > 0) {
      const base = kind === "cotton" ? "cotton" : kind === "tie" ? "tie" : "wool";
      edge = make({ ...this.params[base](THREE.DoubleSide), bumpMap: null, sheen: 0.25 }, `${base}|edge`);
      if (kind !== "cotton" && kind !== "tie") this.mats.wool.push(edge);
      if (kind === "tie") this.mats.tie.push(edge);
    }
    const materials = thickness > 0 ? [outer, inner, edge] : [outer];
    // One key per geometry group, in group order (an unchanged inner reuses the outer's).
    const groupKeys = thickness > 0 ? [keys[0], inner === outer ? keys[0] : keys[1], keys[keys.length - 1]] : [keys[0]];
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
    piece.groupKeys = groupKeys;
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
    // Worn open, as in the reference photographs: the collar button and one
    // more undone, so the fronts part in a short V at the neck.
    const open = this.style.collar === "open";
    const neckOpen = (t) => (open ? 0.34 * Math.pow(sm(t, 0.405, 0.545), 1.1) : 0);
    const gap = open ? 0.34 : 0.07;
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
          tRange: () => [-0.2, 0.532],
          thetaRange: (t) => [th(s, (s > 0 ? -0.04 : 0.0) + neckOpen(t)), th(s, HALF + 0.03)],
        },
        "cotton",
        { skin: { shoulder: 0.4, leg: 0.2 } }
      );
      this._hoverOut(p, new THREE.Vector3(s * 0.55, 0, 0.85), 0.7, 0.05, seed++);
      if (s > 0) {
        const buttons = open ? [0.37, 0.255, 0.14, 0.025, -0.09] : [0.47, 0.36, 0.245, 0.13, 0.015, -0.1];
        for (const t of buttons) this._button(p, torso, HALF, t, off + 0.0028, 0.0052);
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
        tRange: () => [-0.2, 0.532],
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
        thetaRange: () => [th(1, gap), th(1, PI * 2 - gap)],
        centre: { theta: -HALF, t: 0.55 },
      },
      "cotton",
      { thickness: 0.0014 }
    );
    this._hoverOut(band, new THREE.Vector3(0, 1, -0.3), 0.45, 0, seed++, 0.3);

    const leafTop = 0.582;
    const leafGap = open ? 0.3 : 0.13;
    const leafPhi = (u) => leafGap + u * (PI * 2 - 2 * leafGap);
    const leaf = this._piece(
      "shirt",
      "shirt-collar-leaf",
      torso,
      {
        cols: 72,
        rows: 10,
        // Open, the collar rolls further out and lies over the jacket collar.
        offFn: (theta, t) => 0.013 + (leafTop - t) * (open ? 0.56 : 0.42),
        tRange: (u) => {
          const p = leafPhi(u);
          const fromFront = Math.min(p, PI * 2 - p);
          return [leafTop - 0.05 - (open ? 0.042 : 0.032) * (1 - sm(fromFront, leafGap, leafGap + 0.6)), leafTop];
        },
        // The front edge slants outward toward the point, so the points
        // spread over the lapels instead of standing up beside the neck.
        thetaRange: (t) => {
          const gp = leafGap + (open ? 0.42 : 0.1) * sm(leafTop - t, 0.0, 0.09);
          return [th(1, gp), th(1, PI * 2 - gp)];
        },
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
    // Ease over the body: the slim cut sits closer through chest and sleeve.
    const off = this.style.slim ? 0.028 : 0.034;
    const sOff = this.style.slim ? 0.016 : 0.022;
    const tB = BUTTON_STANCE;
    const ring = [];
    const base = -0.075;
    const slim = this.style.slim;
    // The slim cut is short, just covering the seat (~0.85 m from the floor,
    // measured from photo 2); the classic three-piece falls to the knuckles.
    const HEM = slim ? -0.215 : JACKET_HEM;
    // Below the top button the fronts curve away. The slim cut (the reference
    // suits) opens wide — about 9 cm apart at the lower button, rounded to
    // ~22 cm at the hem — where the classic three-piece barely parts.
    const pin = (t) =>
      t < tB
        ? base + (slim ? 0.65 * Math.pow(sm(t, tB, HEM), 0.9) : 0.52 * Math.pow(sm(t, tB, HEM), 1.1))
        : base + 0.69 * sm(t, tB, 0.545);
    // Waist suppression: the slim cut is taken in at the waist and close over the seat.
    const shape = (t) => (slim ? 0.012 * gauss(t, 0.13) + 0.005 * sm(t, -0.12, HEM) : 0);
    const lapelWidth = (t) => {
      const body = 0.088 * Math.pow(sm(t, tB, 0.33), 0.75);
      const notch = 1 - 0.62 * sm(t, 0.355, 0.372) * (1 - sm(t, 0.392, 0.41));
      return body * notch * (1 - sm(t, 0.47, 0.5) * 0.4);
    };
    // The skirt below the waist swings with the walk.
    const swing = (theta, t, p) => Math.pow(sm(p.y, -0.02, HEM), 1.4);
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
          offFn: (theta, t) => fOff + pad(theta, t) - shape(t),
          tRange: (u) => {
            const phi = lerp(0, HALF + 0.32, u);
            return [HEM + 0.055 * (1 - sm(phi, 0.0, 0.55)), 0.538];
          },
          thetaRange: (t) => [th(s, pin(t)), th(s, HALF + 0.32)],
          swing,
        },
        "wool+lining",
        { thickness: 0.0035, skin: jSkin }
      );
      ring.push(front);
      this["front" + s] = front;
      const tL = tB - (slim ? 0.105 : 0.13);
      if (s > 0) {
        this._button(front, torso, HALF, tB, fOff + 0.004 - shape(tB), 0.0085);
        // The lower button sits just in from the curved-away edge.
        this._button(front, torso, th(1, pin(tL) - base), tL, fOff + 0.004 - shape(tL), 0.0085);
      } else if (this.full) {
        // Its buttonhole on the other front, as in the reference photographs.
        const hole = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0013, 0.017, 2, 6),
          new THREE.MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.7 })
        );
        placeOnTube(hole, torso, th(s, pin(tL) - base + 0.004), tL, fOff + 0.0045 - shape(tL));
        hole.rotateZ(Math.PI / 2);
        this._attach(front, boneForTorsoY(hole.position.y), hole);
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
            return fOff + 0.0075 + pad(theta, t) - shape(t) + 0.004 * gauss(fromRoll, 0.012);
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
      if (s > 0 && this.full) {
        // The boutonnière buttonhole, hand-worked in the lapel.
        const hole = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0011, 0.016, 2, 6),
          new THREE.MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.7 })
        );
        const ht = 0.33;
        const { rx } = torso.section(ht);
        const hth = th(s, pin(ht) + 0.03 / (rx + fOff));
        placeOnTube(hole, torso, hth, ht, fOff + 0.0122);
        hole.rotateZ(Math.PI / 2 - 0.35);
        this._attach(lapel, "chest", hole);
      }

      const flapTop = slim ? -0.088 : -0.135;
      const flap = this._piece(
        "jacket",
        `jacket-flap-${s}`,
        torso,
        {
          cols: 14,
          rows: 5,
          off: fOff + 0.0065 - shape(flapTop),
          tRange: () => [flapTop - 0.055, flapTop],
          thetaRange: () => [th(s, 0.62), th(s, 1.12)],
          hinge: foldAcrossT(torso, flapTop, fOff + 0.0065 - shape(flapTop)),
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
      const puff = this.style.square === "puff";
      const sq = new THREE.Mesh(
        puff ? pocketPuffGeometry() : pocketSquareGeometry(),
        new THREE.MeshPhysicalMaterial({
          color: this.cw.square ?? "#f4f2ee",
          roughness: 0.42,
          sheen: 1,
          sheenColor: new THREE.Color(this.cw.square ?? "#ffffff").lerp(new THREE.Color("#ffffff"), 0.5),
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
        offFn: (theta, t) => off + pad(theta, t) - shape(t),
        tRange: () => [HEM, 0.538],
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
            sOff +
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
      for (const t of [0.858, 0.836, 0.814, 0.792]) this._button(sleeve, arm, btnTheta, t, sOff + 0.0042, 0.0064, "foreArm" + S);
      if (this.full) {
        const st = sleeveStitches(arm, { tHem: 0.874, tVentTop: 0.76, thetaVent: btnTheta + 0.24, off: sOff + 0.0036 }, this.stitchMat);
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
            // Below the knee the trouser hangs straight, tapering a little to
            // the hem, rather than following the calf and ankle.
            const { rx } = leg.section(t);
            // Slim (the reference suits): ~19 cm across the knee, ~16.5 at the hem.
            const slim = this.style.slim;
            const hang = slim ? THREE.MathUtils.lerp(0.066, 0.053, sm(t, 0.5, 1.0)) : THREE.MathUtils.lerp(0.078, 0.068, sm(t, 0.5, 1.0));
            const min = slim ? 0.007 : 0.012;
            const ease = t > 0.4 ? Math.max(min, hang - rx) : min;
            return ease + crease * (1 - sm(t, 0.9, 1.0) * 0.6) + brk;
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
    const sheen = woolSheen(cw);
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
    this.uBends.value.set(out.elbowL, out.elbowR, out.kneeL, out.kneeR);
    // Once every piece is in place, draw the merged suit instead of ~40 pieces.
    const assembled = this.baked && this.pieces.every((p) => p.state.fly >= 0.999 && p.state.fold >= 0.999 && p.state.reveal >= 0.999);
    if (assembled) {
      this._showBaked(true, reveal);
    } else {
      if (this.baked) this._showBaked(false, reveal);
      for (const p of this.pieces) {
        if (p.bendSource) p.uniforms.uBend.value = out[p.bendSource];
        p.apply(reveal, flutter);
      }
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
    this.character.limbsCovered = assembled || this._limbsCovered();
    this.character.setHandPose(this.hand.curl, this.hand.pinchL, this.hand.pinchR);
    this.character.update(time, {
      scan: L.scan,
      glow: L.glow * reveal,
      solid: L.solid * reveal,
      feet: sr < 0.5 ? 1 : 0,
    });
  }

  /**
   * Merge the finished suit: every piece's geometry, with its cloth thickness
   * baked in, grouped by material into one skinned mesh each; and every
   * button, stitch and cufflink grouped the same way. The pieces stay for
   * the build-up; update() swaps to the merged suit whenever all are in place.
   */
  bake() {
    const buckets = new Map();
    for (const piece of this.pieces) {
      const geo = piece.mesh.geometry;
      const thick = piece.uniforms.uThick.value;
      const bendId = BEND_IDS[piece.bendSource] ?? 0;
      geo.groups.forEach((group, gi) => {
        const key = piece.groupKeys[gi];
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(bakeGroup(geo, group, thick, bendId));
      });
    }
    const uniforms = createClothUniforms({ ...this.shared, uSway: this.uSway, uBends: this.uBends });
    uniforms.uFold.value = 1;
    uniforms.uFlutter = { value: 0 };
    this.bakedReveal = uniforms.uReveal;
    const meshes = [];
    for (const [key, geos] of buckets) {
      const material = clothMaterial(this.bakeSpecs.get(key), uniforms);
      const kind = key.split("|")[0];
      if (kind === "wool") this.mats.wool.push(material);
      else if (kind === "lining") this.mats.lining.push(material);
      else if (kind === "tie") this.mats.tie.push(material);
      const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), material);
      geos.forEach((g) => g.dispose());
      mesh.customDepthMaterial = clothDepthMaterial(uniforms);
      meshes.push(mesh);
    }

    // Details: rigid on their bones, re-expressed in bind space and skinned
    // wholly to that bone.
    const details = new Map();
    const m = new THREE.Matrix4();
    for (const piece of this.pieces) {
      for (const { obj, base } of piece.details) {
        const bone = obj.parent;
        const bi = this.rig.index[bone.name];
        const root = new THREE.Matrix4()
          .makeTranslation(this.rig.bind[bone.name])
          .multiply(m.compose(obj.position, obj.quaternion, base));
        const add = (mesh, matrix) => {
          if (!details.has(mesh.material)) details.set(mesh.material, []);
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          g.applyMatrix4(matrix);
          for (const name of Object.keys(g.attributes)) {
            if (!["position", "normal", "color"].includes(name)) g.deleteAttribute(name);
          }
          if (!mesh.material.vertexColors) g.deleteAttribute("color");
          const n = g.attributes.position.count;
          const si = new Uint16Array(n * 4);
          const sw = new Float32Array(n * 4);
          for (let i = 0; i < n; i++) {
            si[i * 4] = bi;
            sw[i * 4] = 1;
          }
          g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
          g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
          details.get(mesh.material).push(g);
        };
        obj.updateMatrix();
        const visit = (o, matrix) => {
          if (o.isInstancedMesh) {
            const im = new THREE.Matrix4();
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, im);
              add(o, matrix.clone().multiply(im));
            }
          } else if (o.isMesh) {
            add(o, matrix);
          }
          for (const c of o.children) {
            c.updateMatrix();
            visit(c, matrix.clone().multiply(c.matrix));
          }
        };
        visit(obj, root);
      }
    }
    for (const [material, geos] of details) {
      meshes.push(new THREE.SkinnedMesh(mergeGeometries(geos), material));
      geos.forEach((g) => g.dispose());
    }
    for (const mesh of meshes) {
      mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      mesh.bindMode = THREE.DetachedBindMode;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
    }
    this.baked = meshes;
    this._bakedShown = false;
    return this;
  }

  _limbsCovered() {
    const done = (n) => {
      const p = this.byName[n];
      return p && p.state.fold >= 0.999 && p.state.fly >= 0.999 && p.state.reveal >= 0.999;
    };
    return ["jacket-sleeve-1", "jacket-sleeve--1", "trousers-leg-1", "trousers-leg--1"].every(done);
  }

  _showBaked(on, reveal) {
    if (on) this.bakedReveal.value = reveal;
    for (const b of this.baked) b.visible = on && reveal > 0.002;
    if (on === this._bakedShown) return;
    this._bakedShown = on;
    for (const p of this.pieces) {
      p.mesh.visible = !on;
      for (const d of p.details) d.obj.visible = !on;
    }
  }

  dispose() {
    const geos = new Set();
    const mats = new Set();
    this.root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      if (o.customDepthMaterial) mats.add(o.customDepthMaterial);
    });
    geos.forEach((g) => !g.userData.shared && g.dispose());
    this.cloth?.map.dispose();
    this.cloth?.bump.dispose();
    mats.forEach((m) => m.dispose());
    this.character.dispose();
  }
}

