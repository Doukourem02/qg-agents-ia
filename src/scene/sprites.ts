import * as THREE from 'three';

// Les personnages en pixel art, dessinés pixel par pixel d'après les portraits de personnages/.
// Chaque personnage a 5 images : immobile, marche (2), frappe au clavier (2).

type R = (x: number, y: number, w: number, h: number, c: string) => void;
export type Look = { skin: string; hair: string; top: string; legs: string; noEyes?: boolean; fx?: (r: R, x: number, y: number) => void };
export type Frame = 'idle' | 'walk0' | 'walk1' | 'type0' | 'type1' | 'wave0' | 'wave1';

export const SPRITE_W = 20, SPRITE_H = 28, PX_PER_UNIT = 26;
const INK = '#1d1b2e';

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export const LOOKS: Record<string, Look> = {
  kuroro: { skin: '#f1d6bd', hair: '#16161d', top: '#1f1f29', legs: '#121218', fx: (r, x, y) => { r(x - 4, y - 11, 8, 2, '#f2efe8'); r(x, y - 18, 1, 3, INK); r(x - 1, y - 17, 3, 1, INK); } },
  stalker: { skin: '#d8b89a', hair: '#4a4d57', top: '#3a3d47', legs: '#24262e', fx: (r, x, y) => { r(x - 4, y - 18, 1, 7, '#4a4d57'); r(x + 3, y - 18, 1, 7, '#4a4d57'); r(x - 3, y - 15, 6, 1, '#38f28a'); r(x - 1, y - 9, 2, 2, '#3b82f6'); } },
  obito: { skin: '#f08a24', hair: '#16161d', top: '#24202e', legs: '#16131d', noEyes: true, fx: (r, x, y) => { r(x + 1, y - 15, 1, 1, INK); r(x - 3, y - 17, 1, 1, '#c7661a'); r(x - 2, y - 13, 2, 1, '#c7661a'); r(x - 4, y - 11, 8, 1, '#5b3a8c'); } },
  L: { skin: '#f6e8de', hair: '#121212', top: '#f4f4f4', legs: '#3c5fa8', fx: (r, x, y) => { r(x - 5, y - 19, 1, 3, '#121212'); r(x + 4, y - 18, 1, 2, '#121212'); r(x - 2, y - 21, 1, 1, '#121212'); r(x + 2, y - 21, 1, 1, '#121212'); r(x - 3, y - 14, 2, 1, '#c9aab4'); r(x + 1, y - 14, 2, 1, '#c9aab4'); r(x - 1, y - 9, 2, 2, '#2b6fd6'); r(x + 4, y - 10, 2, 2, '#ff5fa2'); } },
  light: { skin: '#f3d7bd', hair: '#8a5a2b', top: '#6b4a30', legs: '#2c2620', fx: (r, x, y) => { r(x - 1, y - 11, 3, 1, '#fff'); r(x, y - 10, 1, 4, '#d33'); r(x + 4, y - 9, 2, 3, INK); } },
  mafe: { skin: '#6b4226', hair: '#1d1b2e', top: '#f2c14e', legs: '#4b3d63', fx: (r, x, y) => { r(x - 5, y - 21, 10, 4, '#1d1b2e'); r(x + 4, y - 9, 2, 2, '#fff'); r(x - 7, y - 10, 2, 3, '#efe6cf'); } },
  luffy: { skin: '#f3d2b3', hair: '#16161d', top: '#d93a3a', legs: '#3a6fc4', fx: (r, x, y) => { r(x - 6, y - 19, 12, 1, '#f2d26b'); r(x - 4, y - 22, 8, 3, '#f2d26b'); r(x - 4, y - 20, 8, 1, '#d33'); r(x - 3, y - 14, 1, 1, '#a33'); r(x - 1, y - 11, 2, 5, '#f3d2b3'); } },
  zoro: { skin: '#e8c9a8', hair: '#3fae5a', top: '#f4f4f4', legs: '#1f3b2a', fx: (r, x, y) => { r(x - 4, y - 6, 8, 1, '#2f8a48'); r(x + 5, y - 13, 1, 9, '#c0392b'); } },
  isaac: { skin: '#5a3520', hair: '#1d1b2e', top: '#8e2a22', legs: '#2a1d1a', fx: (r, x, y) => { [-3, 0, 2].forEach(d => r(x + d, y - 19, 1, 1, '#e2b13c')); r(x + 4, y - 11, 3, 2, '#8a8f98'); } },
  lea: { skin: '#f3d7bd', hair: '#c8622e', top: '#5b7fc0', legs: '#2a3550', noEyes: true, fx: (r, x, y) => { r(x + 3, y - 17, 2, 7, '#c8622e'); r(x - 3, y - 15, 6, 1, INK); r(x + 4, y - 9, 1, 3, '#d33'); } },
  // Feu (copilote de trading, personnage original) : casquette, sweat à capuche aux cordons jaune Binance, petit écran de cours à la main
  feu: { skin: '#c99a73', hair: '#2b1d16', top: '#26262f', legs: '#3a3f55', fx: (r, x, y) => { r(x - 4, y - 21, 8, 3, '#1d1b2e'); r(x - 1, y - 20, 2, 1, '#F0B90B'); r(x + 3, y - 19, 3, 1, '#1d1b2e'); r(x - 5, y - 12, 10, 1, '#3a3a48'); r(x - 2, y - 11, 1, 3, '#F0B90B'); r(x + 1, y - 11, 1, 3, '#F0B90B'); r(x - 8, y - 11, 3, 4, INK); r(x - 7, y - 10, 1, 1, '#3dbb5a'); r(x - 7, y - 9, 1, 1, '#e5484d'); r(x - 6, y - 10, 1, 2, '#3dbb5a'); } },
  paul: { skin: '#efd2b6', hair: '#c4c4c4', top: '#7c5a3c', legs: '#3a3d47', fx: (r, x, y) => { r(x - 7, y - 10, 2, 4, '#3b82f6'); r(x - 7, y - 8, 2, 1, '#e8b04a'); } },
  ye: { skin: '#6b4226', hair: '#16161d', top: '#c8b49a', legs: '#8f8270', noEyes: true, fx: (r, x, y) => { r(x - 3, y - 15, 6, 1, '#f4f4f4'); r(x - 3, y - 13, 6, 2, INK); r(x - 7, y - 10, 3, 3, '#d4a531'); } },
  malenia: { skin: '#f1d6bd', hair: '#c0392b', top: '#d4a531', legs: '#8e1f1f', fx: (r, x, y) => { r(x - 4, y - 20, 8, 3, '#d4a531'); r(x - 6, y - 21, 2, 1, '#d4a531'); r(x + 4, y - 21, 2, 1, '#d4a531'); r(x - 6, y - 11, 1, 9, '#a32020'); r(x + 5, y - 11, 1, 9, '#a32020'); } },
  tom: { skin: '#f1d6bd', hair: '#7a4a2a', top: '#2f9c8f', legs: '#23262e', fx: (r, x, y) => { r(x - 4, y - 20, 8, 3, '#d94b3b'); r(x - 1, y - 9, 3, 2, '#9fd3ff'); } },
  clara: { skin: '#f1d6bd', hair: '#2b1d16', top: '#c86a8a', legs: '#2c2433', fx: (r, x, y) => { r(x - 1, y - 21, 3, 2, '#2b1d16'); r(x - 7, y - 9, 3, 2, '#f4f1ea'); } },
  sam: { skin: '#c48a5f', hair: '#16161d', top: '#5c6470', legs: '#23262e', fx: (r, x, y) => { r(x - 4, y - 18, 8, 1, '#f4f4f4'); r(x - 1, y - 10, 3, 3, INK); r(x, y - 9, 1, 1, '#3dbb5a'); } },
};

const FIG_TOPS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9c89b8', '#5fa8d3', '#c9705b', '#6c9a8b'];
const SKINS = ['#f1d6bd', '#d8a47f', '#8d5a3b', '#5a3520', '#f3d2b3'];
const HAIRS = ['#2b1d16', '#7a4a2a', '#16161d', '#c4a35a', '#4a2f22'];
export function lookFor(key: string): Look {
  if (LOOKS[key]) return LOOKS[key];
  const i = parseInt(key.replace(/\D/g, ''), 10) || 0;
  return { skin: SKINS[i % SKINS.length], hair: HAIRS[(i * 3) % HAIRS.length], top: FIG_TOPS[(i * 5) % FIG_TOPS.length], legs: '#2c2f3a' };
}

export function drawChar(ctx: CanvasRenderingContext2D, look: Look, sx: number, sy: number, frame: Frame) {
  const r: R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  r(sx - 5, sy - 1, 10, 2, 'rgba(40,25,70,.25)');
  r(sx - 5, sy - 20, 10, 9, INK); r(sx - 6, sy - 12, 12, 8, INK); r(sx - 4, sy - 6, 8, 7, INK);
  const lp = frame === 'walk1' ? 1 : 0, wp = frame === 'walk0' ? 1 : 0;
  r(sx - 3, sy - 5, 2, 5 - lp, look.legs); r(sx + 1, sy - 5, 2, 5 - wp, look.legs);
  r(sx - 4, sy - 11, 8, 6, look.top);
  const ap = frame === 'type1' ? 1 : 0;
  r(sx - 5, sy - 11, 1, 5 - ap, shade(look.top, 0.85));
  if (frame === 'wave0' || frame === 'wave1') {
    // le bras droit levé qui salue : la main passe d'un côté à l'autre
    const m = frame === 'wave1' ? 1 : 0;
    r(sx + 4, sy - 11, 1, 2, shade(look.top, 0.85)); r(sx + 5, sy - 14, 1, 4, shade(look.top, 0.85));
    r(sx + 5 + m, sy - 17, 2, 3, look.skin);
  } else r(sx + 4, sy - 11, 1, 4 + ap, shade(look.top, 0.85));
  r(sx - 4, sy - 18, 8, 7, look.skin);
  r(sx - 4, sy - 19, 8, 2, look.hair); r(sx - 4, sy - 17, 1, 3, look.hair); r(sx + 3, sy - 17, 1, 2, look.hair);
  if (!look.noEyes) { r(sx - 2, sy - 15, 1, 2, INK); r(sx + 1, sy - 15, 1, 2, INK); }
  look.fx?.(r, sx, sy);
}

const cache = new Map<string, THREE.CanvasTexture>();
export function spriteTexture(key: string, frame: Frame): THREE.Texture {
  const k = `${key}:${frame}`;
  let t = cache.get(k);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = SPRITE_W; c.height = SPRITE_H;
    drawChar(c.getContext('2d')!, lookFor(key), SPRITE_W / 2, SPRITE_H - 1, frame);
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(k, t);
  }
  return t;
}

/** Le personnage entier (pour le compte rendu), image par image. */
export function corpsDataUrl(key: string, frame: Frame): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = SPRITE_W + 4; c.height = SPRITE_H;
  drawChar(c.getContext('2d')!, lookFor(key), SPRITE_W / 2, SPRITE_H - 1, frame);
  return c.toDataURL();
}

/** Petite image de la tête, pour la barre de mission. */
export function headDataUrl(key: string): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = 14; c.height = 14;
  drawChar(c.getContext('2d')!, lookFor(key), 7, 26, 'idle');
  return c.toDataURL();
}
