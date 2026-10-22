# Octaboot — character bible

The cast who wear the clothes. Each is an **original character**. None is a likeness of
any real person, including the models in the reference photography. They were written
to carry the editorial menswear look of those references (unhurried, self-possessed,
dressed with care) without copying anyone's face.

Every number here is live in code: `src/atelier/three/characters.js` (face, skin,
hair), `body.js` / `rig.js` (body and skeleton), `motion.js` (posture and gait) and
`figure.js` (what they wear). Change the bible and the code together.

---

## Shared body: the house block

All four men are cut from one block, the proportions the patterns are drafted on.
A real atelier keeps a "house figure" in the same way.

| Measure | Value | Where it lives |
|---|---|---|
| Height (crown) | 1.87 m | head at `HEAD_AT` (`character.js`), floor at `FLOOR_Y` |
| Shoulder height | 1.50 m | `SHOULDER` (`body.js`) |
| Natural waist | 1.05 m | torso key `y = 0` |
| Hip joint | 0.905 m | `HIP` (`body.js`) |
| Chest | 101 cm | torso keys at `y = 0.31` |
| Waist | 84 cm | torso keys at `y = 0` |
| Seat | 98 cm | torso keys at `y = -0.2` |
| Arm (shoulder to wrist) | 62 cm, elbow at 47 % | `armL/armR` tubes, `ELBOW_T` |
| Leg (hip to ankle) | 82 cm, knee at 50 % | `legL/legR` tubes, `KNEE_T`, `ANKLE_T` |
| Build | Athletic slim, drop 7 | |

Skeleton: 20 bones (`rig.js`), plus 15 finger bones per hand (`human.js`).

### Face construction (all heads)

Laid out on the classical facial thirds: hairline +6.5 cm, brow +1.4 cm, nose base
−5.2 cm and chin −11.5 cm from ear level, with the eyes on the horizontal midline of
the head and 63 mm apart. Sculpted as signed-distance parts: skull, forehead, maxilla,
zygomatic arches, jawline from gonion to chin, sockets with lids and upper-lid fold,
nose (bridge, tip, alae, nostrils), lips, ears with concha, neck and larynx. Skin
detail is painted per vertex: brows, beard shadow, lip colour, the line of the mouth,
the lash line, and warmth at the nose, cheeks and ears. Skin shading wraps the light
and reddens the terminator, which stands in for subsurface scattering.

---

## Luca — the client, and the face of No. 1 (Sage)

> 32. Architect, Milan and London. Buys rarely and well; knows exactly which button he
> will leave undone.

| | |
|---|---|
| Skin | Warm olive `#b5805d` |
| Hair | Very dark brown `#21150e`, softly waved, swept back from the forehead, fuller on top (`wave`) |
| Face | Slightly stronger jaw (1.04) and chin (1.03), straight nose (1.02) |
| Grooming | Close-trimmed beard shadow (stubble 0.7), full natural brows |
| Eyes | Dark brown `#4a2c18` |
| Posture | Weight on the right leg, left foot turned out; right hand in the trouser pocket, left hand at the jacket's top button; head turned a quarter to his left, chin level |
| Movement | Measured, unhurried walk (0.95 m/s, 1.15 s stride); breathes slowly; settles his cuff before he moves |

**Wears:** the story's midnight three-piece (`threePiece`), from first measure to
finished suit. In the lookbook he wears **No. 1, Sage two-piece**: sage wool with a
little stretch (the cloth map is sampled from the supplied photograph), notch lapel
with a buttonhole, two black buttons with a wide cutaway below the top one, flap
pockets, a short jacket that just covers the seat, a white shirt open one button at
the neck with black buttons and a spread collar over the lapels, a puffed pink silk
square, slim tapered trousers, and brown oxfords (`openTwoPiece`, colourway `sage`).

## Kenji — the face of No. 2 (Chestnut chalk stripe)

> 29. Brand strategist, Tokyo and New York. Precise, quietly funny; stands as if the
> photograph has already been taken.

| | |
|---|---|
| Skin | Light warm `#c8996f` |
| Hair | Near-black `#0e0b0a`, short, side-parted and combed to the right, close at the sides (`part`) |
| Face | Finer jaw (0.98) and chin (0.98), refined nose (0.96), higher cheekbones (1.05) |
| Grooming | Clean-shaven (stubble 0.12), neat brows |
| Eyes | Very dark brown `#26170e` |
| Posture | Weight on the left leg, right foot crossed in front; left hand in the pocket, right hand at the button; head turned a quarter to his right |
| Movement | Light on his feet; in the procession he walks a beat ahead of the others |

**Wears:** **No. 2, Chestnut chalk stripe**: dark chocolate wool ruled with a beaded
cream stripe about every 10 mm (the cloth map is sampled from the supplied flat-lay), notch lapel, two
black buttons, a plum silk square, a white shirt open at the neck, slim trousers, dark
brown oxfords (`openTwoPiece`, colourway `chestnut`). In the procession he wears the
bordeaux three-piece.

## Theo — procession

> 35. Cellist. Tall in his stillness.

Skin deep warm `#7a4a30`, close crop (`crop`), stronger jaw (1.06), fuller nose
(1.05), short beard shadow (0.45). Wears the **ivory** three-piece and an ivory fedora.

## Marcus — procession

> 41. Restaurateur. The one who always holds the door.

Skin fair warm `#d6a986`, mid-brown close crop, longer chin (1.05), light stubble
(0.3), grey-blue eyes `#3b4a52`. Wears the **flannel** three-piece and a charcoal fedora.

---

## Art direction notes

* **Light.** In the atelier, faces live in low key: an overhead spot, cool rims, and
  hat brims in the procession. In the lookbook, a broad soft daylight key from
  camera-right, pale grey walls and floor, and soft shadows falling behind and to
  the left, after the reference photography.
* **Framing.** Lookbook frames are full length at eye level, with the figure a third in from
  the edge and the copy on the open side.
* **Gaze.** Never at camera. A quarter turn off-axis, eyes following the head.
* **What we do not do.** No recognisable real faces, no celebrity look-alikes, no
  third-party brand marks on the clothes. The cast are original sculpts. The
  supplied photographs appear as photographs, beside the 3D looks. The flat-lays
  carry another brand's shirt label, so they are shown only as crops below the collar.
