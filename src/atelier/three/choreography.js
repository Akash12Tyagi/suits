import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/*
 * One scrubbed timeline for the whole story. Every chapter section is the
 * same height (CHAPTER_VH), so chapter i is pinned for timeline time
 * [i, i + 1 - VIEW] and moves out during [i + 1 - VIEW, i + 1].
 * Scrolling backwards plays every fold in reverse — the suit unfolds.
 */
export const CHAPTER_VH = 220;
const VIEW = 100 / CHAPTER_VH;

function assemble(tl, pieces, start, o = {}) {
  const { stagger = 0.05, fly = 0.42, foldAt = 0.2, fold = 0.42, from = 0 } = o;
  pieces.forEach((p, i) => {
    const s = start + i * stagger;
    tl.to(p.state, { reveal: 1, duration: 0.12 }, s);
    tl.fromTo(p.state, { fly: from }, { fly: 1, duration: fly, ease: "power3.out", immediateRender: false }, s);
    tl.to(p.state, { fold: 1, duration: fold, ease: "power2.inOut" }, s + foldAt);
  });
}

export function buildChoreography(stage, storyEl, { chapters, reducedMotion }) {
  const { hero, cam, look } = stage;
  const pieces = Object.fromEntries(hero.pieces.map((p) => [p.name, p]));
  const P = (...names) => names.map((n) => pieces[n]);
  const cuff = stage.cuffShot();

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: storyEl,
      start: "top top",
      end: "bottom bottom",
      scrub: reducedMotion ? true : 0.9,
    },
  });
  tl.set({}, {}, chapters - VIEW); // fix the timeline length to the scroll length

  // ---- Camera keys, one per chapter. sx > 0 pushes the figure right (text left).
  const keys = [
    null,
    { px: 0.38, py: 0.24, pz: 2.75, tx: 0, ty: 0.1, tz: 0, fov: 30, sx: 0.15, sy: 0 },
    { px: -0.42, py: 0.26, pz: 2.6, tx: 0, ty: 0.12, tz: 0, fov: 30, sx: -0.15, sy: 0 },
    { px: 0.12, py: 0.2, pz: 3.75, tx: 0, ty: 0.04, tz: 0, fov: 30, sx: 0.13, sy: 0 },
    { px: 0.95, py: -0.05, pz: 4.9, tx: 0, ty: -0.24, tz: 0, fov: 30, sx: -0.14, sy: 0 },
    { px: 0.7, py: -0.12, pz: 6.1, tx: 0.55, ty: -0.12, tz: -0.7, fov: 30, sx: -0.13, sy: 0 },
    {
      px: cuff.pos.x,
      py: cuff.pos.y,
      pz: cuff.pos.z,
      tx: cuff.at.x,
      ty: cuff.at.y,
      tz: cuff.at.z,
      fov: 26,
      sx: 0.2,
      sy: 0,
    },
    { px: 0, py: 0.3, pz: 6.2, tx: 0, ty: -0.12, tz: 0, fov: 30, sx: 0, sy: -0.06 },
  ];
  for (let i = 1; i < keys.length; i++) {
    tl.to(cam, { ...keys[i], duration: 0.72, ease: "power2.inOut" }, i - 0.62);
  }

  // ---- 1 · The shirt: pattern pieces fly in flat and close around the form.
  look.mannequin = 1;
  tl.to(look, { mannequin: 0.38, duration: 0.5 }, 0.75);
  assemble(
    tl,
    P(
      "shirt-back",
      "shirt-front--1",
      "shirt-front-1",
      "shirt-sleeve-1",
      "shirt-sleeve--1",
      "shirt-cuff-1",
      "shirt-cuff--1",
      "shirt-collar-band"
    ),
    0.34,
    { stagger: 0.05, fold: 0.38 }
  );
  // Collar leaf arrives standing, then folds down over the band.
  const leaf = pieces["shirt-collar-leaf"];
  tl.to(leaf.state, { reveal: 1, duration: 0.1 }, 0.82);
  tl.fromTo(leaf.state, { fly: 0 }, { fly: 1, duration: 0.25, ease: "power3.out", immediateRender: false }, 0.82);
  tl.to(leaf.state, { fold: 1, duration: 0.3, ease: "power2.inOut" }, 1.05);

  // ---- 2 · Tie and waistcoat.
  assemble(tl, P("tie-blade", "tie-knot"), 1.4, { stagger: 0.06, fly: 0.35, foldAt: 0.12, fold: 0.3 });
  assemble(tl, P("vest-back", "vest-front--1", "vest-front-1"), 1.55, { stagger: 0.08 });
  tl.to(look, { mannequin: 0.12, duration: 0.4 }, 1.8);

  // ---- 3 · The jacket: parts gather into an orbit, hold, then close in.
  const ring = P(
    "jacket-back",
    "jacket-front--1",
    "jacket-front-1",
    "jacket-sleeve-1",
    "jacket-sleeve--1",
    "jacket-collar"
  );
  ring.forEach((p, i) => {
    const s = 2.35 + i * 0.05;
    tl.to(p.state, { reveal: 1, duration: 0.2 }, s);
    tl.fromTo(p.state, { fly: -0.5 }, { fly: 0.1, duration: 0.5, ease: "power2.out", immediateRender: false }, s);
    // Already half-shaped while they orbit, like pieces off the tailor's bench.
    tl.to(p.state, { fold: 0.5, duration: 0.45, ease: "sine.inOut" }, s + 0.05);
  });
  tl.to(look, { mannequin: 0, duration: 0.35 }, 2.6);
  ring.forEach((p, i) => {
    const s = 2.98 + i * 0.045;
    tl.to(p.state, { fly: 1, duration: 0.36, ease: "power3.inOut" }, s);
    tl.to(p.state, { fold: 1, duration: 0.34, ease: "power2.inOut" }, s + 0.12);
  });
  // Lapels lie open over the chest, then roll back on the roll line.
  for (const name of ["jacket-lapel-1", "jacket-lapel--1", "jacket-flap-1", "jacket-flap--1", "jacket-welt"]) {
    const p = pieces[name];
    tl.set(p.state, { fly: 1 }, 3.3);
    tl.to(p.state, { reveal: 1, duration: 0.06 }, 3.3);
    tl.to(p.state, { fold: 1, duration: 0.24, ease: "power2.inOut" }, name.includes("lapel") ? 3.36 : 3.44);
  }

  // ---- 4 · The complete silhouette: trousers rise into place, shoes, a slow turn.
  assemble(tl, P("trousers-top", "trousers-leg-1", "trousers-leg--1"), 3.55, { stagger: 0.07 });
  tl.to(hero.shoeState, { reveal: 1, duration: 0.18, ease: "back.out(2)" }, 3.98);
  tl.to(look, { turn: -0.5, duration: 0.42, ease: "sine.inOut" }, 4.02);
  tl.to(look, { turn: 0, duration: 0.42, ease: "sine.inOut" }, 4.5);

  // ---- 5 · The procession: the studio becomes a wet street at night.
  tl.to(look, { street: 1, studio: 0.12, duration: 0.45, ease: "sine.inOut" }, 4.5);
  tl.to(look, { othersReveal: 1, duration: 0.35 }, 4.7);
  tl.to(look, { approach: 1, duration: 0.85, ease: "power1.out" }, 4.55);
  tl.to(hero.hatState, { drop: 1, duration: 0.3, ease: "power2.out" }, 4.72);
  if (!reducedMotion) tl.to(hero.walk, { amount: 1, duration: 0.25 }, 4.62);

  // ---- 6 · The detail: back to the studio, in close on the cuff.
  tl.to(hero.walk, { amount: 0, duration: 0.2 }, 5.46);
  tl.to(hero.hatState, { drop: 0, duration: 0.22 }, 5.46);
  tl.to(look, { othersReveal: 0, duration: 0.25 }, 5.45);
  tl.to(look, { street: 0, studio: 0.75, duration: 0.35, ease: "sine.inOut" }, 5.5);

  // ---- 7 · Finale: pull away, lights down.
  tl.to(look, { exposure: 0.7, fade: 0.55, studio: 1, duration: 0.5 }, 6.5);
  tl.to(look, { turn: 0.35, duration: 0.6, ease: "sine.inOut" }, 6.45);

  return tl;
}
