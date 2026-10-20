import * as THREE from "three";
import { HIP, SHOULDER } from "./body.js";
import {
  buildPatch,
  clothMaterial,
  createClothUniforms,
  foldAcrossT,
  foldAcrossTheta,
} from "./cloth.js";
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
const JACKET_HEM = -0.4; // covers the seat, as a lounge jacket should
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;

export const COLOURWAYS = {
  midnight: {
    label: "Midnight",
    wool: "#1a1d26",
    lining: "#4a1020",
    tie: "#0e0f14",
    hat: "#0d0d10",
    shoes: "#0b0b0c",
  },
  flannel: {
    label: "Flannel",
    wool: "#6f7279",
    lining: "#23262e",
    tie: "#15171c",
    hat: "#2c2d31",
    shoes: "#0b0b0c",
  },
  ivory: {
    label: "Ivory",
    wool: "#d9d2c3",
    lining: "#7b5b3c",
    tie: "#1e1f24",
    hat: "#d4cbb8",
    shoes: "#3b2416",
  },
  bordeaux: {
    label: "Bordeaux",
    wool: "#561321",
    lining: "#14090c",
    tie: "#141015",
    hat: "#3a0b14",
    shoes: "#0b0b0c",
  },
};

// θ for an angle φ measured from centre-front toward the wearer's side σ.
const th = (sigma, phi) => HALF - sigma * phi;

/** Deterministic jitter so the exploded layout is the same on every load. */
function jitter(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

class Piece {
  constructor(name, patch, materials, uniforms, from) {
    this.name = name;
    this.uniforms = uniforms;
    this.anchor = patch.centre.clone();
    this.group = new THREE.Group();
    this.group.position.copy(this.anchor);
    this.inner = new THREE.Group();
    this.inner.position.copy(this.anchor).negate();
    this.group.add(this.inner);
    this.meshes = materials.map((m) => {
      const mesh = new THREE.Mesh(patch.geometry, m);
      this.inner.add(mesh);
      return mesh;
    });
    this.from = from;
    this.state = { fly: 0, fold: 0, reveal: 0 };
    this.details = [];
  }

  addDetail(obj) {
    this.inner.add(obj);
    this.details.push({ obj, base: obj.scale.clone() });
    return obj;
  }

  apply() {
    const { fly, fold, reveal } = this.state;
    const e = 1 - fly;
    this.group.position.copy(this.anchor).addScaledVector(this.from.offset, e);
    this.group.rotation.set(this.from.rot.x * e, this.from.rot.y * e, this.from.rot.z * e);
    this.uniforms.uFold.value = fold;
    this.uniforms.uReveal.value = reveal;
    this.group.visible = reveal > 0.002;
    const pop = smooth(fold, 0.86, 1) * smooth(reveal, 0.5, 1);
    for (const d of this.details) {
      d.obj.visible = pop > 0.001;
      d.obj.scale.copy(d.base).multiplyScalar(pop);
    }
  }
}

/*
 * A full three-piece suit plus shirt, tie, shoes and hat, built as pattern
 * pieces on the body tubes. `detail: "lite"` drops buttons, stitching and
 * linings for the background figures in the procession.
 */
export class Suit {
  constructor(body, shared, { colourway = "midnight", detail = "full" } = {}) {
    this.body = body;
    this.shared = shared;
    this.full = detail === "full";
    this.root = new THREE.Group();
    this.pieces = [];
    this.byGroup = { shirt: [], tie: [], vest: [], jacket: [], trousers: [] };
    this.mats = { wool: [], lining: [], tie: [], shoes: [], hat: [] };
    this.extras = { shoes: [], hat: null };
    this.walk = { amount: 0, phase: 0 };

    // Rig: arms swing at the shoulder, legs at the hip.
    this.rig = {};
    const mkPivot = (name, at) => {
      const pivot = new THREE.Group();
      pivot.position.copy(at);
      const inner = new THREE.Group();
      inner.position.copy(at).negate();
      pivot.add(inner);
      this.root.add(pivot);
      this.rig[name] = { pivot, inner };
    };
    mkPivot("torso", new THREE.Vector3(0, 0, 0));
    mkPivot("armL", SHOULDER.clone());
    mkPivot("armR", SHOULDER.clone().setX(-SHOULDER.x));
    mkPivot("legL", HIP.clone());
    mkPivot("legR", HIP.clone().setX(-HIP.x));

    const tex = shared.textures;
    const cw = COLOURWAYS[colourway];
    this.colourway = colourway;

    this.material = {
      cotton: () => ({
        color: new THREE.Color("#dedbd3"),
        roughness: 0.72,
        sheen: 0.7,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color("#ffffff"),
        map: tex.cotton.map,
        bumpMap: tex.cotton.bump,
        bumpScale: 0.6,
        side: THREE.DoubleSide,
      }),
      wool: (side = THREE.DoubleSide) => {
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
      lining: () => ({
        color: new THREE.Color(cw.lining),
        roughness: 0.34,
        sheen: 1,
        sheenRoughness: 0.25,
        sheenColor: new THREE.Color(cw.lining).lerp(new THREE.Color("#ff9db0"), 0.35),
        map: tex.silk.map,
        bumpMap: tex.silk.bump,
        bumpScale: 0.4,
        side: THREE.BackSide,
      }),
      tie: () => ({
        color: new THREE.Color(cw.tie),
        roughness: 0.36,
        sheen: 1,
        sheenRoughness: 0.3,
        sheenColor: new THREE.Color("#4a5068"),
        bumpMap: tex.silk.bump,
        bumpScale: 1.2,
        map: tex.silk.map,
        side: THREE.DoubleSide,
      }),
    };

    this.horn = hornMaterial(colourway === "ivory" ? "#3a2a1e" : "#17120f");
    this.mats.horn = [this.horn];
    this.stitchMat = new THREE.MeshStandardMaterial({ color: "#8e8a83", roughness: 0.8 });

    this._shirt();
    this._tie();
    this._vest();
    this._jacket();
    this._trousers();
    this._shoes(cw);
    this._hat(cw);
    this.update(0);
  }

  // ---------------------------------------------------------------- helpers

  _piece(group, name, tube, spec, kind, rigName, from) {
    const uniforms = createClothUniforms(this.shared);
    const patch = buildPatch(tube, {
      uvScale: kind === "cotton" ? 18 : 12,
      wrinkle: spec.hinge || kind === "tie" ? 0 : kind === "cotton" ? 0.0028 : 0.0018,
      ...spec,
    });
    const make = (params) => clothMaterial(params, uniforms);
    const materials = [];
    if (kind === "cotton") {
      materials.push(make(this.material.cotton()));
    } else if (kind === "wool") {
      const m = make(this.material.wool(THREE.DoubleSide));
      this.mats.wool.push(m);
      materials.push(m);
    } else if (kind === "wool+lining") {
      const m = make(this.material.wool(this.full ? THREE.FrontSide : THREE.DoubleSide));
      this.mats.wool.push(m);
      materials.push(m);
      if (this.full) {
        const l = make(this.material.lining());
        this.mats.lining.push(l);
        materials.push(l);
      }
    } else if (kind === "lining") {
      const l = make({ ...this.material.lining(), side: THREE.DoubleSide });
      this.mats.lining.push(l);
      materials.push(l);
    } else if (kind === "tie") {
      const m = make(this.material.tie());
      this.mats.tie.push(m);
      materials.push(m);
    }

    const offset = from?.offset ?? patch.normal.clone().multiplyScalar(0.55);
    const rot = from?.rot ?? new THREE.Vector3();
    const piece = new Piece(name, patch, materials, uniforms, { offset, rot });
    this.rig[rigName].inner.add(piece.group);
    this.pieces.push(piece);
    this.byGroup[group].push(piece);
    return piece;
  }

  _button(piece, tube, theta, t, off, radius) {
    if (!this.full && radius < 0.008) return;
    const b = new THREE.Mesh(buttonGeometry(radius), this.horn);
    placeOnTube(b, tube, theta, t, off);
    piece.addDetail(b);
  }

  // Exploded pose: out along the piece normal, lifted, with a gentle tumble.
  _from(normal, dist, lift, seed, tumble = 0.5) {
    return {
      offset: normal.clone().multiplyScalar(dist).add(new THREE.Vector3(0, lift, 0)),
      rot: new THREE.Vector3(jitter(seed) * tumble, jitter(seed + 1) * tumble * 1.6, jitter(seed + 2) * tumble),
    };
  }

  _fromRing(index, total, radius, y, seed) {
    // Jacket parts orbit the form like the reference's exploded ring.
    const a = (index / total) * PI * 2 + 0.4;
    return {
      offset: new THREE.Vector3(Math.cos(a) * radius, y + jitter(seed) * 0.25, Math.sin(a) * radius * 0.55),
      rot: new THREE.Vector3(jitter(seed + 3) * 0.6, jitter(seed + 4) * 1.4, jitter(seed + 5) * 0.8),
    };
  }

  // ---------------------------------------------------------------- shirt

  _shirt() {
    const { torso, armL, armR } = this.body;
    const off = 0.006;
    const g = "shirt";
    let seed = 10;

    for (const s of [1, -1]) {
      const p = this._piece(
        g,
        `shirt-front-${s}`,
        torso,
        {
          cols: 34,
          rows: 60,
          offFn: () => (s > 0 ? off + 0.0012 : off),
          tRange: () => [-0.3, 0.532],
          thetaRange: () => [th(s, s > 0 ? -0.04 : 0.0), th(s, HALF + 0.03)],
        },
        "cotton",
        "torso",
        null
      );
      p.from = this._from(new THREE.Vector3(s * 0.55, 0, 0.85).normalize(), 0.7, 0.05, seed++);
      if (s > 0) {
        for (const t of [0.47, 0.36, 0.245, 0.13, 0.015, -0.1]) {
          this._button(p, torso, HALF, t, off + 0.0028, 0.0052);
        }
      }
    }

    const back = this._piece(
      g,
      "shirt-back",
      torso,
      {
        cols: 56,
        rows: 60,
        off,
        tRange: () => [-0.3, 0.532],
        thetaRange: () => [th(1, HALF - 0.03), th(1, PI * 1.5 + 0.03)],
      },
      "cotton",
      "torso"
    );
    back.from = this._from(new THREE.Vector3(0, 0, -1), 0.6, 0.25, seed++);

    // Collar band and the collar leaf that folds down over it.
    const band = this._piece(
      g,
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
      "torso"
    );
    band.from = this._from(new THREE.Vector3(0, 1, -0.3).normalize(), 0.45, 0, seed++, 0.3);

    const leafTop = 0.582;
    const leafPhi = (u) => 0.13 + u * (PI * 2 - 0.26);
    const leaf = this._piece(
      g,
      "shirt-collar-leaf",
      torso,
      {
        cols: 72,
        rows: 10,
        offFn: (theta, t) => 0.013 + (leafTop - t) * 0.42,
        tRange: (u) => {
          const p = leafPhi(u);
          const fromFront = Math.min(p, PI * 2 - p);
          return [leafTop - 0.048 - 0.03 * (1 - smooth(fromFront, 0.13, 0.7)), leafTop];
        },
        thetaRange: () => [th(1, 0.13), th(1, PI * 2 - 0.13)],
        centre: { theta: -HALF, t: 0.56 },
        hinge: foldAcrossT(torso, leafTop, 0.01),
      },
      "cotton",
      "torso"
    );
    leaf.from = this._from(new THREE.Vector3(0, 1, 0.2).normalize(), 0.5, 0, seed++, 0.3);

    for (const [arm, s] of [
      [armL, 1],
      [armR, -1],
    ]) {
      const rig = s > 0 ? "armL" : "armR";
      const sleeve = this._piece(
        g,
        `shirt-sleeve-${s}`,
        arm,
        {
          cols: 40,
          rows: 44,
          off,
          tRange: () => [-0.06, 0.86],
          thetaRange: () => [-PI, PI],
          centre: { theta: 0, t: 0.4 },
        },
        "cotton",
        rig
      );
      sleeve.from = this._from(new THREE.Vector3(s, 0.15, 0.2).normalize(), 0.75, 0.1, seed++);

      const cuff = this._piece(
        g,
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
        rig
      );
      cuff.from = this._from(new THREE.Vector3(s, -0.4, 0.4).normalize(), 0.55, -0.1, seed++);
      if (this.full) {
        // Onyx cufflink on the front of the French cuff.
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
        placeOnTube(link, arm, HALF + 0.35 * s * 0, 0.874, 0.0135);
        cuff.addDetail(link);
      }
    }
  }

  // ---------------------------------------------------------------- tie

  _tie() {
    const { torso } = this.body;
    const off = 0.0115;
    const halfWidth = (t) => {
      const w = lerp(0.043, 0.024, smooth(t, -0.06, 0.49));
      return w * THREE.MathUtils.clamp((t + 0.112) / 0.05, 0, 1);
    };
    const blade = this._piece(
      "tie",
      "tie-blade",
      torso,
      {
        cols: 10,
        rows: 56,
        off,
        tRange: () => [-0.112, 0.512],
        thetaRange: (t) => {
          const { rx } = torso.section(t);
          const h = halfWidth(t) / (rx + off);
          return [HALF - h, HALF + h];
        },
      },
      "tie",
      "torso"
    );
    blade.from = { offset: new THREE.Vector3(0, 0.9, 0.35), rot: new THREE.Vector3(-0.5, 0.2, 0.15) };

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
          const w = lerp(0.024, 0.015, smooth(t, 0.5, 0.553));
          const h = w / (rx + 0.02);
          return [HALF - h, HALF + h];
        },
      },
      "tie",
      "torso"
    );
    knot.from = { offset: new THREE.Vector3(0, 0.6, 0.45), rot: new THREE.Vector3(0.4, -0.6, 0.3) };
  }

  // ---------------------------------------------------------------- waistcoat

  _vest() {
    const { torso } = this.body;
    const off = 0.018;
    let seed = 40;
    const armhole = (t) => Math.sin(PI * THREE.MathUtils.clamp((t - 0.24) / 0.235, 0, 1));

    for (const s of [1, -1]) {
      const base = s > 0 ? -0.035 : 0.0;
      const phiIn = (t) => base + 0.74 * Math.pow(smooth(t, 0.13, 0.52), 0.85);
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
            return [-0.255 - 0.085 * (1 - smooth(phi, 0.0, 0.5)), 0.528];
          },
          thetaRange: (t) => [th(s, phiIn(t)), th(s, phiOut(t))],
        },
        "wool",
        "torso"
      );
      p.from = this._from(new THREE.Vector3(s * 0.8, 0.1, 0.7).normalize(), 0.75, 0.05, seed++);
      if (s > 0) {
        for (const t of [0.11, 0.01, -0.09, -0.19, -0.28]) {
          this._button(p, torso, HALF, t, off + 0.0034, 0.0062);
        }
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
        tRange: () => [-0.27, 0.528],
        thetaRange: (t) => [
          th(1, HALF - 0.02 + 0.55 * armhole(t)),
          th(1, PI * 1.5 + 0.02 - 0.55 * armhole(t)),
        ],
      },
      "lining",
      "torso"
    );
    back.from = this._from(new THREE.Vector3(0, 0, -1), 0.7, 0.2, seed++);
  }

  // ---------------------------------------------------------------- jacket

  _jacket() {
    const { torso, armL, armR } = this.body;
    const off = 0.034;
    const tB = -0.1; // button stance
    const ring = [];

    const phiIn = () => {
      const base = -0.075;
      return (t) =>
        t < tB
          ? base + 0.5 * Math.pow(smooth(t, tB, JACKET_HEM), 1.15)
          : base + 0.69 * smooth(t, tB, 0.545);
    };
    const lapelWidth = (t) => {
      const body = 0.088 * Math.pow(smooth(t, tB, 0.33), 0.75);
      const notch = 1 - 0.62 * smooth(t, 0.355, 0.372) * (1 - smooth(t, 0.392, 0.41));
      return body * notch * (1 - smooth(t, 0.47, 0.5) * 0.4);
    };

    for (const s of [1, -1]) {
      const fOff = s > 0 ? off + 0.003 : off;
      const pin = phiIn();
      const front = this._piece(
        "jacket",
        `jacket-front-${s}`,
        torso,
        {
          cols: 40,
          rows: 76,
          off: fOff,
          tRange: (u) => {
            const phi = lerp(0, HALF + 0.32, u);
            return [JACKET_HEM + 0.06 * (1 - smooth(phi, 0.0, 0.55)), 0.538];
          },
          thetaRange: (t) => [th(s, pin(t)), th(s, HALF + 0.32)],
        },
        "wool+lining",
        "torso"
      );
      ring.push(front);
      this["front" + s] = front;
      if (s > 0) {
        this._button(front, torso, HALF, tB, fOff + 0.0035, 0.0085);
        this._button(front, torso, HALF, tB - 0.13, fOff + 0.0035, 0.0085);
      }

      // Lapel: lies open over the chest, rolls back along the roll line.
      const lapel = this._piece(
        "jacket",
        `jacket-lapel-${s}`,
        torso,
        {
          cols: 14,
          rows: 70,
          off: fOff + 0.0045,
          tRange: () => [tB + 0.005, 0.5],
          thetaRange: (t) => {
            const { rx } = torso.section(t);
            const w = lapelWidth(t) / (rx + fOff);
            return [th(s, pin(t)), th(s, pin(t) + w)];
          },
          hinge: foldAcrossTheta(torso, (t) => th(s, pin(t)), fOff + 0.001),
        },
        "wool",
        "torso"
      );
      lapel.uniforms.uSpread.value = 0.35;
      lapel.from = { offset: new THREE.Vector3(0, 0, 0), rot: new THREE.Vector3() };
      this["lapel" + s] = lapel;

      // Hip pocket flap.
      const flap = this._piece(
        "jacket",
        `jacket-flap-${s}`,
        torso,
        {
          cols: 14,
          rows: 5,
          off: fOff + 0.004,
          tRange: () => [-0.27, -0.215],
          thetaRange: () => [th(s, 0.62), th(s, 1.12)],
          hinge: foldAcrossT(torso, -0.215, fOff + 0.004),
        },
        "wool",
        "torso"
      );
      flap.from = { offset: new THREE.Vector3(0, 0, 0), rot: new THREE.Vector3() };
      this["flap" + s] = flap;
    }

    // Breast welt + pocket square on the wearer's left.
    const welt = this._piece(
      "jacket",
      "jacket-welt",
      torso,
      {
        cols: 10,
        rows: 3,
        off: off + 0.006,
        tRange: () => [0.232, 0.252],
        thetaRange: () => [th(1, 0.33), th(1, 0.6)],
      },
      "wool",
      "torso"
    );
    welt.from = { offset: new THREE.Vector3(0.1, 0.2, 0.4), rot: new THREE.Vector3(0, 0, 0.4) };
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
      welt.addDetail(sq);
    }

    const back = this._piece(
      "jacket",
      "jacket-back",
      torso,
      {
        cols: 48,
        rows: 76,
        off,
        tRange: () => [JACKET_HEM, 0.538],
        thetaRange: () => [th(1, HALF + 0.32), th(1, PI * 1.5 - 0.32)],
      },
      "wool+lining",
      "torso"
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
      "torso"
    );
    ring.push(collar);

    for (const [arm, s] of [
      [armL, 1],
      [armR, -1],
    ]) {
      const rig = s > 0 ? "armL" : "armR";
      const sleeve = this._piece(
        "jacket",
        `jacket-sleeve-${s}`,
        arm,
        {
          cols: 44,
          rows: 56,
          off: 0.022,
          tRange: () => [-0.075, 0.885],
          thetaRange: () => [-PI, PI],
          centre: { theta: 0, t: 0.4 },
        },
        "wool+lining",
        rig
      );
      ring.push(sleeve);
      const btnTheta = -0.6;
      for (const t of [0.858, 0.836, 0.814, 0.792]) {
        this._button(sleeve, arm, btnTheta, t, 0.0242, 0.0064);
      }
      if (this.full) {
        const st = sleeveStitches(
          arm,
          { tHem: 0.874, tVentTop: 0.76, thetaVent: btnTheta + 0.24, off: 0.0234 },
          this.stitchMat
        );
        sleeve.addDetail(st);
      }
      if (s > 0) this.cuffArm = { tube: arm, theta: btnTheta, sleeve };
    }

    ring.forEach((p, i) => {
      p.from = this._fromRing(i, ring.length, 0.95, 0.05, 70 + i);
    });
    // Lapels, flaps and the welt are cut with their fronts and travel with them.
    for (const s of [1, -1]) {
      this["lapel" + s].from = this["front" + s].from;
      this["flap" + s].from = this["front" + s].from;
    }
    this.welt.from = this.front1.from;
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
        tRange: () => [-0.45, 0.03],
        thetaRange: () => [th(1, -PI), th(1, PI)],
      },
      "wool",
      "torso"
    );
    top.from = { offset: new THREE.Vector3(0, -0.6, 0.4), rot: new THREE.Vector3(0.3, 0, 0) };

    for (const [leg, s] of [
      [legL, 1],
      [legR, -1],
    ]) {
      const p = this._piece(
        "trousers",
        `trousers-leg-${s}`,
        leg,
        {
          cols: 40,
          rows: 64,
          // Pressed crease down the front of each leg.
          offFn: (theta) => {
            const d = Math.atan2(Math.sin(theta - HALF), Math.cos(theta - HALF));
            return 0.012 + 0.006 * Math.exp(-(d * d) / 0.012);
          },
          tRange: () => [-0.06, 1.0],
          thetaRange: () => [HALF - PI, HALF + PI],
          centre: { theta: HALF, t: 0.5 },
        },
        "wool",
        s > 0 ? "legL" : "legR"
      );
      p.from = {
        offset: new THREE.Vector3(s * 0.55, -0.35, 0.5),
        rot: new THREE.Vector3(0.4, s * 0.6, s * 0.25),
      };
    }
  }

  _shoes(cw) {
    const geo = shoeGeometry();
    for (const [leg, s] of [
      [this.body.legL, 1],
      [this.body.legR, -1],
    ]) {
      const m = new THREE.MeshPhysicalMaterial({
        color: cw.shoes,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.22,
      });
      this.mats.shoes.push(m);
      const shoe = new THREE.Mesh(geo, m);
      leg.centre(1.0, shoe.position);
      shoe.position.y -= 0.03;
      shoe.rotation.y = s * 0.08;
      this.rig[s > 0 ? "legL" : "legR"].inner.add(shoe);
      this.extras.shoes.push(shoe);
    }
    this.shoeState = { reveal: 0 };
  }

  _hat(cw) {
    const hat = fedora(cw.hat);
    hat.position.set(0, 0.785, 0.005);
    hat.rotation.x = 0.08;
    this.mats.hat.push(hat.userData.materials[0]);
    this.rig.torso.inner.add(hat);
    this.extras.hat = hat;
    this.hatState = { drop: 0 };
  }

  // ---------------------------------------------------------------- API

  /** Set the same state on every piece of a garment group. */
  set(group, key, value) {
    for (const p of this.byGroup[group]) p.state[key] = value;
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
    const l = new THREE.Color(cw.lining);
    for (const m of this.mats.lining) m.color.lerp(l, t);
    for (const m of this.mats.tie) m.color.lerp(new THREE.Color(cw.tie), t);
    for (const m of this.mats.hat) m.color.lerp(new THREE.Color(cw.hat), t);
    for (const m of this.mats.shoes) m.color.lerp(new THREE.Color(cw.shoes), t);
    if (t >= 1) this.colourway = name;
  }

  update(time) {
    for (const p of this.pieces) p.apply();

    const sr = this.shoeState.reveal;
    for (const s of this.extras.shoes) {
      s.visible = sr > 0.01;
      s.scale.setScalar(Math.max(sr, 0.001));
    }
    const hd = this.hatState.drop;
    const hat = this.extras.hat;
    hat.visible = hd > 0.01;
    hat.position.y = 0.785 + (1 - hd) * 0.55;
    hat.rotation.y = (1 - hd) * 1.2;
    hat.scale.setScalar(THREE.MathUtils.lerp(0.6, 1, hd));

    // Walk cycle: arms and legs counter-swing, the body bobs and sways.
    const w = this.walk.amount;
    const ph = time * 5.2 + this.walk.phase;
    const swing = Math.sin(ph) * w;
    this.rig.legL.pivot.rotation.x = swing * 0.32;
    this.rig.legR.pivot.rotation.x = -swing * 0.32;
    this.rig.armL.pivot.rotation.x = -swing * 0.2;
    this.rig.armR.pivot.rotation.x = swing * 0.2;
    this.root.position.y = Math.abs(Math.cos(ph)) * 0.022 * w;
    this.rig.torso.pivot.rotation.y = Math.sin(ph) * 0.04 * w;
    this.rig.torso.pivot.rotation.z = Math.sin(ph) * 0.012 * w;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
  }
}
