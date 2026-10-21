import * as THREE from "three";
const { headGeometry, hairGeometry } = await import(process.cwd() + "/src/atelier/three/human.js");
const { CAST } = await import(process.cwd() + "/src/atelier/three/characters.js");
let t = performance.now();
const h = headGeometry(CAST.luca);
console.log("head ms", Math.round(performance.now() - t), "verts", h.attributes.position.count, "tris", h.index.count / 3);
h.computeBoundingBox(); console.log("head box", h.boundingBox.min.toArray().map(v=>v.toFixed(3)), h.boundingBox.max.toArray().map(v=>v.toFixed(3)));
t = performance.now();
const hr = hairGeometry("wave");
console.log("hair ms", Math.round(performance.now() - t), "verts", hr.attributes.position.count);
hr.computeBoundingBox(); console.log("hair box", hr.boundingBox.min.toArray().map(v=>v.toFixed(3)), hr.boundingBox.max.toArray().map(v=>v.toFixed(3)));
// orientation check: average dot(faceNormal, vertexNormal)
const pos = h.attributes.position, nor = h.attributes.normal, ix = h.index.array; let agree = 0;
for (let i = 0; i < ix.length; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(pos, ix[i]), b = new THREE.Vector3().fromBufferAttribute(pos, ix[i+1]), c = new THREE.Vector3().fromBufferAttribute(pos, ix[i+2]);
  const f = b.sub(a).cross(c.sub(a)); const n = new THREE.Vector3().fromBufferAttribute(nor, ix[i]);
  if (f.dot(n) > 0) agree++;
}
console.log("agree", agree / (ix.length / 3));
// does the normal point outward at the nose tip?
let best = -1, bi = 0; for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > best) { best = pos.getZ(i); bi = i; }
console.log("front-most", pos.getX(bi).toFixed(3), pos.getY(bi).toFixed(3), best.toFixed(3), "normal z", nor.getZ(bi).toFixed(2));
