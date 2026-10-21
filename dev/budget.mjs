// Triangle budget of the sculpted parts (node dev/budget.mjs).
const { headGeometry, hairGeometry, handGeometry } = await import(process.cwd() + "/src/atelier/three/human.js");
const { CAST } = await import(process.cwd() + "/src/atelier/three/characters.js");
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
for (const q of [1, 0]) {
  console.log("quality", q, "head", tris(headGeometry(CAST.luca, q)), "hair wave", tris(hairGeometry("wave", q)), "hair part", tris(hairGeometry("part", q)));
}
const h = handGeometry();
console.log("hand", tris(h.left));
