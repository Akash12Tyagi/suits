import * as THREE from "three";

/*
 * Cloth textures are drawn procedurally so the experience downloads no images.
 * Each returns { map, bump } sharing one canvas: map is sRGB colour variation
 * (kept near white so material.color stays in charge), bump is height.
 */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas, repeat, anisotropy) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(canvas);
  bump.colorSpace = THREE.NoColorSpace;
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy;
  }
  return { map, bump };
}

// 2/2 twill with a sharkskin fleck — the worsted look of the reference close-up.
export function woolTexture(anisotropy = 8) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = rng(7);
  g.fillStyle = "rgb(205,205,205)";
  g.fillRect(0, 0, size, size);

  const period = 8;
  for (let k = -size; k < size * 2; k += period) {
    const v = 175 + rand() * 40;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = period * 0.45;
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + size, size);
    g.stroke();
  }
  // Fleck: tiny bright and dark yarn ends.
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() < 0.5 ? 255 : 120;
    g.fillStyle = `rgba(${v},${v},${v},${0.18 + rand() * 0.3})`;
    g.fillRect(x, y, 1 + rand() * 1.5, 1);
  }
  return finish(c, 1, anisotropy);
}

// Poplin: fine weft ribs.
export function cottonTexture(anisotropy = 8) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = rng(11);
  g.fillStyle = "rgb(236,236,236)";
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 3) {
    const v = 214 + rand() * 18;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, size, 1);
  }
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(255,255,255,${rand() * 0.35})`;
    g.fillRect(rand() * size, rand() * size, 2, 1);
  }
  return finish(c, 1, anisotropy);
}

// Grenadine/repp silk for the tie and lining: diagonal ribs, high contrast bump.
export function silkTexture(anisotropy = 8) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "rgb(200,200,200)";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgb(245,245,245)";
  g.lineWidth = 2;
  for (let k = -size; k < size * 2; k += 6) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k - size, size);
    g.stroke();
  }
  return finish(c, 1, anisotropy);
}

// Soft round sprite for dust, lamp glows and highlights.
export function glowSprite(size = 128, falloff = 2.2) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - r, falloff);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ cloth library

function twillBase(g, size, rand) {
  g.fillStyle = "rgb(200,200,200)";
  g.fillRect(0, 0, size, size);
  const period = 8;
  for (let k = -size; k < size * 2; k += period) {
    const v = 172 + rand() * 40;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = period * 0.45;
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + size, size);
    g.stroke();
  }
}

function fleck(g, size, rand, n = 7000) {
  for (let i = 0; i < n; i++) {
    const v = rand() < 0.5 ? 255 : 110;
    g.fillStyle = `rgba(${v},${v},${v},${0.14 + rand() * 0.26})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1);
  }
}

/** Woven patterns for the cloth library: plain, chalk, glen, herringbone. */
export function patternTexture(kind, anisotropy = 8) {
  if (kind === "plain") return woolTexture(anisotropy);
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = rng(kind.length * 31);

  if (kind === "herringbone") {
    g.fillStyle = "rgb(196,196,196)";
    g.fillRect(0, 0, size, size);
    const col = 32;
    for (let x0 = 0; x0 < size; x0 += col) {
      const dir = (x0 / col) % 2 ? 1 : -1;
      g.save();
      g.beginPath();
      g.rect(x0, 0, col, size);
      g.clip();
      for (let k = -size; k < size * 2; k += 7) {
        const v = 160 + rand() * 60;
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x0, k);
        g.lineTo(x0 + col, k + dir * col);
        g.stroke();
      }
      g.restore();
      g.fillStyle = "rgba(120,120,120,0.35)";
      g.fillRect(x0, 0, 1, size);
    }
    fleck(g, size, rand, 4000);
  } else if (kind === "chalk") {
    twillBase(g, size, rand);
    fleck(g, size, rand);
    // Soft chalk stripes, slightly broken like real chalk-stripe flannel.
    const period = size / 6;
    for (let x = period / 2; x < size; x += period) {
      for (let y = 0; y < size; y += 2) {
        const a = 0.35 + 0.35 * rand();
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.fillRect(x - 1.5 + rand() * 1.2, y, 2.6, 2);
      }
    }
  } else if (kind === "glen") {
    twillBase(g, size, rand);
    // Prince of Wales check: hairline groups, small-check quadrants, an overcheck.
    const q = size / 2;
    for (let qx = 0; qx < 2; qx++) {
      for (let qy = 0; qy < 2; qy++) {
        if ((qx + qy) % 2 === 0) {
          for (let y = 0; y < q; y += 8) {
            for (let x = 0; x < q; x += 8) {
              if (((x + y) / 8) % 2) {
                g.fillStyle = "rgba(255,255,255,0.32)";
                g.fillRect(qx * q + x, qy * q + y, 4, 4);
              }
            }
          }
        } else {
          for (let k = 0; k < q; k += 6) {
            g.fillStyle = "rgba(255,255,255,0.26)";
            if (qx === 1) g.fillRect(qx * q + k, qy * q, 2, q);
            else g.fillRect(qx * q, qy * q + k, q, 2);
          }
        }
      }
    }
    g.fillStyle = "rgba(170,195,235,0.55)";
    g.fillRect(q * 0.5, 0, 3, size);
    g.fillRect(0, q * 1.5, size, 3);
    fleck(g, size, rand, 4000);
  }
  return finish(c, 1, anisotropy);
}

// ------------------------------------------------------------------ workshop

export function woodTexture(anisotropy = 8) {
  const w = 1024;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const rand = rng(5);
  g.fillStyle = "#3a2418";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const y0 = rand() * h;
    const amp = 2 + rand() * 6;
    const f = 0.004 + rand() * 0.01;
    const ph = rand() * 10;
    const light = rand() < 0.5;
    g.strokeStyle = light ? `rgba(120,80,52,${0.15 + rand() * 0.25})` : `rgba(20,10,6,${0.2 + rand() * 0.3})`;
    g.lineWidth = 0.6 + rand() * 2.4;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

/** A 150 cm tailor's tape: cream, black centimetre ticks, numbers every 5 cm. */
export function tapeTexture(anisotropy = 8) {
  const w = 4096; // widest texture every GPU supports
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#e7d9a6";
  g.fillRect(0, 0, w, h);
  const pxPerCm = w / 150;
  g.fillStyle = "#1b1712";
  for (let mm = 0; mm <= 1500; mm++) {
    const x = (mm / 10) * pxPerCm;
    const len = mm % 10 === 0 ? 20 : mm % 5 === 0 ? 13 : 7;
    g.fillRect(x, 0, mm % 10 === 0 ? 2 : 1, len);
    g.fillRect(x, h - len, mm % 10 === 0 ? 2 : 1, len);
  }
  g.font = "bold 22px Jost, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let cm = 5; cm < 150; cm += 5) {
    g.fillStyle = cm % 10 === 0 ? "#1b1712" : "#8c2a1c";
    g.fillText(String(cm), cm * pxPerCm, h / 2 + 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * A coloured striped worsted — the colour lives in the map (material colour
 * stays white) so the stripe can be lighter than the ground.
 * period: stripe spacing in metres; the cloth UVs run at 12 tiles per metre.
 */
export function stripeTexture({ base, stripe, period = 0.0125 }, anisotropy = 8) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = rng(23);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // Twill relief in the ground colour.
  const shade = new THREE.Color(base);
  for (let k = -size; k < size * 2; k += 8) {
    const t = 0.82 + rand() * 0.22;
    g.strokeStyle = `#${shade.clone().multiplyScalar(t).getHexString()}`;
    g.lineWidth = 3.6;
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + size, size);
    g.stroke();
  }
  // Fine stripes: an integer count per tile so the pattern repeats cleanly.
  const n = Math.max(1, Math.round(1 / 12 / period));
  const step = size / n;
  for (let x = step / 2; x < size; x += step) {
    for (let y = 0; y < size; y += 2) {
      const a = 0.55 + 0.4 * rand();
      g.globalAlpha = a;
      g.fillStyle = stripe;
      g.fillRect(x - 1 + rand() * 0.6, y, 2.2, 2);
    }
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(255,255,255,${rand() * 0.12})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand(), 1);
  }
  return finish(c, 1, anisotropy);
}
