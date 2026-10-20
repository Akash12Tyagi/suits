import * as THREE from "three";
import { FLOOR_Y } from "./body.js";

/*
 * The tailor's form from the opening shot: a dark body read only by its
 * glowing rim, with faint measuring contours, revealed by a rising scan line.
 */

function tubeGeometry(tube, t0, t1, cols = 56, rows = 64, off = 0) {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = tube.tBetween(t0, t1, j / rows);
    for (let i = 0; i <= cols; i++) {
      const p = tube.point((i / cols) * Math.PI * 2, t, off);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const vertexShader = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vNormalV = normalize(normalMatrix * normal);
  vViewV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform float uReveal;
uniform float uFade;
uniform float uTime;
uniform vec3 uColor;
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  float scanY = mix(-1.15, 0.75, uReveal);
  if (vWorld.y > scanY) discard;
  vec3 n = normalize(vNormalV);
  float facing = abs(dot(n, normalize(vViewV)));
  float rim = pow(1.0 - facing, 2.2);
  float contour = smoothstep(0.985, 1.0, abs(sin(vWorld.y * 48.0))) * 0.12;
  float edge = exp(-abs(vWorld.y - scanY) * 55.0) * (1.0 - step(0.999, uReveal));
  float shimmer = 0.85 + 0.15 * sin(uTime * 1.3 + vWorld.y * 6.0);
  vec3 col = uColor * (0.012 + rim * 1.5 * shimmer + contour * rim * 2.0);
  col += vec3(0.9, 0.95, 1.0) * edge * 1.6;
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export class Mannequin {
  constructor(body) {
    this.uniforms = {
      uReveal: { value: 0 },
      uFade: { value: 1 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#c9d6ee") },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
    });
    this.group = new THREE.Group();
    const m = this.material;
    const add = (g) => this.group.add(new THREE.Mesh(g, m));

    add(tubeGeometry(body.torso, -0.47, 0.64, 64, 90));
    add(tubeGeometry(body.armL, -0.05, 0.9, 32, 48));
    add(tubeGeometry(body.armR, -0.05, 0.9, 32, 48));

    // Neck cap and hip cap close the form.
    const neck = body.torso.section(0.64);
    const cap = new THREE.CircleGeometry(1, 40);
    cap.rotateX(-Math.PI / 2);
    cap.scale(neck.rx, 1, neck.rz);
    cap.translate(0, 0.64, neck.zc);
    add(cap);
    const hip = body.torso.section(-0.47);
    const base = new THREE.CircleGeometry(1, 48);
    base.rotateX(Math.PI / 2);
    base.scale(hip.rx, 1, hip.rz);
    base.translate(0, -0.47, 0);
    add(base);

    // Stand: pole and foot.
    const pole = new THREE.CylinderGeometry(0.012, 0.012, -0.47 - FLOOR_Y, 16);
    pole.translate(0, (-0.47 + FLOOR_Y) / 2, 0);
    add(pole);
    const foot = new THREE.CylinderGeometry(0.16, 0.19, 0.03, 48);
    foot.translate(0, FLOOR_Y + 0.015, 0);
    add(foot);
  }

  update(time) {
    this.uniforms.uTime.value = time;
    this.group.visible = this.uniforms.uFade.value > 0.004 && this.uniforms.uReveal.value > 0.001;
  }

  dispose() {
    this.group.traverse((o) => o.isMesh && o.geometry.dispose());
    this.material.dispose();
  }
}
