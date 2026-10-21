import * as THREE from "three";
import { FLOOR_Y } from "./body.js";
import { withReveal } from "./cloth.js";

/*
 * The daylight lookbook set, after the reference photography: a pale grey
 * studio wall with an archway, a second wall seen through it, and a plinth.
 * It stands apart from the dark atelier (LOOKBOOK.x) and fades in by reveal.
 */
export const LOOKBOOK = { x: -7.7, z: 0 };

export class LookbookSet {
  constructor() {
    this.reveal = { value: 0 };
    this.group = new THREE.Group();
    this.group.position.set(LOOKBOOK.x, 0, LOOKBOOK.z);
    const plaster = () =>
      withReveal(new THREE.MeshStandardMaterial({ color: "#c3c5c9", roughness: 0.96, metalness: 0 }), this.reveal);

    // Front wall with an arched opening.
    const w = 7;
    const h = 4.2;
    const wall = new THREE.Shape();
    wall.moveTo(-w / 2, 0);
    wall.lineTo(w / 2, 0);
    wall.lineTo(w / 2, h);
    wall.lineTo(-w / 2, h);
    wall.lineTo(-w / 2, 0);
    const arch = new THREE.Path();
    const ax = -1.55;
    const aw = 0.62;
    const ah = 2.05;
    arch.moveTo(ax - aw, 0);
    arch.lineTo(ax - aw, ah);
    arch.absarc(ax, ah, aw, Math.PI, 0, true);
    arch.lineTo(ax + aw, 0);
    arch.lineTo(ax - aw, 0);
    wall.holes.push(arch);
    const front = new THREE.Mesh(new THREE.ExtrudeGeometry(wall, { depth: 0.22, bevelEnabled: false, curveSegments: 48 }), plaster());
    front.position.set(0, FLOOR_Y, -1.55);
    front.receiveShadow = true;
    front.castShadow = true;
    this.group.add(front);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plaster());
    back.position.set(0, FLOOR_Y + h / 2, -2.35);
    back.receiveShadow = true;
    this.group.add(back);

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.5), plaster());
    plinth.position.set(-2.55, FLOOR_Y + 0.475, -0.75);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.group.add(plinth);
  }

  update(reveal) {
    this.reveal.value = reveal;
    this.group.visible = reveal > 0.004;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
