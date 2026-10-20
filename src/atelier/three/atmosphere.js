import * as THREE from "three";
import { FLOOR_Y } from "./body.js";
import { glowSprite } from "./textures.js";

/*
 * Everything around the figure: the overhead light shaft, dust in the beam,
 * the floor (studio light pool ↔ wet street with lamp reflections), the
 * street lamps that drift past during the procession, and rain.
 */

const LAMP_ROWS = 6;
const LAMP_SPACING = 6;
const LAMP_X = 3.4;
const LAMP_H = 2.75;

export class Atmosphere {
  constructor({ fogColor, reducedMotion, lowPower }) {
    this.group = new THREE.Group();
    this.reducedMotion = reducedMotion;
    this.lamps = [];
    this.look = { beam: 1, dust: 1, pool: 1, street: 0, travel: 0 };

    this._beam();
    if (!lowPower) this._dust();
    this._floor(fogColor);
    this._street();
    if (!reducedMotion) this._rain(lowPower ? 500 : 1100);
  }

  _beam() {
    const geo = new THREE.CylinderGeometry(0.12, 1.25, 4.6, 64, 1, true);
    geo.translate(0, FLOOR_Y + 2.3, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          vH = uv.y;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main(){
          float edge = pow(abs(dot(vN, vV)), 2.2);
          float fall = smoothstep(0.0, 0.55, vH) * (0.35 + 0.65 * vH);
          float a = edge * fall * 0.11 * uIntensity;
          gl_FragColor = vec4(vec3(0.85, 0.88, 0.95) * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.renderOrder = 2;
    this.group.add(this.beam);
  }

  _dust() {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 1.1;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = FLOOR_Y + Math.random() * 3.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uMap: { value: glowSprite(64, 1.6) },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.05 + aSeed * 0.08);
          p.y = ${FLOOR_Y.toFixed(3)} + mod(p.y - ${FLOOR_Y.toFixed(3)} + t, 3.6);
          p.x += sin(t * 3.0 + aSeed * 40.0) * 0.06;
          p.z += cos(t * 2.0 + aSeed * 17.0) * 0.06;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.5 + aSeed * 3.5) * uScale / -mv.z * 3.0;
          vA = (0.25 + 0.75 * fract(aSeed * 7.0)) * smoothstep(${FLOOR_Y.toFixed(3)}, ${(FLOOR_Y + 0.6).toFixed(3)}, p.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uIntensity; varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vA * uIntensity * 0.55;
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  _floor(fogColor) {
    const lamps = [];
    for (let i = 0; i < LAMP_ROWS * 2; i++) lamps.push(new THREE.Vector2());
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uPool: { value: 1 },
        uStreet: { value: 0 },
        uTravel: { value: 0 },
        uTime: { value: 0 },
        uLamps: { value: lamps },
        uFogColor: { value: new THREE.Color(fogColor) },
        uFogDensity: { value: 0.11 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPool; uniform float uStreet; uniform float uTravel; uniform float uTime;
        uniform vec2 uLamps[${LAMP_ROWS * 2}];
        uniform vec3 uFogColor; uniform float uFogDensity;
        varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        void main(){
          vec2 p = vWorld.xz;
          vec3 col = vec3(0.010, 0.011, 0.014);

          // Studio: a soft pool of light under the form, brighter at the centre.
          float r2 = dot(p, p);
          col += vec3(0.62, 0.6, 0.58) * (exp(-r2 / 0.55) * 0.22 + exp(-r2 / 0.06) * 0.25) * uPool;

          // Street: wet setts drifting toward the camera, lamp reflections stretched into streaks.
          vec2 q = vec2(p.x, p.y - uTravel);
          vec2 cell = abs(fract(q * vec2(2.2, 3.0)) - 0.5);
          float joint = smoothstep(0.44, 0.5, max(cell.x, cell.y));
          float wet = noise(q * 1.7) * 0.6 + noise(q * 7.0) * 0.4;
          vec3 street = vec3(0.016, 0.017, 0.021) * (1.0 - joint * 0.6) + vec3(0.02, 0.022, 0.03) * wet;
          for (int i = 0; i < ${LAMP_ROWS * 2}; i++) {
            vec2 L = uLamps[i];
            float dz = p.y - L.y;
            float dx = p.x - L.x * (1.0 - clamp(dz, 0.0, 6.0) * 0.06);
            float w = 0.025 + max(dz, 0.0) * 0.012;
            float streak = exp(-dx * dx / w) * exp(-max(dz, 0.0) * 0.35) * smoothstep(-0.4, 0.2, dz);
            float ripple = 0.65 + 0.35 * noise(vec2(p.x * 9.0, q.y * 2.0 + uTime * 0.6));
            street += vec3(1.0, 0.68, 0.38) * streak * ripple * 0.75;
          }
          street += vec3(0.5, 0.55, 0.7) * exp(-r2 / 0.8) * 0.05;
          col = mix(col, street, uStreet);

          float d = length(vWorld - cameraPosition);
          float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60, 1, 1), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    this.group.add(floor);
  }

  _street() {
    this.street = new THREE.Group();
    const glow = glowSprite(128, 2.4);
    const poleMat = new THREE.MeshStandardMaterial({ color: "#0b0b0d", roughness: 0.6, metalness: 0.4 });
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.05, LAMP_H, 10);
    poleGeo.translate(0, LAMP_H / 2, 0);
    const lanternGeo = new THREE.CylinderGeometry(0.11, 0.07, 0.26, 6);
    this.lampHaloMat = new THREE.SpriteMaterial({
      map: glow,
      color: new THREE.Color("#ffb46b"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.lampCoreMat = new THREE.SpriteMaterial({
      map: glow,
      color: new THREE.Color("#fff1d8"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffcf96") });
    this.lanternMat = lanternMat;
    for (let i = 0; i < LAMP_ROWS; i++) {
      for (const side of [-1, 1]) {
        const lamp = new THREE.Group();
        lamp.add(new THREE.Mesh(poleGeo, poleMat));
        const lantern = new THREE.Mesh(lanternGeo, lanternMat);
        lantern.position.y = LAMP_H + 0.1;
        lamp.add(lantern);
        const halo = new THREE.Sprite(this.lampHaloMat);
        halo.scale.setScalar(1.6);
        halo.position.y = LAMP_H + 0.1;
        const core = new THREE.Sprite(this.lampCoreMat);
        core.scale.setScalar(0.45);
        core.position.y = LAMP_H + 0.1;
        lamp.add(halo, core);
        lamp.position.set(side * LAMP_X, FLOOR_Y, 0);
        lamp.userData = { row: i, side };
        this.street.add(lamp);
        this.lamps.push(lamp);
      }
    }
    this.group.add(this.street);
  }

  _rain(n) {
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 9;
      const y = Math.random() * 4.2;
      const z = -8 + Math.random() * 11;
      const len = 0.08 + Math.random() * 0.1;
      pos.set([x, y, z, x + len * 0.12, y + len, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; varying float vA;
        void main(){
          vec3 p = position;
          float seed = fract(sin(dot(floor(position.xz * 10.0), vec2(12.9898, 78.233))) * 43758.5453);
          p.y = ${FLOOR_Y.toFixed(3)} + mod(p.y - uTime * (5.5 + seed * 2.0), 4.2);
          p.x -= (p.y - ${FLOOR_Y.toFixed(3)}) * 0.08;
          vA = 0.3 + 0.7 * seed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.75, 0.8, 0.9) * 0.22 * vA * uIntensity, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  update(time, dt) {
    const L = this.look;
    if (!this.reducedMotion) L.travel += dt * 1.35 * L.street;

    this.beamMat.uniforms.uIntensity.value = L.beam;
    this.beam.visible = L.beam > 0.01;
    if (this.dust) {
      this.dustMat.uniforms.uTime.value = this.reducedMotion ? 0 : time;
      this.dustMat.uniforms.uIntensity.value = L.dust;
      this.dust.visible = L.dust > 0.01;
    }

    const fu = this.floorMat.uniforms;
    fu.uPool.value = L.pool;
    fu.uStreet.value = L.street;
    fu.uTravel.value = L.travel;
    fu.uTime.value = time;

    this.street.visible = L.street > 0.01;
    this.lampHaloMat.opacity = 0.55 * L.street;
    this.lampCoreMat.opacity = 0.9 * L.street;
    this.lanternMat.color.setRGB(1, 0.81, 0.59).multiplyScalar(L.street * 2.2);
    const span = LAMP_ROWS * LAMP_SPACING;
    for (const lamp of this.lamps) {
      const { row, side } = lamp.userData;
      // Lamps travel toward the camera and wrap around into the fog.
      let z = -row * LAMP_SPACING + (L.travel % LAMP_SPACING) + 4;
      if (z > 4) z -= span;
      lamp.position.z = z;
      const i = row * 2 + (side > 0 ? 1 : 0);
      fu.uLamps.value[i].set(side * LAMP_X, z);
    }

    if (this.rain) {
      this.rainMat.uniforms.uTime.value = time;
      this.rainMat.uniforms.uIntensity.value = L.street;
      this.rain.visible = L.street > 0.01;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
