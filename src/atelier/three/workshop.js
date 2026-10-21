import * as THREE from "three";
import { FLOOR_Y } from "./body.js";
import { withReveal } from "./cloth.js";
import { patternTexture, tapeTexture, woodTexture } from "./textures.js";

/*
 * The atelier around the figure: the measuring tapes, the cutting table where
 * every pattern piece first lies flat (with chalk outlines, shears, a bolt of
 * cloth and a pendant lamp), and the cloth library's swatch rail.
 */

export const TABLE = {
  centre: new THREE.Vector3(2.45, FLOOR_Y + 0.9, 0.15),
  size: new THREE.Vector2(2.8, 1.6),
};

// Pile centres on the table (table-local x along its length, z across).
const PILES = {
  shirt: new THREE.Vector2(-0.68, -0.38),
  vest: new THREE.Vector2(0.72, -0.4),
  jacket: new THREE.Vector2(-0.68, 0.38),
  trousers: new THREE.Vector2(0.7, 0.36),
};

export const TABLE_PIECES = {
  shirt: [
    "shirt-back",
    "shirt-front--1",
    "shirt-front-1",
    "shirt-sleeve-1",
    "shirt-sleeve--1",
    "shirt-cuff-1",
    "shirt-cuff--1",
    "shirt-collar-band",
  ],
  vest: ["vest-back", "vest-front--1", "vest-front-1"],
  jacket: ["jacket-back", "jacket-front--1", "jacket-front-1", "jacket-sleeve-1", "jacket-sleeve--1", "jacket-welt"],
  trousers: ["trousers-leg-1", "trousers-leg--1", "trousers-top"],
};

/** A flat ribbon along a polyline, with a 0..1 arc parameter per vertex. */
function ribbon(points, width, upFn, closed = false) {
  const pts = closed ? [...points, points[0]] : points;
  const pos = [];
  const uv = [];
  const s = [];
  const idx = [];
  let acc = 0;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    acc += pts[i].distanceTo(pts[i - 1]);
    lens.push(acc);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tan = b.clone().sub(a).normalize();
    const up = upFn(pts[i], tan);
    const side = new THREE.Vector3().crossVectors(up, tan).normalize().multiplyScalar(width / 2);
    pos.push(...pts[i].clone().add(side).toArray(), ...pts[i].clone().sub(side).toArray());
    uv.push(lens[i], 0, lens[i], 1);
    s.push(lens[i] / acc, lens[i] / acc);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, length: acc };
}

function shearsModel(steel, handle) {
  const group = new THREE.Group();
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.006);
  bladeShape.lineTo(0.2, -0.001);
  bladeShape.quadraticCurveTo(0.205, 0.0, 0.2, 0.002);
  bladeShape.lineTo(0, 0.009);
  bladeShape.lineTo(0, -0.006);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.0025, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 2 });
  const ringGeo = new THREE.TorusGeometry(0.024, 0.0055, 12, 32);
  const blades = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    const blade = new THREE.Mesh(bladeGeo, steel);
    blade.position.z = s > 0 ? 0 : -0.003;
    pivot.add(blade);
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.004), steel);
    shank.position.set(-0.03, s * 0.008, 0);
    shank.rotation.z = s * 0.25;
    pivot.add(shank);
    const ring = new THREE.Mesh(ringGeo, handle);
    ring.scale.set(s > 0 ? 1 : 1.35, 0.8, 1);
    ring.position.set(-0.075, s * 0.025, 0);
    pivot.add(ring);
    blades.push(pivot);
    group.add(pivot);
  }
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.009, 16), steel);
  screw.rotation.x = Math.PI / 2;
  group.add(screw);
  return { group, blades };
}

export class Workshop {
  constructor(figure, { anisotropy = 8 } = {}) {
    this.figure = figure;
    this.group = new THREE.Group();
    this.reveal = { table: { value: 0 }, rail: { value: 0 } };
    this.look = {
      table: 0,
      chalk: 0,
      shears: 0,
      lamp: 0,
      tapeChest: 0,
      tapeWaist: 0,
      tapeSleeve: 0,
      tapes: 0,
      rail: 0,
    };

    this._tapes(anisotropy);
    this._table(anisotropy);
    this._rail();
  }

  // ---------------------------------------------------------------- tapes

  _tapes(anisotropy) {
    const { torso, armL } = this.figure.body;
    const tex = tapeTexture(anisotropy);
    tex.repeat.set(1 / 1.5, 1);
    this.tapeTex = tex;
    this.tapes = {};
    const make = (name, pts, upFn, closed) => {
      const { geometry, length } = ribbon(pts, 0.016, upFn, closed);
      const uniforms = { uCut: { value: 0 }, uFade: { value: 0 } };
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.55,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uCut;\nuniform float uFade;")
          .replace("#include <map_fragment>", "if (vMapUv.x * 1.5 > uCut) discard;\n#include <map_fragment>")
          .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= uFade;");
      };
      mat.customProgramCacheKey = () => "atelier-tape-1";
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.tapes[name] = { mesh, uniforms, length };
    };

    const loop = (y, off, turns = 1.08) => {
      const pts = [];
      const n = 160;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const th = Math.PI / 2 + 0.25 - u * Math.PI * 2 * turns;
        pts.push(torso.point(th, y + u * 0.012, off + u * 0.0025));
      }
      return pts;
    };
    // The ribbon's width lies in the body surface: "up" is the outward normal.
    const outward = (p) => {
      const { zc } = torso.section(p.y);
      return new THREE.Vector3(p.x, 0, p.z - zc).normalize();
    };
    make("chest", loop(0.3, 0.004), outward);
    make("waist", loop(0.03, 0.004), outward);

    const sleeve = [];
    for (let i = 0; i <= 80; i++) {
      const t = -0.03 + (i / 80) * 1.03;
      sleeve.push(armL.point(0.55, t, 0.004));
    }
    make("sleeve", sleeve, (p, tan) => {
      const t = p.clone().sub(armL.origin).dot(armL.axis) / armL.length;
      const n = p.clone().sub(armL.centre(t));
      return n.addScaledVector(tan, -n.dot(tan)).normalize();
    });
  }

  // ---------------------------------------------------------------- table

  _table(anisotropy) {
    const { centre, size } = TABLE;
    const R = this.reveal.table;
    const table = new THREE.Group();
    table.position.copy(centre);
    this.table = table;

    const wood = woodTexture(anisotropy);
    wood.repeat.set(1.4, 1);
    const woodMat = withReveal(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.0 }), R);
    const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.05, size.y), woodMat);
    top.position.y = -0.025;
    top.receiveShadow = true;
    top.castShadow = true;
    table.add(top);
    const legGeo = new THREE.BoxGeometry(0.07, 0.85, 0.07);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, woodMat);
        leg.position.set(sx * (size.x / 2 - 0.12), -0.05 - 0.425, sz * (size.y / 2 - 0.12));
        leg.castShadow = true;
        table.add(leg);
      }
    }

    // Cloth spread under each pile: poplin for the shirt, wool for the rest.
    const tex = this.figure.shared.textures;
    const sheet = (pile, w, d, cotton) => {
      const t = (cotton ? tex.cotton : tex.wool).map.clone();
      t.repeat.set(w * (cotton ? 18 : 12), d * (cotton ? 18 : 12));
      t.needsUpdate = true;
      const m = withReveal(
        new THREE.MeshPhysicalMaterial({
          color: cotton ? "#d9d6cd" : "#1a1d26",
          map: t,
          roughness: 0.85,
          sheen: 1,
          sheenColor: new THREE.Color(cotton ? "#ffffff" : "#8b95ad"),
          sheenRoughness: 0.5,
        }),
        R
      );
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pile.x, 0.0006, pile.y);
      mesh.receiveShadow = true;
      table.add(mesh);
    };
    sheet(PILES.shirt, 1.3, 0.74, true);
    sheet(PILES.vest, 1.2, 0.74, false);
    sheet(PILES.jacket, 1.32, 0.74, false);
    sheet(PILES.trousers, 1.3, 0.76, false);

    // Bolt of cloth at the table's end.
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 1.25, 48),
      withReveal(
        new THREE.MeshPhysicalMaterial({ color: "#1a1d26", map: tex.wool.map, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color("#8b95ad") }),
        R
      )
    );
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(size.x / 2 - 0.16, 0.11, 0);
    bolt.castShadow = true;
    table.add(bolt);

    // Lay the pattern pieces flat on their piles.
    const f = this.figure;
    for (const [group, names] of Object.entries(TABLE_PIECES)) {
      const pile = PILES[group];
      const at = new THREE.Vector3(centre.x + pile.x, centre.y + 0.004, centre.z + pile.y);
      f.layOnTable(names, at, 0, group.length * 7);
      if (group === "trousers") f.byName["trousers-top"].setTable(at.clone().add(new THREE.Vector3(0, 0.012, -0.05)), Math.PI / 2);
    }

    // Chalk: the outline of every piece, drawn on the cloth beneath it.
    const chalkPts = [];
    for (const names of Object.values(TABLE_PIECES)) {
      for (const n of names) chalkPts.push(f.byName[n].tableOutline(0.012));
    }
    const geos = chalkPts.map((pts) =>
      ribbon(
        pts.map((p) => p.clone().sub(centre).setY(0.0016)),
        0.0042,
        () => new THREE.Vector3(0, 1, 0),
        true
      ).geometry
    );
    this.chalkU = { uDraw: { value: 0 }, uReveal: R };
    const chalkMat = new THREE.MeshBasicMaterial({ color: "#e9e4d8", transparent: true, opacity: 0.85, depthWrite: false });
    chalkMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.chalkU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aS;\nvarying float vS;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvS = aS;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uDraw;\nuniform float uReveal;\nvarying float vS;")
        .replace("#include <opaque_fragment>", "if (vS > uDraw) discard;\n#include <opaque_fragment>\ngl_FragColor.rgb *= uReveal;");
    };
    this.chalkMeshes = geos.map((g) => {
      const m = new THREE.Mesh(g, chalkMat);
      table.add(m);
      return m;
    });

    // Shears travel the jacket front's outline.
    const steel = withReveal(new THREE.MeshStandardMaterial({ color: "#b9bcc2", metalness: 1, roughness: 0.22 }), R);
    const black = withReveal(new THREE.MeshStandardMaterial({ color: "#121214", roughness: 0.4 }), R);
    const shears = shearsModel(steel, black);
    shears.group.rotation.x = -Math.PI / 2;
    shears.group.traverse((o) => o.isMesh && (o.castShadow = true));
    this.shears = shears;
    this.shearsPath = f.byName["jacket-front-1"].tableOutline(0.012).map((p) => p.clone().sub(centre).setY(0.02));
    table.add(shears.group);

    // Tailor's chalk and a spool on the table.
    const chalk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.05), withReveal(new THREE.MeshStandardMaterial({ color: "#efece4", roughness: 0.9 }), R));
    chalk.rotation.y = 0.6;
    chalk.position.set(0.05, 0.003, -0.05);
    table.add(chalk);

    // Pendant lamp over the table.
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.32, 0.26, 48, 1, true),
      withReveal(new THREE.MeshStandardMaterial({ color: "#1d1e20", metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), R)
    );
    shade.position.set(0, 1.35, 0);
    table.add(shade);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), this.bulbMat);
    bulb.position.set(0, 1.3, 0);
    table.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 2.4, 6), black);
    cord.position.set(0, 2.67, 0);
    table.add(cord);
    const lamp = new THREE.SpotLight("#ffd6a3", 0, 4.5, 0.95, 0.6, 1.4);
    lamp.position.set(0, 1.28, 0);
    lamp.target.position.set(0, -0.5, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.camera.near = 0.2;
    lamp.shadow.camera.far = 3;
    table.add(lamp, lamp.target);
    this.lamp = lamp;

    this.group.add(table);
  }

  // ---------------------------------------------------------------- library rail

  _rail() {
    const R = this.reveal.rail;
    const rail = new THREE.Group();
    rail.position.set(-1.25, -0.2, -0.85);
    rail.rotation.y = 0.3;
    const brass = withReveal(new THREE.MeshStandardMaterial({ color: "#b48a4a", metalness: 1, roughness: 0.3 }), R);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 16), brass);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.72;
    rail.add(bar);
    for (const sx of [-0.75, 0.75]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72 - FLOOR_Y - 0.2, 12), brass);
      post.position.set(sx, (0.72 + FLOOR_Y + 0.2) / 2, 0);
      rail.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.02, 32), brass);
      foot.position.set(sx, FLOOR_Y + 0.21, 0);
      rail.add(foot);
    }
    this.panelTime = { value: 0 };
    this.panels = {};
    const kinds = ["plain", "chalk", "glen", "herringbone"];
    // Each swatch in a cloth that shows its weave.
    const tones = { plain: "#232838", chalk: "#2a3142", glen: "#7c7a76", herringbone: "#5b5246" };
    kinds.forEach((kind, i) => {
      const tex = patternTexture(kind);
      tex.map.repeat.set(3.6, 6.6);
      tex.bump.repeat.set(3.6, 6.6);
      const uniforms = { uTime: this.panelTime, uPhase: { value: i * 1.7 }, uLift: { value: 0 } };
      const mat = withReveal(
        new THREE.MeshPhysicalMaterial({
          color: tones[kind],
          map: tex.map,
          bumpMap: tex.bump,
          bumpScale: 1.4,
          roughness: 0.84,
          sheen: 1,
          sheenRoughness: 0.42,
          sheenColor: new THREE.Color("#8b95ad"),
          side: THREE.DoubleSide,
        }),
        R
      );
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader) => {
        prev(shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uPhase;\nuniform float uLift;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float hang = (0.275 - position.y) / 0.55;
            transformed.z += sin(position.y * 9.0 + uTime * 1.2 + uPhase) * 0.014 * hang
                           + sin(position.x * 14.0 + uTime * 0.9 + uPhase) * 0.006 * hang
                           + uLift * hang * 0.06;`
          );
      };
      mat.customProgramCacheKey = () => "atelier-panel-1";
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55, 16, 28), mat);
      panel.position.set(-0.54 + i * 0.36, 0.72 - 0.285, 0);
      panel.castShadow = true;
      panel.receiveShadow = true;
      rail.add(panel);
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.02, 0.012), brass);
      clip.position.set(panel.position.x, 0.72 - 0.012, 0);
      rail.add(clip);
      this.panels[kind] = { panel, uniforms, tex };
    });
    const light = new THREE.SpotLight("#fff1dc", 0, 4, 0.6, 0.7, 1.4);
    light.position.set(0.3, 1.9, 1.6);
    light.target.position.set(0, 0.4, 0);
    rail.add(light, light.target);
    this.railLight = light;
    this.rail = rail;
    this.group.add(rail);
  }

  patternFor(kind) {
    return this.panels[kind]?.tex;
  }

  highlight(kind) {
    for (const [k, p] of Object.entries(this.panels)) p.target = k === kind ? 1 : 0;
  }

  update(time) {
    const L = this.look;
    this.reveal.table.value = L.table;
    this.reveal.rail.value = L.rail;
    this.table.visible = L.table > 0.004;
    this.rail.visible = L.rail > 0.004;

    for (const [name, key] of [
      ["chest", "tapeChest"],
      ["waist", "tapeWaist"],
      ["sleeve", "tapeSleeve"],
    ]) {
      const tp = this.tapes[name];
      tp.uniforms.uCut.value = L[key] * tp.length;
      tp.uniforms.uFade.value = L.tapes;
      tp.mesh.visible = L.tapes > 0.004 && L[key] > 0.001;
    }

    this.chalkU.uDraw.value = L.chalk;
    for (const m of this.chalkMeshes) m.visible = L.chalk > 0.001 && L.table > 0.004;

    // Shears: glide along the outline, blades snipping.
    const path = this.shearsPath;
    const s = THREE.MathUtils.clamp(L.shears, 0, 1) * (path.length - 2);
    const i = Math.floor(s);
    const k = s - i;
    const a = path[i];
    const b = path[i + 1];
    const g = this.shears.group;
    g.position.lerpVectors(a, b, k);
    g.position.y = 0.02 + 0.05 * (1 - Math.sin(Math.PI * Math.min(1, L.shears * 1.02)));
    const dir = b.clone().sub(a);
    g.rotation.set(-Math.PI / 2, 0, Math.atan2(-dir.z, dir.x));
    const snip = L.shears > 0 && L.shears < 1 ? (Math.sin(time * 9) * 0.5 + 0.5) * 0.32 : 0.06;
    this.shears.blades[0].rotation.z = snip / 2;
    this.shears.blades[1].rotation.z = -snip / 2;
    g.visible = L.table > 0.01;

    this.lamp.intensity = 3.2 * L.lamp;
    this.bulbMat.color.setRGB(1, 0.86, 0.64).multiplyScalar(1.1 * L.lamp);

    this.railLight.intensity = 6 * L.rail;
    this.panelTime.value = time;
    for (const p of Object.values(this.panels)) {
      p.uniforms.uLift.value += ((p.target ?? 0) - p.uniforms.uLift.value) * 0.08;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.tapeTex.dispose();
    for (const p of Object.values(this.panels)) {
      p.tex.map.dispose();
      p.tex.bump.dispose();
    }
  }
}
