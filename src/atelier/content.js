export const BRAND = "Octaboot";

// One entry per scroll chapter. `side` is where the text sits on desktop;
// the 3D framing in choreography.js places the figure on the opposite side.
export const CHAPTERS = [
  {
    id: "house",
    side: "hero",
    eyebrow: "The House of Octaboot",
    title: ["Every suit begins", "as cloth laid flat."],
    body: "Scroll, and watch one be made — measured, cut flat, carried to the form and folded into shape, piece by piece.",
  },
  {
    id: "measure",
    side: "left",
    eyebrow: "The Measure",
    title: ["Thirty-Two", "Measures"],
    body: "Chest, waist and seat, the slope of each shoulder, the length of each arm — taken twice by hand, written in the ledger and kept for life.",
    spec: ["Measures", "Chest · Waist · Sleeve · and 29 more"],
  },
  {
    id: "cutting",
    side: "left",
    eyebrow: "The Cutting Table",
    title: ["Chalk, Shears,", "and Cloth"],
    body: "Your pattern is drafted on brown paper, traced onto the cloth in tailor's chalk and cut by hand, one piece at a time, on a table lit by a single lamp.",
    spec: ["Pattern", "Drafted for one client only"],
  },
  {
    id: "foundation",
    side: "left",
    eyebrow: "The Foundation",
    title: ["A Shirt of", "Pure Cotton"],
    body: "Fronts, back and sleeves lift from the table, cut from a single length of two-fold poplin, and close around the form. The collar rolls on its own line; the cuffs turn back once.",
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
    drag: true,
  },
  {
    id: "worn",
    side: "left",
    eyebrow: "The Man",
    title: ["Made to", "Be Worn"],
    body: "A suit is finished only when it moves. A last look at the cuff, a settle of the shoulders — and it belongs to him.",
    spec: ["Fit", "Individually made to measure"],
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
    id: "library",
    side: "right",
    eyebrow: "The Cloth Library",
    title: ["Choose", "the Cloth"],
    body: "Plain worsted for every day, a chalk stripe for the boardroom, Glen check for the country, herringbone for the cold. Choose one, and the suit is re-cut in it.",
    spec: ["Cloth", "Woven in Huddersfield & Biella"],
    patterns: true,
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

export const PATTERNS = [
  { id: "plain", label: "Plain worsted" },
  { id: "chalk", label: "Chalk stripe" },
  { id: "glen", label: "Glen check" },
  { id: "herringbone", label: "Herringbone" },
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
