# Octaboot Atelier — research & technical design

Pre-production notes for the scroll-driven "suit that folds and unfolds" experience,
written before any code was produced. Everything the build relies on is listed here
so that design, animation and engineering decisions can be checked against it.

---

## 1. Reference breakdown (the concept video, 18.8 s, 896×718 @ 60 fps)

The recording is a single long page scrolled top to bottom. Each chapter pairs one
large visual with an editorial text block (eyebrow / serif headline / body / spec line)
that alternates left ↔ right, plus a small chapter index in the bottom-right corner.

| # | Eyebrow          | Headline                 | Spec line                              | Visual beat |
|---|------------------|--------------------------|----------------------------------------|-------------|
| 0 | —                | —                        | —                                      | Glowing, rim-lit male figure in a top-down light shaft; shirt cuffs hover at the wrists |
| 1 | The Foundation   | A Shirt of Pure Cotton   | Cloth — Egyptian two-ply poplin        | Shirt panels, sleeves and cuffs float in and close around the form |
| 2 | The Waistcoat    | Structure, Held Close    | Silk — Mulberry, woven in Como         | Tie drops into place, waistcoat fronts wrap; jacket parts start orbiting |
| 3 | The Canvas       | Built on Full Canvas     | Construction — hand-padded full canvas | Jacket fronts, sleeves, collar and cuffs hang in an exploded ring, then assemble |
| 4 | The Cut          | The Complete Silhouette  | Cloth — Super 150's merino · 240 g     | Finished three-piece; a man adjusts his cuff |
| 5 | The Man          | Made to Be Worn          | Individually made to measure           | Same man, camera pulls back |
| 6 | The Procession   | A Language of Colour     | Palette — four signature tones         | Four men in fedoras (grey, midnight, ivory, bordeaux) walk a wet, lamp-lit street |
| 7 | The Detail       | The Last Quarter-Inch    | Finish — working surgeon's cuffs       | Macro: four kissing horn buttons, pick-stitching, shirt cuff + onyx stud |
| 8 | The House of Fashion | Tailoring for the few. | CTA "Book a private fitting"          | Footer: Atelier / Wardrobe / Visit columns, "Made by hand, for a lifetime" |

Visual language: near-black stage (#07080a), a single overhead light shaft, cool
rim lights, haze and dust, warm-white highlights, champagne-gold hairlines on the CTA.
Typography: a high-contrast Garamond-style display serif + a geometric sans in tracked
small caps for eyebrows and specs.

## 2. How the reference was made — and why we do not copy that method

The reference frames are photoreal cloth with real wrinkles, a real actor, and
cross-dissolves between unrelated shots (figure → shirt → man → street). That is the
signature of **AI-generated video clips scrubbed by scroll**: clips are exported as an
image sequence and drawn to a `<canvas>` from a GSAP ScrollTrigger playhead (the
"Apple product page" technique; see GreenSock's official image-sequence helper and the
Codrops OPTIKKA case study, which moved from scrubbed `<video>` to frames because
video seeking stutters).

That technique needs a library of rendered/generated footage we do not have, ships
~150–300 compressed frames per chapter (tens of MB), and is not interactive: the
suit cannot be recoloured, rotated or re-lit.

**Decision: build it as real-time 3D (Three.js / WebGL).** Each garment is a real piece
of geometry that is literally *unfolded* (laid flat like a pattern piece on the cutting
table) and *folded* around the body as you scroll. Scrolling back up un-wraps it.
This is the closest faithful way to deliver "the suit can be unfolded and folded"
on the web, it weighs a few hundred KB, it stays sharp at any resolution, and it
allows interaction (colour swatches, pointer parallax). Section 9 documents how to add
an image-sequence mode later if photoreal footage is produced.

## 3. Stack (versions verified on npm on 2026-10-20)

| Need                        | Choice                          | Version  | Why |
|-----------------------------|---------------------------------|----------|-----|
| UI shell                    | React (already in repo) + Vite  | 19 / 7   | Existing toolchain, no migration |
| 3D                          | `three`                         | 0.186.1  | Mature WebGL renderer, `MeshPhysicalMaterial` has a **sheen** lobe made for cloth |
| Scroll → animation          | `gsap` + ScrollTrigger          | 3.15.0   | Scrubbed master timeline. GSAP and every plugin are free for commercial use since the Webflow acquisition |
| Smooth scrolling            | `lenis`                         | 1.3.27   | Standard pairing with ScrollTrigger |
| Fonts (self-hosted)         | `@fontsource/cormorant-garamond`, `@fontsource/jost` | 5.3.0 | Closest open matches to the reference; no third-party font requests |

Plain Three.js (not react-three-fiber) is used for the scene. A single scrubbed
timeline drives ~60 objects every frame, and keeping that out of React's reconciler
avoids re-renders on scroll. React owns only the DOM text layer.

## 4. Garment engine — how folding actually works

1. **Body as parametric tubes.** Torso, arms and legs are tubes `P(θ, s)` with
   elliptical cross-sections from measured keyframes (chest, waist, hip, shoulder
   slope, neck). Rows are spaced by *profile arc length*, not height, so the nearly
   horizontal shoulder line still gets enough vertices.
2. **Pattern pieces as patches.** Each garment piece (shirt front L/R, back, sleeves,
   cuffs, collar band and leaf, waistcoat fronts, jacket fronts, lapels, under-collar,
   pocket flaps, trouser legs…) is a region `(u,v) → (θ, s)` on a tube, offset by a
   per-layer ease (shirt 6 mm, waistcoat 18 mm, jacket 32 mm) so layers never z-fight.
3. **Two shapes per vertex.** `position` = wrapped onto the body; `flatPos` = the same
   piece **developed flat** (arc lengths unrolled around the piece's centre line, so
   it's a true flat pattern). Collars and lapels instead use a *hinge* shape: the
   leaf standing up / lapel lying open, which folds down over the roll line.
4. **Vertex shader morph** injected into `MeshPhysicalMaterial` with `onBeforeCompile`:
   a per-vertex delay (distance from the piece's centre or hinge) makes the cloth wrap
   progressively outward from the centre, like a tailor smoothing a panel onto a form.
   A lift term arcs hinged pieces through the air instead of cutting through the body,
   and a small time-based flutter makes pieces in flight move like fabric.
   Normals are blended the same way, so lighting stays correct mid-fold.
   Note: in three r186 `beginnormal_vertex` runs *before* `begin_vertex`, so the wrap
   weight is computed in the first chunk and reused in the second.
5. **Lining.** Jacket and waistcoat render twice from one geometry: wool on the
   front faces and a bordeaux silk lining on the back faces, sharing one uniform set.
6. **Reveal** multiplies the lit colour before fog, so pieces emerge from the dark
   with no transparency sorting.

## 5. Look development

* Wool: dark base colour, roughness ≈ 0.85, sheen ≈ 1 with a cool sheen tint (the
  soft edge glow wool has under rim light), and a procedural twill/sharkskin texture
  for the colour + bump maps, generated on a canvas, so nothing is downloaded.
* Cotton shirt: warm off-white, high roughness, white sheen; silk tie and lining:
  lower roughness, coloured sheen. Horn buttons: lathe profile with a dished face,
  four holes, clear-coat.
* Lighting: overhead key spot (the light shaft), two cool back rims, a weak fill, and a
  `RoomEnvironment` PMREM at low intensity for sheen and clear-coat reflections.
* Atmosphere: additive volumetric cone, dust motes, exponential fog, floor light-pool
  shader; the procession adds lamp posts, wet-floor reflection streaks and rain.
* Post: UnrealBloom (half-res), then a final pass for vignette + film grain, then
  `OutputPass` for ACES tone mapping and sRGB.

## 6. Choreography (one scrubbed master timeline)

Every chapter is a section of equal height (220 vh) with a sticky text block. One
GSAP timeline is scrubbed over the whole story, so the 3D state can never drift out of
sync with the text, and scrolling backwards plays every fold in reverse.
With equal sections, chapter *i* is pinned for timeline time `[i, i + 0.545]`, and its
3D beat is authored inside that window. Separate scrubbed timelines that tween the
same camera are a known GSAP pitfall (conflicting recorded start values), so a
single timeline is used.

## 7. Risks found during research, and mitigations

| Risk | Mitigation |
|------|------------|
| Lenis and ScrollTrigger ticking on separate loops → stale scroll reads | Lenis `raf` driven from `gsap.ticker`, `lenis.on('scroll', ScrollTrigger.update)`, `lagSmoothing(0)` (official Lenis README) |
| Loops stacking on React StrictMode double-mount | Every setup returns a full teardown: ticker callbacks removed, `lenis.destroy()`, triggers killed, renderer, geometries and materials disposed |
| `prefers-reduced-motion` | No Lenis smoothing, no flutter, dust, rain or camera sway; scroll still steps through the states |
| No WebGL | Feature-detect; the editorial text remains a fully readable page |
| Mobile GPU / battery | DPR capped (2 desktop / 1.5 mobile), bloom at half-res, render loop paused when the tab is hidden or the story is scrolled past |
| Portrait viewports | Camera distance and framing adapt to aspect ratio; text moves to a bottom card |
| Shader program cache | All cloth materials share one injected source → one compiled program; uniforms stay per piece |
| Text legibility over 3D | Text sits on a gradient scrim on mobile; contrast of body copy ≥ 4.5:1 |

## 8. Accessibility & content

The canvas is `aria-hidden`. Every chapter is a real `<section>` with an `<h2>`, so the
story reads top to bottom without the 3D. All controls are `<button>`s with labels,
focus rings are visible, and colour swatches expose `aria-pressed`.

## 9. Upgrade path: photoreal image-sequence mode (optional)

If you later produce photoreal footage (AI video or a CG render) and want it alongside
the 3D: export each clip at 1920 px wide → `ffmpeg -i clip.mp4 -vf fps=30,scale=1920:-1
frames/%04d.webp` (plus a ~960 px mobile set), roughly 120–180 frames per chapter on
desktop and 60–90 on mobile. Preload the current and neighbouring frames first and
draw to a canvas from a scrubbed playhead. The chapter timing in §6 stays the same.

## Sources

* GreenSock image-sequence helper — https://codepen.io/GreenSock/embed/VwgevYW
* Codrops, OPTIKKA: from HTML5 video to frame sequences — https://tympanus.net/codrops/?p=103024
* Lenis README (GSAP ScrollTrigger section) — https://cdn.jsdelivr.net/gh/darkroomengineering/lenis@1.3.26/README.md
* GSAP 3.15 README (licence: free incl. all plugins) — https://cdn.jsdelivr.net/npm/gsap@3.15.0/README.md
* Three.js r186 source (`ShaderLib/meshphysical.glsl.js`, `MeshPhysicalMaterial` sheen)

---

## 10. Second pass: realism (character, cloth, motion) and four new chapters

**Character.** The wearer is now a 20-bone skeleton (`rig.js`) laid over the body
tubes, with a sculpted mannequin head (brow, sockets, nose, lips, jaw and ears
deformed from a sphere) and jointed hands (palm, three phalanges per finger, thumb).
A photoreal human face can't be made convincingly in procedural real-time 3D, and a
near-miss would read as uncanny. Fine tailoring houses dress lacquered mannequins, and the
reference keeps faces in shadow, so the figure is an articulated atelier mannequin.
It starts as the glowing hologram from the opening shot and turns solid in
"Made to Be Worn".

**Cloth.** Garments are skinned to the skeleton (detached bind mode, bind = identity,
the root bone carries world placement). Each piece now has real thickness: an inner
shell plus edge strips with their own across-the-edge normals and an un-bumped
material, so cut edges never sparkle. Jackets and waistcoats show the lining on the
inner shell. Elbow and knee compression creases rise with the measured joint bend,
the jacket skirt lags the pelvis through a damped spring, and baked contact
shading darkens armpits, inner sleeves and inner thighs. A matching depth material makes
the shadows follow every fold.

**Motion.** `motion.js` blends idle (breathing, weight shift, head drift), a walk
and a gesture. The walk is a gait cycle on a treadmill: each foot is placed by
analytic two-bone IK with a forward knee pole, travels backward at exactly the street's
speed while planted (no foot sliding), and rolls through heel-strike and toe-off.
The pelvis bobs twice per stride, sways and rotates, the chest counter-rotates, and
the arms swing opposite the legs with a lagging elbow. The cuff gesture uses arm IK
plus a forearm twist so palm orientation is controlled.

**Proportions corrected** while deriving the gait: the hip joint moved up 16.5 cm
(a 1.83 m man has his hip joint about 0.93 m off the floor), the jacket hem now covers the seat
(-0.30), the waistcoat ends just below the waistband, and the button stance sits at
the natural waist.

**Light.** Soft spot-light shadows (key, street lamp, cutting-table pendant) land on a
shadow catcher over the custom floor. Depth of field (BokehPass) is used only in the
cuff macro, where every piece is in place so the depth override is exact.

**New chapters:** *The Measure* (three tapes wind on), *The Cutting Table* (every
unrolled piece lies flat on its pile with chalk outlines, the shears follow the
jacket front, a pendant lamp lights the table, and the pieces lift off the table in the
following chapters), *Made to Be Worn* (hologram to solid, cuff gesture), and *The Cloth
Library* (plain, chalk stripe, Glen check and herringbone, drawn procedurally and
applied to the suit). *The Cut* now lets you drag to turn the figure (mouse/pen).

---

## 11. Third pass: real people, and the reference suits

**Brief.** Recreate the two reference suits (sage two-piece; chestnut chalk stripe)
so they look real, worn by realistic models.

**Decisions.**
* The suits are recreated, not pasted: the reference photos carry another brand's
  label and are that brand's photography, so neither the images nor the mark are used.
  What *is* taken is the design: notch lapel, two black buttons, flap pockets, a
  puffed square, an open-collar white shirt with black buttons, slim trousers with a
  single break, brown oxfords, and the stances (hand in pocket, hand at the button,
  weight on one leg, a crossed foot).
* The models are **original characters** with the same editorial look. The faces
  of the men in the photographs are not reproduced. See `docs/CHARACTERS.md`.

**How the people are built.** Heads, hair and hands are signed-distance sculpts
(`sdf.js`, `human.js`) meshed with Surface Nets using a narrow band, so only cells
near the surface are evaluated exactly. Faces follow the facial thirds. Eyes are
textured spheres behind sculpted lids. Hair is a volume clipped to a hairline
(waved, side-parted or cropped), with a shader that ripples the normal across the
strands. Skin is painted per vertex (brows, beard shadow, lips, warmth) and shaded
with wrapped diffuse and a red terminator in place of subsurface scattering. Hands
have 15 finger bones and are skinned by inverse distance to each phalanx. The whole
cast is sculpted in parallel Web Workers before the stage is built (about 0.6 s per
head, 0.4 s per hair style, 0.6 s for the hands on one core).

**Gotchas found while building it.**
* Hand geometry is modelled in its own frame, so the mesh must sit at the hand
  root's bind transform and bind with that matrix. Binding at identity scattered the
  vertices.
* A material with `vertexColors` on geometry without a colour attribute renders
  black. The body uses an unpainted skin material.
* `Math.hypot` dominated the sculpt time; plain `Math.sqrt` halved it.
* three r186 removed `PCFSoftShadowMap`; `PCFShadowMap` with `shadow.radius` is used.

**New chapters:** *The Collection No. 1 (Sage)* and *No. 2 (Chestnut chalk stripe)*,
in a daylight studio with an arch and plinth after the reference set. The page
chrome switches to dark ink there, and a cut to black hides the jump between sets.
