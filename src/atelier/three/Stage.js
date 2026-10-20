import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createBody } from "./body.js";
import { Suit } from "./suit.js";
import { Mannequin } from "./mannequin.js";
import { Atmosphere } from "./atmosphere.js";
import { cottonTexture, silkTexture, woolTexture } from "./textures.js";

const FOG = "#07080b";

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 1 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.1) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(1.0, vig, 0.75 * uVignette);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
      c.rgb *= uFade;
      gl_FragColor = c;
    }`,
};

/**
 * Owns the renderer, scene, camera and every 3D object. The scroll timeline
 * (choreography.js) only writes plain numbers into `stage.cam`, `stage.look`,
 * the suits' piece states and so on; `tick` turns those into pixels.
 */
export class Stage {
  constructor(container, { reducedMotion = false } = {}) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowPower ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(FOG, 1);
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.FogExp2(FOG, 0.11);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envTex;
    scene.environmentIntensity = 0.22;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    // Plain numbers the timeline animates. sx/sy shift the framing so the
    // figure sits opposite the chapter text without changing perspective.
    this.cam = { px: 0.25, py: 0.18, pz: 3.3, tx: 0, ty: 0.02, tz: 0, fov: 30, sx: 0.17, sy: 0, roll: 0 };
    this.look = {
      exposure: 1,
      mannequin: 1,
      turn: 0,
      street: 0,
      studio: 1,
      othersReveal: 0,
      approach: 0,
      fade: 1,
    };
    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();

    this._lights();

    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.shared = {
      uTime: { value: 0 },
      uFlutter: { value: reducedMotion ? 0 : 1 },
      textures: {
        wool: woolTexture(anisotropy),
        cotton: cottonTexture(anisotropy),
        silk: silkTexture(anisotropy),
      },
    };

    this.body = createBody();
    this.mannequin = new Mannequin(this.body);
    scene.add(this.mannequin.group);

    this.hero = new Suit(this.body, this.shared, { colourway: "midnight", detail: "full" });
    scene.add(this.hero.root);

    // The procession: three more finished suits, walking out of the fog.
    this.others = [
      { colourway: "flannel", x: -1.15, z: -0.75, phase: 1.3 },
      { colourway: "ivory", x: 1.2, z: -0.55, phase: 2.6 },
      { colourway: "bordeaux", x: 2.3, z: -1.7, phase: 0.6 },
    ].map((o) => {
      const s = new Suit(this.body, this.shared, { colourway: o.colourway, detail: "lite" });
      for (const p of s.pieces) Object.assign(p.state, { fly: 1, fold: 1, reveal: 1 });
      s.shoeState.reveal = 1;
      s.hatState.drop = 1;
      s.walk.amount = 1;
      s.walk.phase = o.phase;
      s.home = new THREE.Vector3(o.x, 0, o.z);
      s.root.visible = false;
      scene.add(s.root);
      return s;
    });

    this.atmosphere = new Atmosphere({
      fogColor: FOG,
      reducedMotion,
      lowPower: this.lowPower,
    });
    scene.add(this.atmosphere.group);

    this._composer();
    this._resize = this._resize.bind(this);
    this._onPointer = this._onPointer.bind(this);
    window.addEventListener("resize", this._resize);
    window.addEventListener("pointermove", this._onPointer, { passive: true });
    this._resize();

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.running = true;
    this.paused = false;
  }

  _lights() {
    const s = this.scene;
    // Overhead key: the visible light shaft.
    const key = new THREE.SpotLight("#fff4e6", 13, 9, 0.42, 0.75, 1.4);
    key.position.set(0.15, 3.6, 0.9);
    key.target.position.set(0, -0.1, 0);
    s.add(key, key.target);
    // Cool rims from behind, which pick out the sheen on the wool.
    const rimL = new THREE.SpotLight("#a9c1ff", 22, 9, 0.5, 0.9, 1.3);
    rimL.position.set(-2.4, 1.6, -2.2);
    rimL.target.position.set(0, 0, 0);
    const rimR = new THREE.SpotLight("#c4d2ff", 18, 9, 0.5, 0.9, 1.3);
    rimR.position.set(2.5, 1.2, -2.0);
    rimR.target.position.set(0, -0.2, 0);
    s.add(rimL, rimL.target, rimR, rimR.target);
    // Low frontal fill so the faces of the cloth never fall to pure black.
    const fill = new THREE.DirectionalLight("#9aa6c2", 0.35);
    fill.position.set(0.5, 0.4, 3);
    s.add(fill);
    const hemi = new THREE.HemisphereLight("#5c6577", "#050506", 0.25);
    s.add(hemi);
    // Warm street key, only during the procession.
    const street = new THREE.SpotLight("#ffb874", 0, 14, 0.75, 0.9, 1.2);
    street.position.set(2.8, 2.6, 2.5);
    street.target.position.set(0.4, -0.4, -0.5);
    s.add(street, street.target);
    this.lights = { key, rimL, rimR, fill, hemi, street };
  }

  _composer() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.55, 0.9);
    this.bloom.enabled = !this.lowPower || window.innerWidth > 900;
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    if (this.reducedMotion) this.finish.uniforms.uGrain.value = 0.02;
    composer.addPass(this.finish);
    this.composer = composer;
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _onPointer(e) {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }

  /** Where the hero's left cuff is, for the close-up camera. */
  cuffShot() {
    const { tube, theta } = this.hero.cuffArm;
    const at = tube.point(theta, 0.83, 0.03);
    const n = tube.outwardAt(theta, 0.83, 0.03);
    const pos = at.clone().addScaledVector(n, 0.42).add(new THREE.Vector3(0.0, 0.1, 0.24));
    return { pos, at };
  }

  _applyCamera() {
    const c = this.cam;
    const aspect = this.size.w / this.size.h;
    const cam = this.camera;
    const target = new THREE.Vector3(c.tx, c.ty, c.tz);
    const pos = new THREE.Vector3(c.px, c.py, c.pz);

    // Portrait screens: pull back so the figure fits the narrow width, and
    // lift it into the upper part of the frame above the text card.
    const portrait = aspect < 0.95;
    if (portrait) {
      const k = THREE.MathUtils.clamp(1.25 / aspect, 1, 2.3);
      pos.sub(target).multiplyScalar(k * 0.78).add(target);
    }

    if (!this.reducedMotion) {
      this.pointerSmooth.lerp(this.pointer, 0.04);
      const right = new THREE.Vector3().subVectors(pos, target).cross(cam.up).normalize();
      const dist = pos.distanceTo(target);
      pos.addScaledVector(right, -this.pointerSmooth.x * 0.025 * dist);
      pos.y += this.pointerSmooth.y * 0.018 * dist;
      pos.y += Math.sin(this.time * 0.35) * 0.008 * dist;
    }

    cam.position.copy(pos);
    cam.fov = c.fov;
    cam.lookAt(target);
    cam.rotateZ(c.roll);

    const { w, h } = this.size;
    const sx = portrait ? 0 : c.sx;
    const sy = portrait ? 0.13 : c.sy;
    cam.setViewOffset(w, h, -sx * w, sy * h, w, h);
    cam.updateProjectionMatrix();
  }

  tick() {
    if (!this.running) return;
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    const t = this.time;
    const L = this.look;

    this.shared.uTime.value = t;
    this.mannequin.uniforms.uFade.value = L.mannequin;
    this.mannequin.update(t);

    this.hero.root.rotation.y = L.turn;
    this.hero.update(t);

    const oRev = L.othersReveal;
    for (const s of this.others) {
      s.root.visible = oRev > 0.01;
      if (!s.root.visible) continue;
      for (const p of s.pieces) p.state.reveal = oRev;
      s.root.position.set(s.home.x, 0, THREE.MathUtils.lerp(s.home.z - 5, s.home.z, L.approach));
      s.walk.amount = this.reducedMotion ? 0 : 1;
      s.update(t);
    }

    const A = this.atmosphere.look;
    A.street = L.street;
    A.beam = L.studio;
    A.dust = L.studio;
    A.pool = L.studio;
    this.atmosphere.update(t, dt);

    const li = this.lights;
    li.key.intensity = 13 * (0.35 + 0.65 * L.studio);
    li.street.intensity = 22 * L.street;
    li.rimL.color.set("#a9c1ff").lerp(new THREE.Color("#ffc58e"), L.street * 0.5);

    this.renderer.toneMappingExposure = 1.05 * L.exposure;
    this.finish.uniforms.uTime.value = this.reducedMotion ? 0 : t;
    this.finish.uniforms.uFade.value = L.fade;

    this._applyCamera();
    this.composer.render(dt);
  }

  setPaused(paused) {
    this.running = !paused;
    if (!paused) this.timer.reset();
  }

  dispose() {
    this.running = false;
    window.removeEventListener("resize", this._resize);
    window.removeEventListener("pointermove", this._onPointer);
    this.timer.dispose();
    this.hero.dispose();
    this.others.forEach((s) => s.dispose());
    this.mannequin.dispose();
    this.atmosphere.dispose();
    Object.values(this.shared.textures).forEach(({ map, bump }) => {
      map.dispose();
      bump.dispose();
    });
    this.envTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
