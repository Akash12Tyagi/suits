# Octaboot — Tailoring for the few

A scroll-driven 3D web experience: a bespoke three-piece suit is cut flat, carried
to the tailor's form, and folded into shape piece by piece as you scroll. Scroll back
up and every piece unfolds again.

Research, technique decisions and risk notes: [`docs/ATELIER_RESEARCH.md`](docs/ATELIER_RESEARCH.md).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run lint
```

The original API dashboard is still available at `/#/dashboard`.

## How it is built

| Path | Role |
|------|------|
| `src/atelier/Atelier.jsx` | Page: 12 chapters, text reveals, colour and cloth pickers, footer |
| `src/atelier/content.js` | All copy and chapter order |
| `src/atelier/scroll.js` | Lenis smooth scroll synced to GSAP ScrollTrigger |
| `src/atelier/three/body.js` | The body as parametric tubes (torso, arms, legs) |
| `src/atelier/three/rig.js` | 20-bone skeleton over the tubes, skin weights |
| `src/atelier/three/motion.js` | Procedural motion: idle breathing, IK walk cycle, cuff gesture, skirt sway |
| `src/atelier/three/character.js` | The wearer: sculpted head, jointed hands, hologram ↔ solid |
| `src/atelier/three/cloth.js` | Pattern-piece generator + the fold / thickness / crease vertex shader |
| `src/atelier/three/figure.js` | Every garment piece (shirt, tie, waistcoat, jacket, trousers), skinned to the rig |
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

No images or models are downloaded: geometry is generated in code, cloth, wood and
tape textures are drawn on a canvas at load, and fonts are self-hosted via `@fontsource`.
