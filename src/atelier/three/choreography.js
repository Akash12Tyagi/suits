import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TABLE, TABLE_PIECES } from "./workshop.js";

gsap.registerPlugin(ScrollTrigger);

/*
 * One scrubbed timeline for the whole story. Every chapter section is the
 * same height (CHAPTER_VH), so chapter i is pinned for timeline time
 * [i, i + 1 - VIEW] and moves out during [i + 1 - VIEW, i + 1].
 * Scrolling backwards plays everything in reverse — the suit unfolds and
 * its pieces return to the cutting table.
 */
export const CHAPTER_VH = 220;
const VIEW = 100 / CHAPTER_VH;

const T = TABLE.centre;

/** Lift pieces from the table to hover beside the figure, then close them on. */
function fromTable(tl, pieces, start, o = {}) {
  const { stagger = 0.03, lift = 0.3, gap = 0.03, fly = 0.32, fold = 0.3, foldAt = 0.12, hoverFold = 0, close = 0.025 } = o;
  pieces.forEach((p, i) => {
    const s = start + i * stagger;
    tl.fromTo(p.state, { fly: -1 }, { fly: 0, duration: lift, ease: "power2.inOut", immediateRender: false }, s);
    if (hoverFold) tl.to(p.state, { fold: hoverFold, duration: lift, ease: "sine.inOut" }, s + lift * 0.3);
  });
  const s2 = start + pieces.length * stagger + lift + gap;
  pieces.forEach((p, i) => {
    const s = s2 + i * close;
    tl.to(p.state, { fly: 1, duration: fly, ease: "power3.inOut" }, s);
    tl.to(p.state, { fold: 1, duration: fold, ease: "power2.inOut" }, s + foldAt);
  });
  return s2 + pieces.length * close + fly;
}

/** Pieces that are not on the table: appear at their hover pose, then close on. */
function fromAir(tl, pieces, start, o = {}) {
  const { stagger = 0.05, fly = 0.36, foldAt = 0.14, fold = 0.32, from = 0 } = o;
  pieces.forEach((p, i) => {
    const s = start + i * stagger;
    tl.to(p.state, { reveal: 1, duration: 0.1 }, s);
    tl.fromTo(p.state, { fly: from }, { fly: 1, duration: fly, ease: "power3.out", immediateRender: false }, s);
    tl.to(p.state, { fold: 1, duration: fold, ease: "power2.inOut" }, s + foldAt);
  });
}

export function buildChoreography(stage, storyEl, { chapters, reducedMotion }) {
  const { hero, cam, look, workshop } = stage;
  const W = workshop.look;
  const H = hero.look;
  const M = hero.motion.state;
  const P = (...names) => names.map((n) => hero.byName[n]);
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

  // ---- Camera keys, one per chapter. sx > 0 pushes the subject right (text left).
  const keys = [
    null,
    { px: 0.55, py: 0.36, pz: 1.75, tx: 0.04, ty: 0.17, tz: 0, fov: 30, sx: 0.15, sy: 0 }, // measure
    { px: T.x - 0.1, py: T.y + 1.05, pz: T.z + 2.35, tx: T.x, ty: T.y - 0.12, tz: T.z - 0.1, fov: 34, sx: 0.12, sy: 0 }, // table
    { px: 0.5, py: 0.24, pz: 2.85, tx: 0.05, ty: 0.1, tz: 0, fov: 30, sx: 0.15, sy: 0 }, // shirt
    { px: -0.42, py: 0.26, pz: 2.6, tx: 0, ty: 0.12, tz: 0, fov: 30, sx: -0.15, sy: 0 }, // waistcoat
    { px: 0.3, py: 0.2, pz: 3.85, tx: 0.1, ty: 0.04, tz: 0, fov: 30, sx: 0.13, sy: 0 }, // canvas
    { px: 0.95, py: -0.05, pz: 4.9, tx: 0, ty: -0.2, tz: 0, fov: 30, sx: -0.14, sy: 0 }, // cut
    { px: 0.3, py: 0.22, pz: 1.8, tx: 0.02, ty: 0.18, tz: 0.06, fov: 30, sx: 0.14, sy: 0 }, // worn
    { px: 0.7, py: -0.12, pz: 6.1, tx: 0.55, ty: -0.12, tz: -0.7, fov: 30, sx: -0.13, sy: 0 }, // procession
    { px: -0.7, py: 0.0, pz: 3.9, tx: -0.62, ty: -0.14, tz: -0.35, fov: 30, sx: -0.12, sy: 0 }, // library
    { px: cuff.pos.x, py: cuff.pos.y, pz: cuff.pos.z, tx: cuff.at.x, ty: cuff.at.y, tz: cuff.at.z, fov: 26, sx: 0.2, sy: 0 }, // detail
    { px: 0, py: 0.3, pz: 6.2, tx: 0, ty: -0.12, tz: 0, fov: 30, sx: 0, sy: -0.06 }, // finale
  ];
  // The opening frame shows the whole figure.
  Object.assign(cam, { px: 0.3, py: -0.05, pz: 4.6, tx: 0, ty: -0.12, tz: 0, fov: 30, sx: 0.17, sy: 0 });
  for (let i = 1; i < keys.length; i++) {
    tl.to(cam, { ...keys[i], duration: 0.72, ease: "power2.inOut" }, i - 0.62);
  }

  // ---- 1 · The measure: three tapes wind on.
  tl.to(W, { tapes: 1, duration: 0.12 }, 0.5);
  tl.to(W, { tapeChest: 1, duration: 0.4, ease: "power1.inOut" }, 0.55);
  tl.to(W, { tapeWaist: 1, duration: 0.4, ease: "power1.inOut" }, 0.72);
  tl.to(W, { tapeSleeve: 1, duration: 0.42, ease: "power1.inOut" }, 0.88);
  tl.to(W, { tapes: 0, duration: 0.16 }, 1.48);

  // ---- 2 · The cutting table: the lamp comes up on cloth, chalk, shears.
  tl.to(W, { table: 1, lamp: 1, duration: 0.4, ease: "sine.inOut" }, 1.35);
  const tablePieces = Object.values(TABLE_PIECES).flat().map((n) => hero.byName[n]);
  tablePieces.forEach((p) => tl.to(p.state, { reveal: 1, duration: 0.3 }, 1.5));
  tl.to(W, { chalk: 1, duration: 0.5, ease: "power1.inOut" }, 1.75);
  tl.to(W, { shears: 1, duration: 0.55, ease: "power1.inOut" }, 1.95);

  // ---- 3 · The shirt: pieces lift off the table, hover, and close around the form.
  tl.to(H, { glow: 0.55, duration: 0.5 }, 2.9);
  fromTable(tl, P(...TABLE_PIECES.shirt), 2.36);
  const leaf = hero.byName["shirt-collar-leaf"];
  fromAir(tl, [leaf], 3.1, { fly: 0.22, foldAt: 0.16, fold: 0.3 });

  // ---- 4 · Tie and waistcoat.
  fromAir(tl, P("tie-blade", "tie-knot"), 3.42, { stagger: 0.06, fly: 0.32, foldAt: 0.12, fold: 0.26 });
  fromTable(tl, P(...TABLE_PIECES.vest), 3.4, { stagger: 0.05, lift: 0.26, close: 0.05 });
  tl.to(H, { glow: 0.3, duration: 0.4 }, 3.9);

  // ---- 5 · The jacket: off the table into an orbit, half-shaped, then closed on.
  const jacket = P(...TABLE_PIECES.jacket);
  jacket.forEach((p, i) => {
    const s = 4.38 + i * 0.045;
    tl.fromTo(p.state, { fly: -1 }, { fly: 0, duration: 0.45, ease: "power2.inOut", immediateRender: false }, s);
    tl.to(p.state, { fold: 0.5, duration: 0.42, ease: "sine.inOut" }, s + 0.12);
  });
  const collar = hero.byName["jacket-collar"];
  tl.to(collar.state, { reveal: 1, duration: 0.2 }, 4.6);
  tl.fromTo(collar.state, { fly: -0.6 }, { fly: 0, duration: 0.35, ease: "power2.out", immediateRender: false }, 4.6);
  tl.to(collar.state, { fold: 0.5, duration: 0.3 }, 4.65);
  [...jacket, collar].forEach((p, i) => {
    const s = 4.97 + i * 0.042;
    tl.to(p.state, { fly: 1, duration: 0.34, ease: "power3.inOut" }, s);
    tl.to(p.state, { fold: 1, duration: 0.32, ease: "power2.inOut" }, s + 0.12);
  });
  for (const name of ["jacket-lapel-1", "jacket-lapel--1", "jacket-flap-1", "jacket-flap--1"]) {
    const p = hero.byName[name];
    tl.set(p.state, { fly: 1 }, 5.3);
    tl.to(p.state, { reveal: 1, duration: 0.06 }, 5.3);
    tl.to(p.state, { fold: 1, duration: 0.24, ease: "power2.inOut" }, name.includes("lapel") ? 5.36 : 5.44);
  }
  tl.to(H, { glow: 0.18, duration: 0.3 }, 5.3);

  // ---- 6 · The complete silhouette: trousers, shoes, a slow turn; the table goes dark.
  fromTable(tl, P(...TABLE_PIECES.trousers), 5.3, { stagger: 0.04, lift: 0.26, close: 0.045 });
  tl.to(hero.shoeState, { reveal: 1, duration: 0.18, ease: "back.out(2)" }, 6.0);
  tl.to(W, { table: 0, lamp: 0, chalk: 0, duration: 0.25 }, 5.95);
  tl.to(look, { turn: -0.5, duration: 0.4, ease: "sine.inOut" }, 6.22);
  tl.to(look, { turn: 0, duration: 0.4, ease: "sine.inOut" }, 6.62);

  // ---- 7 · Made to be worn: the hologram becomes the man; he sets his cuff.
  tl.to(H, { solid: 1, duration: 0.4, ease: "sine.inOut" }, 6.5);
  tl.to(H, { glow: 0, duration: 0.35 }, 6.7);
  tl.to(M, { gesture: 1, duration: 0.32, ease: "power2.inOut" }, 6.92);
  tl.to(hero.hand, { pinchR: 0.7, curl: 0.16, duration: 0.2 }, 7.05);
  tl.to(M, { gesture: 0, duration: 0.22, ease: "power2.inOut" }, 7.5);
  tl.to(hero.hand, { pinchR: 0, curl: 0.24, duration: 0.15 }, 7.52);

  // ---- 8 · The procession: the studio becomes a wet street at night.
  tl.to(look, { street: 1, studio: 0.12, duration: 0.45, ease: "sine.inOut" }, 7.5);
  tl.to(look, { othersReveal: 1, duration: 0.35 }, 7.7);
  tl.to(look, { approach: 1, duration: 0.85, ease: "power1.out" }, 7.55);
  tl.to(hero.hatState, { drop: 1, duration: 0.3, ease: "power2.out" }, 7.72);
  if (!reducedMotion) tl.to(M, { walk: 1, duration: 0.25, ease: "sine.inOut" }, 7.62);

  // ---- 9 · The cloth library: back in the atelier, swatches on the rail.
  tl.to(M, { walk: 0, duration: 0.2, ease: "sine.inOut" }, 8.45);
  tl.to(hero.hatState, { drop: 0, duration: 0.22 }, 8.46);
  tl.to(look, { othersReveal: 0, duration: 0.25 }, 8.45);
  tl.to(look, { street: 0, studio: 0.85, duration: 0.35, ease: "sine.inOut" }, 8.5);
  tl.to(W, { rail: 1, duration: 0.35 }, 8.55);

  // ---- 10 · The detail: in close on the cuff, shallow focus.
  tl.to(W, { rail: 0, duration: 0.3 }, 9.5);
  tl.to(look, { dof: 1, duration: 0.3 }, 9.62);

  // ---- 11 · Finale: pull away, lights down.
  tl.to(look, { dof: 0, duration: 0.15 }, 10.45);
  tl.to(look, { exposure: 0.7, fade: 0.55, studio: 1, duration: 0.5 }, 10.5);
  tl.to(look, { turn: 0.35, duration: 0.6, ease: "sine.inOut" }, 10.45);

  return tl;
}
