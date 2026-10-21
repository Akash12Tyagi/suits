// Dev-only turntable for sculpting heads, hair and hands (open /lab.html).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CAST } from "../src/atelier/three/characters.js";
import { headGeometry, hairGeometry, skinMaterial, hairMaterial, eyeballs, handGeometry, handBones, poseHumanHand } from "../src/atelier/three/human.js";

const q = new URLSearchParams(location.search);
const who = q.get("who") || "luca";
const yaw = parseFloat(q.get("yaw") || "0.5");
const view = q.get("view") || "head";
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#3a3d44");
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const key = new THREE.DirectionalLight("#fff3e6", 2.2);
key.position.set(1, 1.5, 2);
scene.add(key);
const rim = new THREE.DirectionalLight("#b8c8ff", 1.2);
rim.position.set(-2, 1, -2);
scene.add(rim);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 10);
const d = CAST[who];
const reveal = { value: 1 };
const t0 = performance.now();
const group = new THREE.Group();
if (view === "head") {
  group.add(new THREE.Mesh(headGeometry(d), skinMaterial(d.skin, reveal)));
  group.add(new THREE.Mesh(hairGeometry(d.hairStyle), hairMaterial(d.hair, reveal)));
  group.add(eyeballs(d.eyes, reveal).group);
  cam.position.set(0, 0.0, 0.62);
} else {
  const { left, bones } = handGeometry();
  const hb = handBones(1);
  const mesh = new THREE.SkinnedMesh(left, skinMaterial(d.skin, reveal));
  mesh.add(hb.root);
  mesh.bind(new THREE.Skeleton(hb.list));
  poseHumanHand(hb, parseFloat(q.get("curl") || "0.25"), parseFloat(q.get("pinch") || "0"));
  group.add(mesh);
  group.position.y = 0.08;
  cam.position.set(0, -0.0, 0.55);
  void bones;
}
console.log("build ms", Math.round(performance.now() - t0));
group.rotation.y = yaw;
scene.add(group);
cam.lookAt(0, 0, 0);
renderer.render(scene, cam);
document.title = "ready";
