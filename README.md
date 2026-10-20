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
| `src/atelier/Atelier.jsx` | Page: chapters, text reveals, colour swatches, footer |
| `src/atelier/content.js` | All copy and chapter order |
| `src/atelier/scroll.js` | Lenis smooth scroll synced to GSAP ScrollTrigger |
| `src/atelier/three/body.js` | The body as parametric tubes (torso, arms, legs) |
| `src/atelier/three/cloth.js` | Pattern-piece generator + the fold/unfold vertex shader |
| `src/atelier/three/suit.js` | Every garment piece (shirt, tie, waistcoat, jacket, trousers), buttons, rig |
| `src/atelier/three/choreography.js` | The single scrubbed timeline that drives all of it |
| `src/atelier/three/Stage.js` | Renderer, lights, camera framing, post-processing |
| `src/atelier/three/atmosphere.js` | Light shaft, dust, floor, street lamps, rain |
| `src/atelier/three/mannequin.js` | The glowing tailor's form |

Every garment vertex stores two shapes: the piece **closed around the body** and
the same piece **laid flat** (or standing open, for collars and lapels). The shader
blends between them along a Bézier arc with a per-vertex delay, so cloth wraps from its
centre outward and hinged pieces swing over their fold line.

To retime a chapter, edit `choreography.js`. Chapter *i* is pinned for timeline time
`[i, i + 0.545]`. To restyle the copy, edit `content.js`.

No images are downloaded: cloth textures are generated on a canvas at load, and fonts
are self-hosted via `@fontsource`.
