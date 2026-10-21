/*
 * The cast. Original characters — not likenesses of any real person — written
 * as the parameters the sculpting, shading and motion code reads.
 * docs/CHARACTERS.md is the human-readable character bible for the same cast.
 *
 * Face parameters are scale factors around the neutral head (1 = neutral).
 */
export const CAST = {
  luca: {
    name: "Luca",
    skin: "#b5805d", // warm olive
    hair: "#21150e",
    hairStyle: "wave", // softly waved, swept back from the forehead
    stubble: 0.7, // close-trimmed beard shadow
    brow: 1.0,
    jaw: 1.04,
    chin: 1.03,
    nose: 1.02,
    cheek: 1.0,
    eyes: "#4a2c18",
    gaze: { yaw: 0.0, pitch: 0.0 },
  },
  kenji: {
    name: "Kenji",
    skin: "#c8996f", // light warm
    hair: "#0e0b0a",
    hairStyle: "part", // short, side-parted, combed to the right
    stubble: 0.12,
    brow: 0.96,
    jaw: 0.98,
    chin: 0.98,
    nose: 0.96,
    cheek: 1.05,
    eyes: "#26170e",
    gaze: { yaw: 0.0, pitch: 0.0 },
  },
  theo: {
    name: "Theo",
    skin: "#7a4a30", // deep warm
    hair: "#120d0b",
    hairStyle: "crop",
    stubble: 0.45,
    brow: 1.02,
    jaw: 1.06,
    chin: 1.0,
    nose: 1.05,
    cheek: 1.02,
    eyes: "#2a180d",
    gaze: { yaw: 0, pitch: 0 },
  },
  marcus: {
    name: "Marcus",
    skin: "#d6a986", // fair warm
    hair: "#4b3020",
    hairStyle: "crop",
    stubble: 0.3,
    brow: 0.98,
    jaw: 1.0,
    chin: 1.05,
    nose: 1.0,
    cheek: 0.98,
    eyes: "#3b4a52",
    gaze: { yaw: 0, pitch: 0 },
  },
};
