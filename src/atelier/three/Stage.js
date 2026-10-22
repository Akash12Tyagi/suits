import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { createBody, FLOOR_Y } from "./body.js";
import { Figure, STYLES } from "./figure.js";
import { CAST } from "./characters.js";
import { prepareCast } from "./human.js";
import { LOOKBOOK, LookbookSet } from "./lookbook.js";
import { Atmosphere } from "./atmosphere.js";
import { Workshop } from "./workshop.js";
import { cottonTexture, silkTexture, woolTexture } from "./textures.js";

const FOG = "#07080b";
const DAY = "#a9abb0"; // the lookbook studio's pale grey (before tone mapping)

/**
 * Sculpt the cast off the main thread before the stage is built: the hero and
 * the lookbook models in close-up quality, the procession at distance quality.
 */
export function prepareStage(onProgress) {
  return prepareCast(
    [
      [CAST.luca, 2],
      [CAST.kenji, 2],
      [CAST.kenji, 0],
      [CAST.theo, 0],
      [CAST.marcus, 0],
    ],
    onProgress
  );
}

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
 * the figures' piece and motion states and so on; `tick` turns those into pixels.
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
    // A software rasteriser (no GPU, or a blocklisted one) gets the light path:
    // no multisampling and a 1x canvas.
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu);
    if (this.software) this.lowPower = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.software ? 1 : this.lowPower ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(FOG, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.03, 80);
    // Plain numbers the timeline animates. sx/sy shift the framing so the
    // figure sits opposite the chapter text without changing perspective.
    this.cam = { px: 0.25, py: 0.18, pz: 3.3, tx: 0, ty: 0.02, tz: 0, fov: 30, sx: 0.17, sy: 0, roll: 0 };
    this.look = {
      exposure: 1,
      turn: 0,
      street: 0,
      studio: 1,
      othersReveal: 0,
      approach: 0,
      fade: 1,
      dof: 0,
      day: 0, // 0 the dark atelier … 1 the daylight lookbook studio
      blackout: 0, // cuts between sets
      lookbook: 0,
    };
    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();
    this.drag = { enabled: false, active: false, angle: 0, vel: 0, lastX: 0 };

    this._lights();

    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.shared = {
      uTime: { value: 0 },
      uFlutter: { value: reducedMotion ? 0 : 1 },
      uAOStrength: { value: 1 },
      textures: {
        wool: woolTexture(anisotropy),
        cotton: cottonTexture(anisotropy),
        silk: silkTexture(anisotropy),
      },
    };

    this.body = createBody();
    this.hero = new Figure(this.body, this.shared, { colourway: "midnight", detail: "full", cast: CAST.luca, hologram: true });
    scene.add(this.hero.root);
    this.hero.bake();
    if (reducedMotion) this.hero.motion.state.breathe = 0;

    // The procession: three more finished suits, walking out of the fog.
    this.others = [
      { colourway: "flannel", x: -1.15, z: -0.75, phase: 0.31, cast: CAST.marcus },
      { colourway: "ivory", x: 1.2, z: -0.55, phase: 0.62, cast: CAST.theo },
      { colourway: "bordeaux", x: 2.3, z: -1.7, phase: 0.14, cast: CAST.kenji },
    ].map((o) => {
      const f = new Figure(this.body, this.shared, { colourway: o.colourway, detail: "lite", cast: o.cast });
      for (const p of f.pieces) Object.assign(p.state, { fly: 1, fold: 1, reveal: 1 });
      f.shoeState.reveal = 1;
      f.hatState.drop = 1;
      f.motion.state.walk = reducedMotion ? 0 : 1;
      f.motion.state.phase = o.phase;
      f.home = new THREE.Vector3(o.x, 0, o.z);
      f.root.visible = false;
      scene.add(f.root);
      return f.bake();
    });

    this.workshop = new Workshop(this.hero, { anisotropy });
    scene.add(this.workshop.group);

    // The lookbook: the two reference suits on two of the cast, in daylight.
    this.set = new LookbookSet();
    scene.add(this.set.group);
    this.models = [
      {
        cast: CAST.luca,
        colourway: "sage",
        at: new THREE.Vector3(LOOKBOOK.x - 0.65, 0, LOOKBOOK.z),
        yaw: 0.12,
        pose: { weight: "R", pocket: "R", button: "L", cross: false, headYaw: 0.42, headPitch: -0.05 },
      },
      {
        cast: CAST.kenji,
        colourway: "chestnut",
        at: new THREE.Vector3(LOOKBOOK.x + 0.75, 0, LOOKBOOK.z + 0.25),
        yaw: -0.1,
        pose: { weight: "L", pocket: "L", button: "R", cross: true, headYaw: -0.32, headPitch: -0.02 },
      },
    ].map((m) => {
      const f = new Figure(this.body, this.shared, {
        colourway: m.colourway,
        detail: "full",
        cast: m.cast,
        style: STYLES.openTwoPiece,
      });
      for (const p of f.pieces) Object.assign(p.state, { fly: 1, fold: 1, reveal: 1 });
      f.shoeState.reveal = 1;
      f.motion.state.pose = 1;
      f.motion.setPose(m.pose);
      f.hand.curl = 0.3;
      f.hand[m.pose.button === "L" ? "pinchL" : "pinchR"] = 0.6;
      f.place(m.at.x, 0, m.at.z, m.yaw);
      f.root.visible = false;
      scene.add(f.root);
      f.at = m.at;
      return f.bake();
    });

    this.atmosphere = new Atmosphere({
      fogColor: FOG,
      reducedMotion,
      lowPower: this.lowPower,
    });
    scene.add(this.atmosphere.group);

    // Shadows land on the floor through a transparent catcher.
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.62 })
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = FLOOR_Y + 0.001;
    catcher.receiveShadow = true;
    scene.add(catcher);

    this._composer();
    this._resize = this._resize.bind(this);
    this._onPointer = this._onPointer.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    window.addEventListener("resize", this._resize);
    window.addEventListener("pointermove", this._onPointer, { passive: true });
    window.addEventListener("pointerdown", this._onDown);
    window.addEventListener("pointerup", this._onUp);
    window.addEventListener("pointercancel", this._onUp);
    this._resize();

    // Adaptive resolution: hold ~60 fps by trading pixel ratio, with hysteresis.
    this.dprMax = Math.min(window.devicePixelRatio, this.software ? 1 : this.lowPower ? 1.5 : 2);
    this.dprMin = Math.min(1, this.dprMax);
    this.dpr = this.dprMax;
    this.frameMs = 16.7;
    this.dprCooldown = 0;

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.time = 0;
    this.running = true;
  }

  _lights() {
    const s = this.scene;
    const shadowSize = this.lowPower ? 1024 : 2048;
    // Overhead key: the visible light shaft, and the main shadow caster.
    const key = new THREE.SpotLight("#fff4e6", 13, 9, 0.42, 0.75, 1.4);
    key.position.set(0.15, 3.6, 0.9);
    key.target.position.set(0, -0.1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.012;
    key.shadow.camera.near = 1.2;
    key.shadow.camera.far = 7;
    key.shadow.radius = 4;
    s.add(key, key.target);
    // Cool rims from behind, which pick out the sheen on the wool.
    const rimL = new THREE.SpotLight("#a9c1ff", 22, 9, 0.5, 0.9, 1.3);
    rimL.position.set(-2.4, 1.6, -2.2);
    rimL.target.position.set(0, 0, 0);
    const rimR = new THREE.SpotLight("#c4d2ff", 18, 9, 0.5, 0.9, 1.3);
    rimR.position.set(2.5, 1.2, -2.0);
    rimR.target.position.set(0, -0.2, 0);
    s.add(rimL, rimL.target, rimR, rimR.target);
    const fill = new THREE.DirectionalLight("#9aa6c2", 0.35);
    fill.position.set(0.5, 0.4, 3);
    s.add(fill);
    const hemi = new THREE.HemisphereLight("#5c6577", "#050506", 0.25);
    s.add(hemi);
    // Warm street lamp key during the procession: long shadows on wet stone.
    const street = new THREE.SpotLight("#ffb874", 0, 16, 0.7, 0.85, 1.2);
    street.position.set(3.2, 2.9, 1.2);
    street.target.position.set(0.4, -0.6, -0.8);
    street.castShadow = !this.lowPower;
    street.shadow.mapSize.set(1024, 1024);
    street.shadow.bias = -0.0004;
    street.shadow.normalBias = 0.02;
    s.add(street, street.target);
    // Daylight: a big soft key over the lookbook set.
    const day = new THREE.DirectionalLight("#fff6ec", 0);
    day.position.set(LOOKBOOK.x + 2.2, 3.4, 3.0);
    day.target.position.set(LOOKBOOK.x, -0.4, 0);
    day.castShadow = true;
    day.shadow.mapSize.set(shadowSize, shadowSize);
    day.shadow.camera.left = -2.4;
    day.shadow.camera.right = 2.4;
    day.shadow.camera.top = 2.4;
    day.shadow.camera.bottom = -2.4;
    day.shadow.camera.near = 0.5;
    day.shadow.camera.far = 10;
    day.shadow.bias = -0.0003;
    day.shadow.normalBias = 0.015;
    day.shadow.radius = 4;
    s.add(day, day.target);
    this.lights = { key, rimL, rimR, fill, hemi, street, day };
  }

  _composer() {
    // The scene renders into the composer's target, not the canvas, so the
    // canvas's own antialiasing never applies: multisample the target instead.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.software ? 0 : this.lowPower ? 2 : 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 0.5, aperture: 0.02, maxblur: 0.008 });
    this.bokeh.enabled = false;
    composer.addPass(this.bokeh);
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
    const d = this.drag;
    if (d.active) {
      const dx = e.clientX - d.lastX;
      d.lastX = e.clientX;
      d.vel = (dx / window.innerWidth) * 4;
      d.angle += d.vel;
    }
  }

  // Drag to turn the figure (mouse and pen only, so touch keeps scrolling).
  _onDown(e) {
    if (!this.drag.enabled || e.pointerType === "touch") return;
    if (e.target.closest && e.target.closest("a, button, input")) return;
    this.drag.active = true;
    this.drag.lastX = e.clientX;
  }

  _onUp() {
    this.drag.active = false;
  }

  setDragEnabled(on) {
    this.drag.enabled = on;
    if (!on) this.drag.active = false;
    document.documentElement.classList.toggle("can-drag", on);
  }

  setPattern(kind) {
    const tex = this.workshop.patternFor(kind);
    if (tex) this.hero.setPattern(tex);
    this.workshop.highlight(kind);
  }

  /** Where the hero's left cuff is in its idle pose, for the close-up camera. */
  cuffShot() {
    const h = this.hero;
    h.update(0, 1 / 60);
    const { tube, theta } = h.cuffArm;
    const bone = h.rig.bones.foreArmL;
    const local = tube.point(theta, 0.83, 0.03).sub(h.rig.bind.foreArmL);
    const at = bone.localToWorld(local.clone());
    const n = tube.outwardAt(theta, 0.83, 0.03).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
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

    const dof = this.look.dof;
    this.bokeh.enabled = dof > 0.01 && !this.lowPower;
    if (this.bokeh.enabled) {
      const u = this.bokeh.uniforms;
      u.focus.value = pos.distanceTo(target);
      u.aperture.value = 0.028 * dof;
      u.maxblur.value = 0.009 * dof;
    }
  }

  _adaptResolution(rawDt) {
    if (this.warming) return;
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.05;
    this.dprCooldown -= rawDt;
    if (this.dprCooldown > 0) return;
    let next = this.dpr;
    if (this.frameMs > 19 && this.dpr > this.dprMin) next = Math.max(this.dprMin, this.dpr - 0.25);
    else if (this.frameMs < 13 && this.dpr < this.dprMax) next = Math.min(this.dprMax, this.dpr + 0.25);
    if (next !== this.dpr) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.composer.setPixelRatio(next);
      this._resize();
      this.dprCooldown = 2;
    }
  }

  tick() {
    if (!this.running) return;
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    if (rawDt > 0 && rawDt < 0.5) this._adaptResolution(rawDt);
    this.time += dt;
    const t = this.time;
    const L = this.look;

    this.shared.uTime.value = t;

    // Drag inertia; the figure settles back when dragging is switched off.
    const d = this.drag;
    if (!d.active) {
      d.angle += d.vel;
      d.vel *= 0.92;
      if (!d.enabled) d.angle *= 0.94;
    }
    // The hero is off-camera while the lookbook set is up.
    this.hero.root.visible = L.lookbook < 0.99;
    this.hero.place(0, 0, 0, L.turn + d.angle);
    if (this.hero.root.visible) this.hero.update(t, dt);
    const ground = this.hero.motion.out.groundSpeed;

    const oRev = L.othersReveal;
    for (const f of this.others) {
      f.root.visible = oRev > 0.01;
      if (!f.root.visible) continue;
      f.look.reveal = oRev;
      f.place(f.home.x, 0, THREE.MathUtils.lerp(f.home.z - 4, f.home.z, L.approach), 0);
      f.update(t, dt);
    }

    this.workshop.update(t);

    const lb = L.lookbook;
    this.set.update(lb);
    for (const f of this.models) {
      f.root.visible = lb > 0.01;
      if (!f.root.visible) continue;
      f.look.reveal = lb;
      f.update(t, dt);
    }

    // Daylight: the whole world brightens to the pale studio grey.
    const day = L.day;
    this.scene.background.set(FOG).lerp(this._dayColor || (this._dayColor = new THREE.Color(DAY)), day);
    this.scene.fog.color.copy(this.scene.background);
    this.scene.fog.density = THREE.MathUtils.lerp(0.11, 0.045, day);
    this.renderer.setClearColor(this.scene.background, 1);
    this.atmosphere.floorMat.uniforms.uFogColor.value.copy(this.scene.background);
    this.atmosphere.floorMat.uniforms.uFogDensity.value = this.scene.fog.density;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.22, 0.75, day);

    const A = this.atmosphere.look;
    A.street = L.street;
    A.beam = L.studio;
    A.dust = L.studio;
    A.pool = L.studio;
    A.day = L.day;
    this.atmosphere.update(t, dt, this.reducedMotion ? 0 : Math.max(ground, oRev > 0.01 ? 0.95 * L.street : 0));

    const li = this.lights;
    li.key.intensity = 13 * (0.35 + 0.65 * L.studio);
    li.street.intensity = 26 * L.street;
    li.rimL.color.set("#a9c1ff").lerp(new THREE.Color("#ffc58e"), L.street * 0.5);
    li.day.intensity = 2.2 * L.day;
    li.hemi.intensity = THREE.MathUtils.lerp(0.25, 1.1, L.day);
    li.hemi.color.set("#5c6577").lerp(new THREE.Color("#e9ecf2"), L.day);
    li.hemi.groundColor.set("#050506").lerp(new THREE.Color("#8d8e92"), L.day);
    li.fill.intensity = THREE.MathUtils.lerp(0.35, 0.9, L.day);
    this.finish.uniforms.uVignette.value = 1 - 0.7 * L.day;
    // Only lights that are on redraw their shadow maps.
    li.key.shadow.autoUpdate = li.key.intensity > 0.5 && L.day < 0.99;
    li.street.shadow.autoUpdate = li.street.intensity > 0.05;
    li.day.shadow.autoUpdate = li.day.intensity > 0.05;
    this.workshop.lamp.shadow.autoUpdate = this.workshop.lamp.intensity > 0.05;
    // A map that has never been drawn does not exist yet, and every lit
    // material samples it: draw each one at least once.
    for (const l of [li.key, li.street, li.day, this.workshop.lamp]) if (l.castShadow && !l.shadow.map) l.shadow.needsUpdate = true;
    // Bloom belongs to the dark atelier; on a pale set it only fogs the frame.
    this.bloom.strength = 0.38 * (1 - L.day);

    this.renderer.toneMappingExposure = 1.05 * L.exposure * (1 - 0.22 * L.day);
    // ACES gives the night atelier its roll-off but desaturates dark cloth;
    // the daylight lookbook shows real cloths, so it uses Khronos PBR Neutral,
    // made to keep product base colours true. It swaps inside the cut to black.
    this.renderer.toneMapping = L.day > 0.5 ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    this.finish.uniforms.uTime.value = this.reducedMotion ? 0 : t;
    this.finish.uniforms.uFade.value = L.fade * (1 - L.blackout);

    this._applyCamera();
    this.composer.render(dt);
  }

  /**
   * Render each chapter's state once, behind the loader, so every shader,
   * shadow and post-processing variant compiles before the first scroll
   * instead of hitching mid-story.
   */
  warmUp(timeline, chapters) {
    this.warming = true;
    // Compiling doesn't care about resolution; keep the warm-up frames cheap.
    this.renderer.setPixelRatio(0.25);
    this.composer.setPixelRatio(0.25);
    this._resize();
    const end = timeline.duration();
    for (let i = 0; i < chapters; i++) {
      timeline.seek(Math.min(end, i + 0.3), false);
      this.tick();
    }
    timeline.seek(0, false);
    this.renderer.setPixelRatio(this.dpr);
    this.composer.setPixelRatio(this.dpr);
    this._resize();
    this.warming = false;
    this.timer.reset();
  }

  setPaused(paused) {
    this.running = !paused;
    if (!paused) this.timer.reset();
  }

  dispose() {
    this.running = false;
    window.removeEventListener("resize", this._resize);
    window.removeEventListener("pointermove", this._onPointer);
    window.removeEventListener("pointerdown", this._onDown);
    window.removeEventListener("pointerup", this._onUp);
    window.removeEventListener("pointercancel", this._onUp);
    document.documentElement.classList.remove("can-drag");
    this.timer.dispose();
    this.hero.dispose();
    this.others.forEach((f) => f.dispose());
    this.models.forEach((f) => f.dispose());
    this.set.dispose();
    this.workshop.dispose();
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
