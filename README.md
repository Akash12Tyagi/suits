# Octaboot — Tailoring for the few

A scroll-driven 3D web experience: a bespoke three-piece suit is cut flat, carried
to the tailor's form, and folded into shape piece by piece as you scroll. Scroll back
up and every piece unfolds again.

Research, technique decisions and risk notes: [`docs/ATELIER_RESEARCH.md`](docs/ATELIER_RESEARCH.md).
The cast — who wears the clothes, and how: [`docs/CHARACTERS.md`](docs/CHARACTERS.md).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run lint
```

The original API dashboard is still available at `/#/dashboard`.
**The Legacy Protocol** — a cinematic, scroll-directed short in four acts — lives at `/#/legacy`
(see [below](#the-legacy-protocol)).

Dev only: `/lab.html?who=luca&yaw=0.6` is a turntable for sculpting heads and hair
(`&view=hand&curl=0.3` for hands); `node dev/sdftest.mjs` times the sculpts.

## How it is built

| Path | Role |
|------|------|
| `src/atelier/Atelier.jsx` | Page: 12 chapters, text reveals, colour and cloth pickers, footer |
| `src/atelier/content.js` | All copy and chapter order |
| `src/atelier/scroll.js` | Lenis smooth scroll synced to GSAP ScrollTrigger |
| `src/atelier/three/body.js` | The body as parametric tubes (torso, arms, legs) |
| `src/atelier/three/rig.js` | 20-bone skeleton over the tubes, skin weights |
| `src/atelier/three/motion.js` | Procedural motion: idle breathing, IK walk cycle, cuff gesture, skirt sway |
| `src/atelier/three/characters.js` | The cast: skin, hair, face proportions per character |
| `src/atelier/three/sdf.js` | Signed-distance sculpting + Surface Nets mesher |
| `src/atelier/three/human.js` | Heads, hair, eyes, skinned hands, skin and hair shading; sculpted in workers |
| `src/atelier/three/character.js` | The wearer: head, hair, eyes, hands and body; hologram ↔ solid |
| `src/atelier/three/lookbook.js` | The daylight lookbook set (arch, plinth) |
| `src/atelier/three/cloth.js` | Pattern-piece generator + the fold / thickness / crease vertex shader |
| `src/atelier/three/figure.js` | Every garment piece, skinned to the rig; colourways (incl. Sage, Chestnut stripe) and styles (three-piece, open two-piece) |
| `src/atelier/three/workshop.js` | Measuring tapes, cutting table (chalk, shears, lamp), cloth-library rail |
| `src/atelier/three/choreography.js` | The single scrubbed timeline that drives all of it |
| `src/atelier/three/Stage.js` | Renderer, lights and shadows, camera framing, depth of field, post |
| `src/atelier/three/atmosphere.js` | Light shaft, dust, floor, street lamps, rain |

Every garment vertex stores two shapes: the piece **closed around the body** and
the same piece **laid flat** (or standing open, for collars and lapels). The shader
blends between them along a Bézier arc with a per-vertex delay, then adds cloth
thickness, elbow/knee compression creases and hem sway, applies the piece's flight
from the cutting table, and finally three.js skins it to the skeleton. The shadow
pass runs the same code, so shadows follow every fold.

The walk is IK-driven on a treadmill: planted feet move backward at exactly the
speed the street recedes, so they never slide.

To retime a chapter, edit `choreography.js`. Chapter *i* is pinned for timeline time
`[i, i + 0.545]`. To restyle the copy, edit `content.js`.

No images or models are downloaded: geometry, including the faces and hands, is generated in code, cloth, wood and
tape textures are drawn on a canvas at load, and fonts are self-hosted via `@fontsource`.

## The Legacy Protocol

*The end of an era. The rise of Doom.* A four-act short film rendered live in WebGL and
directed by scroll: a damaged helmet and a dying arc reactor, the armour coming apart into
embers, a silent gap, then a hall of iron where a cloaked figure calls up a sphere of green
energy. Open `/#/legacy`. An unofficial fan tribute; every model is sculpted in code and every
sound is synthesised in the browser.

Screenplay, storyboard, timelines and technical design: [`docs/LEGACY_PROTOCOL.md`](docs/LEGACY_PROTOCOL.md).

| Path | Role |
|------|------|
| `src/legacy/Legacy.jsx` | Gate (enter with / without sound), narration overlays, HUD, fallback |
| `src/legacy/content.js` | Acts, narration, title cards and their timeline times |
| `src/legacy/three/sculpts.js` | SDF sculpts: helmet shell + faceplate, Doom's mask, hood, armour |
| `src/legacy/three/sculpt.worker.js` | Meshes the sculpts in parallel workers |
| `src/legacy/three/shading.js` | Shared GLSL: simplex noise, the erosion field, metal wear |
| `src/legacy/three/helmetSet.js` | Acts I–II: helmet, faceplate servo, arc reactor, embers, shards |
| `src/legacy/three/doomSet.js` | Acts III–IV: hall, gears, figure, vertex-animated cloak, sigil, energy |
| `src/legacy/three/Stage.js` | Renderer, environments, post (DOF, bloom, grain), camera rig, heartbeat, adaptive quality |
| `src/legacy/three/choreography.js` | The single scrubbed timeline and the forward-only audio cue track |
| `src/legacy/audio/Score.js` | Web Audio synthesis of the whole soundtrack |

To retime a moment, edit `choreography.js` (camera, light and state tweens) and `content.js`
(copy). Timeline units are 3 per act; 1 unit ≈ 110 vh of scroll.
