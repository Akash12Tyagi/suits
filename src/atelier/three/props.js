import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const UP = new THREE.Vector3(0, 1, 0);

/** Orient an object so its +Y sits along the surface normal at (θ, t). */
export function placeOnTube(obj, tube, theta, t, off) {
  tube.point(theta, t, off, obj.position);
  const n = tube.outwardAt(theta, t, off, new THREE.Vector3());
  obj.quaternion.setFromUnitVectors(UP, n);
  return obj;
}

/*
 * A four-hole horn button: lathe profile with a dished face and raised rim,
 * holes baked in as darker vertex colour so each button is a single draw call.
 */
const buttonCache = new Map();
export function buttonGeometry(radius) {
  const key = radius.toFixed(4);
  if (buttonCache.has(key)) return buttonCache.get(key);
  const R = radius;
  const h = R * 0.32;
  const profile = [
    [0, h * 0.45],
    [R * 0.5, h * 0.5],
    [R * 0.72, h * 0.82],
    [R * 0.88, h],
    [R * 0.98, h * 0.82],
    [R, h * 0.4],
    [R * 0.96, 0],
    [0, 0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(profile, 40);
  const holes = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const hole = new THREE.CircleGeometry(R * 0.11, 12);
    hole.rotateX(-Math.PI / 2);
    hole.translate(Math.cos(a) * R * 0.24, h * 0.47, Math.sin(a) * R * 0.24);
    holes.push(hole);
  }
  const paint = (g, v) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3).fill(v);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const geo = mergeGeometries([paint(body, 1), ...holes.map((g) => paint(g, 0.05))]);
  buttonCache.set(key, geo);
  return geo;
}

export function hornMaterial(color = "#1c1612") {
  return new THREE.MeshPhysicalMaterial({
    color,
    vertexColors: true,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    sheen: 0.4,
    sheenColor: new THREE.Color("#5a4636"),
  });
}

/** Pick-stitching: tiny raised stitches along a path on the tube. */
export function stitchLine(tube, samples, material) {
  const stitch = new THREE.CapsuleGeometry(0.00055, 0.0026, 2, 6);
  const mesh = new THREE.InstancedMesh(stitch, material, samples.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  samples.forEach(({ theta, t, off, dir }, i) => {
    tube.point(theta, t, off, p);
    q.setFromUnitVectors(UP, dir);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function sleeveStitches(tube, { tHem, tVentTop, thetaVent, off, step = 0.0065 }, material) {
  const samples = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  // Around the hem.
  const { rx } = tube.section(tHem);
  const n = Math.round((Math.PI * 2 * (rx + off)) / step);
  for (let i = 0; i < n; i++) {
    if (i % 2) continue; // pick-stitch: visible every other step
    const th = (i / n) * Math.PI * 2;
    const dir = tube.tangentTheta(th, tHem, off, new THREE.Vector3()).normalize();
    samples.push({ theta: th, t: tHem, off, dir });
  }
  // Up the vent beside the buttons.
  const len = (tHem - tVentTop) * tube.length;
  const m = Math.round(len / step);
  for (let i = 0; i < m; i += 2) {
    const t = tHem - (i / m) * (tHem - tVentTop);
    tube.point(thetaVent, t + 0.01, off, a);
    tube.point(thetaVent, t - 0.01, off, b);
    samples.push({ theta: thetaVent, t, off, dir: a.sub(b).normalize().clone() });
  }
  return stitchLine(tube, samples, material);
}

/** Folded pocket square — three silk points rising from the welt. */
export function pocketSquareGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.034, 0);
  shape.lineTo(-0.026, 0.026);
  shape.lineTo(-0.012, 0.012);
  shape.lineTo(0.002, 0.034);
  shape.lineTo(0.014, 0.014);
  shape.lineTo(0.028, 0.024);
  shape.lineTo(0.034, 0);
  shape.lineTo(-0.034, 0);
  const g = new THREE.ShapeGeometry(shape, 6);
  // Slight curvature so it catches light like folded silk.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, -x * x * 6 + p.getY(i) * 0.15);
  }
  g.computeVertexNormals();
  return g;
}

/** A silk square worn puffed: a soft crumpled crown above the welt. */
export function pocketPuffGeometry() {
  const g = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const crumple = 1 + 0.18 * Math.sin(x * 9 + z * 7) * Math.sin(z * 11 - x * 5) + 0.08 * Math.sin(Math.atan2(z, x) * 7);
    p.setXYZ(i, x * 0.034 * crumple, (y - 0.2) * 0.02 * crumple, z * 0.012 * crumple);
  }
  g.computeVertexNormals();
  // Face the crown up out of the pocket (the square is oriented by lookAt).
  g.rotateX(Math.PI / 2);
  return g;
}

/** Fedora: pinched crown, ribbon band, brim snapped down at the front. */
export function fedora(feltColor, bandColor = "#0b0b0c") {
  const group = new THREE.Group();
  const crownProfile = [
    [0.0, 0.128],
    [0.03, 0.125],
    [0.062, 0.118],
    [0.078, 0.1],
    [0.083, 0.05],
    [0.086, 0.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const crown = new THREE.LatheGeometry(crownProfile, 48);
  const cp = crown.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    let x = cp.getX(i);
    let y = cp.getY(i);
    let z = cp.getZ(i) * 1.16;
    const top = THREE.MathUtils.smoothstep(y, 0.06, 0.128);
    // Centre dent running front to back, and front pinch.
    y -= 0.03 * top * Math.exp(-(x * x) / (0.028 * 0.028));
    if (z > 0) x *= 1 - 0.22 * top * (z / 0.1);
    cp.setXYZ(i, x, y, z);
  }
  crown.computeVertexNormals();

  const brimProfile = [
    [0.084, 0.004],
    [0.12, 0.0],
    [0.158, 0.006],
    [0.162, 0.012],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const brim = new THREE.LatheGeometry(brimProfile, 64);
  const bp = brim.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const z = bp.getZ(i) * 1.12;
    const r = Math.hypot(x, z);
    const k = THREE.MathUtils.smoothstep(r, 0.09, 0.165);
    // Sides curl up, front and back snap down.
    const side = (x * x) / (r * r + 1e-6);
    const y = bp.getY(i) + k * (0.022 * side - 0.016 * (1 - side));
    bp.setXYZ(i, x, y, z);
  }
  brim.computeVertexNormals();

  const felt = new THREE.MeshPhysicalMaterial({
    color: feltColor,
    roughness: 0.92,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(feltColor).lerp(new THREE.Color("#ffffff"), 0.3),
    side: THREE.DoubleSide,
  });
  const band = new THREE.MeshPhysicalMaterial({
    color: bandColor,
    roughness: 0.4,
    sheen: 1,
    sheenColor: new THREE.Color("#444"),
  });
  const ribbon = new THREE.CylinderGeometry(0.0855, 0.0875, 0.022, 48, 1, true);
  ribbon.scale(1, 1, 1.16);
  ribbon.translate(0, 0.016, 0);

  group.add(new THREE.Mesh(crown, felt));
  group.add(new THREE.Mesh(brim, felt));
  group.add(new THREE.Mesh(ribbon, band));
  group.userData.materials = [felt, band];
  return group;
}

/** A plain-toe oxford, sculpted from a sphere. */
export function shoeGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    // Long in z, flat sole, toe tapering and lower than the heel.
    const front = THREE.MathUtils.smoothstep(z, 0, 1);
    x *= 0.048 * (1 - 0.25 * front);
    y = y < 0 ? y * 0.008 : y * 0.052 * (1 - 0.45 * front);
    z *= 0.145;
    p.setXYZ(i, x, y, z + 0.045);
  }
  g.computeVertexNormals();
  return g;
}
