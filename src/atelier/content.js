export const BRAND = "Octaboot";

// One entry per scroll chapter. `side` is where the text sits on desktop;
// the 3D framing in choreography.js places the figure on the opposite side.
export const CHAPTERS = [
  {
    id: "house",
    side: "hero",
    eyebrow: "The House of Octaboot",
    title: ["Every suit begins", "as cloth laid flat."],
    body: "Scroll, and watch one be made — cut flat, carried to the form, and folded into shape, piece by piece.",
  },
  {
    id: "foundation",
    side: "left",
    eyebrow: "The Foundation",
    title: ["A Shirt of", "Pure Cotton"],
    body: "Fronts, back and sleeves are cut flat from a single length of two-fold poplin, then closed around the form. The collar rolls on its own line; the cuffs turn back once.",
    spec: ["Cloth", "Egyptian two-ply poplin, 120s"],
  },
  {
    id: "waistcoat",
    side: "right",
    eyebrow: "The Waistcoat",
    title: ["Structure,", "Held Close"],
    body: "The waistcoat draws the line of the body inward. Five buttons, a silk-backed rear, and a tie cut on the bias so the knot falls true and never twists.",
    spec: ["Silk", "Mulberry, woven in Como"],
  },
  {
    id: "canvas",
    side: "left",
    eyebrow: "The Canvas",
    title: ["Built on", "Full Canvas"],
    body: "Beneath the cloth floats a chest of horsehair canvas, pad-stitched by hand, so the lapel rolls rather than presses — and keeps that roll for decades.",
    spec: ["Construction", "Hand-padded full canvas"],
  },
  {
    id: "cut",
    side: "right",
    eyebrow: "The Cut",
    title: ["The Complete", "Silhouette"],
    body: "Shoulder, waist and break, balanced as one line. Trousers fall clean to the shoe with a single soft break.",
    spec: ["Cloth", "Super 150's merino · 240 g"],
  },
  {
    id: "procession",
    side: "right",
    eyebrow: "The Procession",
    title: ["A Language", "of Colour"],
    body: "Four signature tones, each woven to wear from first light to last. Choose one, and the suit will change to match.",
    spec: ["Palette", "Four signature tones"],
    swatches: true,
  },
  {
    id: "detail",
    side: "left",
    eyebrow: "The Detail",
    title: ["The Last", "Quarter-Inch"],
    body: "Functioning surgeon's cuffs. Horn buttons, each hand-shanked. Pick-stitching you will only ever find by touch.",
    spec: ["Finish", "Working surgeon's cuffs"],
  },
  {
    id: "few",
    side: "centre",
    eyebrow: "The House of Fashion",
    title: ["Tailoring", "for the few."],
    body: "Every Octaboot suit is cut for one man and one man only. Begin with a conversation, a measure, and a single bolt of cloth chosen for you alone.",
    cta: "Book a private fitting",
  },
];

export const SWATCHES = [
  { id: "midnight", label: "Midnight", hex: "#1a1d26" },
  { id: "flannel", label: "Flannel", hex: "#6f7279" },
  { id: "ivory", label: "Ivory", hex: "#d9d2c3" },
  { id: "bordeaux", label: "Bordeaux", hex: "#561321" },
];

export const CONTACT = "mailto:atelier@octaboot.example?subject=Private%20fitting";

export const FOOTER = [
  {
    heading: "Atelier",
    links: [
      ["The House", "#top"],
      ["Full Canvas", "#chapter-canvas"],
      ["The Cloth Library", "#chapter-procession"],
    ],
  },
  {
    heading: "Wardrobe",
    links: [
      ["Suits", "#chapter-cut"],
      ["Shirting", "#chapter-foundation"],
      ["Accessories", "#chapter-detail"],
    ],
  },
  {
    heading: "Visit",
    links: [
      ["Mayfair · London", CONTACT],
      ["By Appointment", CONTACT],
      ["Contact", CONTACT],
    ],
  },
];
