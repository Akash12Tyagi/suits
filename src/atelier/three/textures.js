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
