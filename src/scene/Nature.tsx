'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Blocs } from './Blocs';
import { bords, CASCADE, derriere, dessous, devant, droite, gauche, hamac, ruisseauEtCascade, SOLS, terrainDeFoot } from './paysage';
import { coteDehors, minutesDe, ombreAuSol } from '@/sim/lumiere';
import { GRID, ILE } from '@/data/layout';
import { useQG } from '@/store';

// La nature autour du bâtiment, en voxels, comme à Abidjan : des cocotiers penchés, des palmiers, des flamboyants aux
// fleurs rouges, des manguiers, des bananiers, des bougainvilliers fuchsia ; plantés par petits groupes, chacun un peu
// différent (tirage pseudo-aléatoire fixe). Leur ombre au sol tourne avec le vrai soleil d'Abidjan (src/sim/lumiere.ts) :
// à l'ouest le matin, courte vers midi, à l'est le soir, absente la nuit. Avec une mare arrondie et ses roseaux, des
// rochers, un banc, des lampadaires, des allées de pavés, une pelouse à deux tons, des hautes herbes, un fromager géant.
// On peut tourner autour du bureau : chaque côté a son idée (paysage.ts) — la cour de service derrière, la terrasse et
// le terrain de basket à gauche, le potager et le hamac à droite, le parking devant —, et le bord de l'île est en roche.

type V = { x: number; y: number; z: number; w: number; d: number; h: number; c: string; top?: string; left?: string; right?: string };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const choix = <T,>(r: () => number, l: readonly T[]) => l[Math.floor(r() * l.length)];
/** Un cube de côté `t`, centré en (x, y), posé à la hauteur z. */
const cube = (x: number, y: number, z: number, t: number, c: string, h = t): V => ({ x: x - t / 2, y: y - t / 2, z, w: t, d: t, h, c });

// Les feuillages : du bas (à l'ombre) vers le haut (au soleil).
const F_MANGUIER = ['#1e5631', '#256b3a', '#2f7d45', '#3a8f4f', '#4ea35e'];
const F_FLAMBOYANT = ['#3f7d3a', '#4f8f40', '#b52e1c', '#d63b22', '#ec5a2c', '#f2733a'];
const F_BOUGAIN = ['#2f6f3e', '#3d8a48', '#c2186b', '#d6247a', '#2f7d45', '#ea4a9c', '#f77fbf'];
const F_FROMAGER = ['#2a6b3a', '#327a40', '#3d8a48', '#4a9a52', '#5aa85c'];
const PALMES = ['#2b6e34', '#357f3c', '#3f9446', '#4ea852', '#62bb5c'];

/**
 * Une couronne de feuilles en petits cubes, posée sur une grille : un ellipsoïde bosselé
 * (on ne garde que la surface, l'intérieur ne se voit pas), plus clair en haut qu'en bas.
 */
function couronne(cx: number, cy: number, cz: number, rx: number, rz: number, r: () => number, teintes: string[], pas = 0.24): V[] {
  const out: V[] = [];
  const n = Math.ceil(rx / pas) + 1, m = Math.ceil(rz / pas) + 1;
  // des bosses : quelques boules en plus autour de la forme principale
  const bosses = Array.from({ length: 5 }, () => {
    const a = r() * Math.PI * 2;
    return { x: Math.cos(a) * rx * 0.75, y: Math.sin(a) * rx * 0.75, z: (r() - 0.3) * rz * 0.8, k: 0.45 + r() * 0.25 };
  });
  const dedans = (i: number, j: number, k: number) => {
    const x = i * pas, y = j * pas, z = k * pas;
    if ((x / rx) ** 2 + (y / rx) ** 2 + (z / rz) ** 2 <= 1) return true;
    return bosses.some(b => ((x - b.x) / (rx * b.k)) ** 2 + ((y - b.y) / (rx * b.k)) ** 2 + ((z - b.z) / (rz * b.k)) ** 2 <= 1);
  };
  for (let i = -n - 1; i <= n + 1; i++) for (let j = -n - 1; j <= n + 1; j++) for (let k = -m; k <= m; k++) {
    if (!dedans(i, j, k)) continue;
    // la surface seulement : au moins un voisin vide
    if (dedans(i + 1, j, k) && dedans(i - 1, j, k) && dedans(i, j + 1, k) && dedans(i, j - 1, k) && dedans(i, j, k + 1) && dedans(i, j, k - 1)) continue;
    const h = Math.min(1, Math.max(0, (k * pas / rz + 1) / 2));
    let t = Math.min(teintes.length - 1, Math.floor(h * (teintes.length - 1) + r() * 1.3));
    if (r() < 0.06) t = teintes.length - 1; // une feuille au soleil
    out.push({ x: cx + i * pas - pas / 2, y: cy + j * pas - pas / 2, z: cz + k * pas, w: pas, d: pas, h: pas, c: teintes[t] });
  }
  return out;
}

/** Le tronc : plus large au pied (des racines), une ou deux branches qui partent dans la couronne. */
function tronc(x: number, y: number, h: number, l: number, r: () => number, c = '#6e4a32', cote = '#5a3a26'): V[] {
  const out: V[] = [{ x: x - l / 2, y: y - l / 2, z: 0, w: l, d: l, h, c, right: cote }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (r() < 0.35) continue;
    out.push({ x: x + dx * l * 0.55 - l * 0.25, y: y + dy * l * 0.55 - l * 0.25, z: 0, w: l * 0.5, d: l * 0.5, h: 0.12, c, right: cote });
  }
  for (let b = 0; b < 2; b++) {
    const a = r() * Math.PI * 2;
    out.push({ x: x + Math.cos(a) * l * 0.7 - 0.07, y: y + Math.sin(a) * l * 0.7 - 0.07, z: h * 0.65, w: 0.14, d: 0.14, h: h * 0.4, c, right: cote });
  }
  return out;
}

/** Un arbre, pour son ombre : son pied (x, y), son tronc (hauteur, largeur), sa couronne (centre en hauteur, rayons). */
type Arbre = { x: number; y: number; tronc: number; l: number; cz: number; rx: number; rz: number };
/** Les arbres posés par `decor()`, dans l'ordre (relevés au passage, pour leurs ombres). */
let arbres: Arbre[] = [];

/**
 * Une palme : une nervure de cubes qui part du cœur, monte un peu puis retombe, avec ses folioles de part et d'autre.
 * `a` : sa direction au sol ; `L` : sa longueur ; `chute` : combien elle retombe au bout.
 */
function palme(x: number, y: number, z: number, a: number, L: number, chute: number, r: () => number, pas = 0.15): V[] {
  const out: V[] = [];
  const dx = Math.cos(a), dy = Math.sin(a);
  const n = Math.round(L / pas);
  for (let k = 1; k <= n; k++) {
    const f = k / n, d = k * pas;
    const px = x + dx * d, py = y + dy * d, pz = z + 0.32 * f - chute * f * f;
    out.push(cube(px, py, pz, 0.17, PALMES[Math.min(PALMES.length - 1, 2 + Math.floor(r() * 2.2))], 0.07));
    if (k < 2 || k === n) continue;
    // les folioles, de part et d'autre, plus larges au milieu de la palme, qui retombent un peu
    for (const s of [-1, 1]) {
      out.push(cube(px - dy * 0.13 * s, py + dx * 0.13 * s, pz - 0.05, 0.15, choix(r, PALMES), 0.06));
      if (f > 0.3 && f < 0.7) out.push(cube(px - dy * 0.26 * s, py + dx * 0.26 * s, pz - 0.13, 0.13, PALMES[Math.floor(r() * 3)], 0.05));
    }
  }
  return out;
}

/** Le cocotier : un long tronc annelé, penché et courbé, les palmes en bouquet tout en haut, quelques noix de coco. */
function cocotier(x: number, y: number, r: () => number, s = 1, penche = r() * Math.PI * 2): V[] {
  const H = (2.5 + r() * 0.5) * s, L = 0.35 + r() * 0.35, n = Math.round(H / 0.2);
  const out: V[] = [];
  let tx = x, ty = y;
  for (let k = 0; k < n; k++) {
    const f = k / n;
    tx = x + Math.cos(penche) * L * f * f; ty = y + Math.sin(penche) * L * f * f;
    const t = 0.22 - 0.04 * f;
    out.push(cube(tx, ty, k * 0.2, t, k % 2 ? '#8a6a4a' : '#9c7b58', 0.2));
  }
  const z = n * 0.2;
  out.push(cube(tx, ty, z - 0.05, 0.26, '#3f8a3e', 0.22)); // le cœur
  for (let i = 0; i < 3; i++) out.push(cube(tx + (r() - 0.5) * 0.24, ty + (r() - 0.5) * 0.24, z - 0.2, 0.13, i % 2 ? '#6b4a2a' : '#7a8f2e'));
  const np = 7 + Math.floor(r() * 2), Lp = (1.25 + r() * 0.3) * s;
  for (let i = 0; i < np; i++) out.push(...palme(tx, ty, z + 0.08, (i / np) * Math.PI * 2 + r() * 0.4, Lp * (0.85 + r() * 0.2), 0.75 * s, r));
  arbres.push({ x: (x + tx) / 2, y: (y + ty) / 2, tronc: H, l: 0.22, cz: z, rx: Lp * 0.8, rz: 0.3 });
  return out;
}

/** Le palmier (à huile) : un tronc plus court et plus épais, rugueux, une touffe de palmes plus dense. */
function palmier(x: number, y: number, r: () => number, s = 1): V[] {
  const H = (1.3 + r() * 0.4) * s, n = Math.round(H / 0.18);
  const out: V[] = [];
  for (let k = 0; k < n; k++) {
    out.push(cube(x, y, k * 0.18, 0.3, k % 2 ? '#6e5a40' : '#7d684a', 0.18));
    if (r() < 0.5) { const a = r() * Math.PI * 2; out.push(cube(x + Math.cos(a) * 0.16, y + Math.sin(a) * 0.16, k * 0.18 + 0.04, 0.09, '#5f4c35')); }
  }
  const z = n * 0.18;
  out.push(cube(x, y, z - 0.06, 0.34, '#2f7d3a', 0.26));
  const np = 11, Lp = (1.05 + r() * 0.2) * s;
  for (let i = 0; i < np; i++) out.push(...palme(x, y, z + 0.1, (i / np) * Math.PI * 2 + r() * 0.3, Lp * (0.8 + r() * 0.25), 0.55 * s, r));
  arbres.push({ x, y, tronc: H, l: 0.3, cz: z, rx: Lp * 0.8, rz: 0.35 });
  return out;
}

/** Le flamboyant : un tronc court et des branches qui s'écartent, une large ombrelle plate, rouge vif au soleil. */
function flamboyant(x: number, y: number, r: () => number, s = 1): V[] {
  const rx = 1.35 * s, rz = 0.42 * s, cz = 1.55 * s;
  arbres.push({ x, y, tronc: 1.1 * s, l: 0.28, cz, rx, rz });
  const out = [...tronc(x, y, 1.15 * s, 0.28, r, '#7a5a44', '#5f4434'), ...couronne(x, y, cz, rx, rz, r, F_FLAMBOYANT, 0.28)];
  for (let i = 0; i < 14; i++) out.push(cube(x + (r() - 0.5) * 2.6, y + (r() - 0.5) * 2.2, 0.012, 0.1, choix(r, ['#d63b22', '#ec5a2c', '#ff8a3d']), 0.02)); // fleurs tombées
  return out;
}

/** Le manguier : un tronc trapu, une couronne ronde et dense, vert sombre, quelques mangues qui pendent. */
function manguier(x: number, y: number, r: () => number, s = 1): V[] {
  const rx = 1.1 * s, rz = 0.9 * s, cz = 1.55 * s;
  arbres.push({ x, y, tronc: 0.9 * s, l: 0.32, cz, rx, rz });
  const out = [...tronc(x, y, 0.95 * s, 0.32, r), ...couronne(x, y, cz, rx, rz, r, F_MANGUIER, 0.27)];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2, d = rx * (0.55 + r() * 0.3);
    out.push(cube(x + Math.cos(a) * d, y + Math.sin(a) * d, cz - rz * 0.85, 0.12, choix(r, ['#f2a33a', '#e8c547', '#9cc04a']), 0.15));
  }
  return out;
}

/** Le bananier : deux ou trois troncs tendres, de grandes feuilles qui retombent, un régime et sa fleur violette. */
function bananier(x: number, y: number, r: () => number): V[] {
  const out: V[] = [];
  const nt = 2 + Math.floor(r() * 2);
  for (let t = 0; t < nt; t++) {
    const bx = x + (r() - 0.5) * 0.5, by = y + (r() - 0.5) * 0.5, H = 1.2 + r() * 0.6;
    out.push(cube(bx, by, 0, 0.2, '#6f9440', H));
    const nf = 6 + Math.floor(r() * 2);
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + r() * 0.5, L = 0.75 + r() * 0.3, n = 5;
      const dx = Math.cos(a), dy = Math.sin(a), vieille = r() < 0.12;
      for (let k = 1; k <= n; k++) {
        const f = k / n, d = 0.08 + f * L, z = H + 0.6 * f - 0.8 * f * f, l = 0.1 * Math.sin(Math.PI * (0.15 + 0.85 * f)) + 0.04;
        const c = vieille ? '#a8944a' : choix(r, ['#4f9a3a', '#5aa843', '#68b84d']);
        out.push(cube(bx + dx * d, by + dy * d, z, 0.18, vieille ? c : '#86c95e', 0.05)); // la nervure
        for (const s of [-1, 1]) out.push(cube(bx + dx * d - dy * (l + 0.06) * s, by + dy * d + dx * (l + 0.06) * s, z - 0.02, 0.17, c, 0.04));
      }
    }
    if (t === 0) {
      out.push(cube(bx + 0.14, by, H - 0.45, 0.16, '#c9c24a', 0.22)); // le régime
      out.push(cube(bx + 0.16, by, H - 0.62, 0.1, '#7a2a4a', 0.14)); // la fleur
    }
  }
  arbres.push({ x, y, tronc: 1.4, l: 0.2, cz: 1.5, rx: 0.85, rz: 0.3 });
  return out;
}

/** Le bougainvillier : un buisson rond, couvert de fleurs fuchsia et roses. */
function bougainvillier(x: number, y: number, r: () => number, s = 1): V[] {
  const out = couronne(x, y, 0.5 * s, 0.7 * s, 0.48 * s, r, F_BOUGAIN, 0.2);
  for (let i = 0; i < 8; i++) out.push(cube(x + (r() - 0.5) * 1.8, y + (r() - 0.5) * 1.6, 0.012, 0.08, choix(r, ['#d6247a', '#ea4a9c', '#f77fbf']), 0.02));
  return out;
}

/**
 * Le fromager (le kapokier) : un arbre géant, un tronc gris très haut, des contreforts en planches au pied, et deux
 * étages de feuillage larges et plats.
 */
function fromager(x: number, y: number, r: () => number): V[] {
  const H = 4.3, l = 0.7;
  arbres.push({ x, y, tronc: H, l, cz: 4.7, rx: 2.7, rz: 0.6 });
  const out: V[] = [{ x: x - l / 2, y: y - l / 2, z: 0, w: l, d: l, h: H, c: '#a39e92', right: '#8a857a' }];
  // les contreforts : des lames qui partent du tronc, de plus en plus basses vers l'extérieur
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    for (let k = 1; k <= 3; k++) {
      const o = l / 2 + k * 0.28, h = 1.3 - k * 0.35;
      out.push({ x: x + dx * o - 0.06, y: y + dy * o - 0.06, z: 0, w: dx ? 0.3 : 0.12, d: dy ? 0.3 : 0.12, h, c: '#9a9488' });
    }
  }
  // les grosses branches, presque horizontales
  for (const [dx, dy] of [[1, 0.2], [-0.8, 0.6], [0.1, -1]]) out.push({ x: x + dx * 0.9 - 0.1, y: y + dy * 0.9 - 0.1, z: H - 0.8, w: Math.abs(dx) * 1.2 + 0.2, d: Math.abs(dy) * 1.2 + 0.2, h: 0.2, c: '#9a9488' });
  return [...out, ...couronne(x, y, H + 0.4, 2.7, 0.55, r, F_FROMAGER, 0.38), ...couronne(x + 0.4, y - 0.3, H - 0.6, 1.9, 0.4, r, F_FROMAGER, 0.38)];
}

/** Des hautes herbes, en touffe : des brins fins, hauts, verts et blonds. */
function hautesHerbes(x: number, y: number, r: () => number): V[] {
  return Array.from({ length: 12 }, () => {
    const a = r() * Math.PI * 2, d = r() * 0.45;
    return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, w: 0.05, d: 0.05, h: 0.35 + r() * 0.45, c: choix(r, ['#7aa83a', '#8fb94a', '#b8b25a', '#6b9a34']) };
  });
}

function fleurs(x: number, y: number, r: () => number, n = 9): V[] {
  const cs = ['#ff6b6b', '#ffd84a', '#ffffff', '#ffb347', '#ff9ed2'];
  const out: V[] = [];
  for (let i = 0; i < n; i++) {
    const fx = x + (r() - 0.5) * 1.6, fy = y + (r() - 0.5) * 1.0;
    out.push({ x: fx, y: fy, z: 0, w: 0.04, d: 0.04, h: 0.14, c: '#3d8f4a' });
    out.push({ x: fx - 0.04, y: fy - 0.04, z: 0.14, w: 0.12, d: 0.12, h: 0.08, c: choix(r, cs) });
  }
  return out;
}

function rochers(x: number, y: number, r: () => number): V[] {
  return [0, 1, 2].map(i => {
    const t = 0.25 + r() * 0.35;
    return { x: x + i * 0.35 + (r() - 0.5) * 0.2, y: y + (r() - 0.5) * 0.5, z: 0, w: t, d: t * 0.9, h: t * 0.7, c: i % 2 ? '#9aa0a8' : '#b4b9c0', top: '#c9cdd3' };
  });
}

/** La mare, devant (le reflet de la lune s'y pose la nuit, Lumieres.tsx). */
export const MARE = { x: 18.6, y: 31.2, w: 4.6, d: 1.6 };
const dansLaMare = (x: number, y: number, marge = 0) => {
  const cx = MARE.x + MARE.w / 2, cy = MARE.y + MARE.d / 2;
  return ((x - cx) / (MARE.w / 2 + marge)) ** 2 + ((y - cy) / (MARE.d / 2 + marge)) ** 2 <= 1;
};

/** La mare arrondie, en cubes : l'eau plus foncée au milieu, une bordure de pierres irrégulière, des roseaux, des nénuphars. */
function mare(r: () => number): V[] {
  const out: V[] = [];
  const { x, y, w, d } = MARE, cx = x + w / 2, cy = y + d / 2, pas = 0.25;
  for (let i = 0; i * pas < w; i++) for (let j = 0; j * pas < d; j++) {
    const px = x + i * pas + pas / 2, py = y + j * pas + pas / 2;
    const rho = Math.hypot((px - cx) / (w / 2), (py - cy) / (d / 2));
    if (rho > 1) continue;
    out.push({ x: px - pas / 2, y: py - pas / 2, z: -0.03, w: pas, d: pas, h: 0.05, c: rho < 0.45 ? '#2c67a8' : rho < 0.75 ? '#3b80c6' : '#58a0e2' });
  }
  for (const [fx, fy] of [[0.28, 0.35], [0.55, 0.62], [0.7, 0.3]]) out.push({ x: x + fx * w, y: y + fy * d, z: 0.02, w: 0.3, d: 0.26, h: 0.02, c: '#4caf50' }); // nénuphars
  out.push(cube(x + w * 0.58, y + d * 0.4, 0.04, 0.1, '#ff9ed2', 0.06));
  // la bordure : des pierres de tailles variées, parfois deux, parfois aucune
  for (let a = 0; a < Math.PI * 2; a += 0.3 + r() * 0.15) {
    if (r() < 0.15) continue;
    const k = 1.06 + r() * 0.1, t = 0.16 + r() * 0.16;
    const px = cx + Math.cos(a) * (w / 2) * k, py = cy + Math.sin(a) * (d / 2) * k;
    out.push(cube(px, py, 0, t, choix(r, ['#9aa0a8', '#b4b9c0', '#8a9096', '#a7adb5']), t * (0.45 + r() * 0.3)));
    if (r() < 0.25) out.push(cube(px + (r() - 0.5) * 0.25, py + (r() - 0.5) * 0.2, 0, t * 0.6, '#c3c8ce', t * 0.3));
  }
  // les roseaux, en touffes aux deux bouts
  for (const [ox, oy] of [[x + 0.25, y + d * 0.35], [x + w - 0.35, y + d * 0.7]]) {
    for (let i = 0; i < 9; i++) {
      const px = ox + (r() - 0.5) * 0.45, py = oy + (r() - 0.5) * 0.35, h = 0.4 + r() * 0.35;
      out.push(cube(px, py, 0, 0.04, choix(r, ['#5f8f3a', '#6fa344', '#7fb24e']), h));
      if (r() < 0.4) out.push(cube(px, py, h, 0.07, '#6b4226', 0.14)); // la massette
    }
  }
  return out;
}

function lampadaire(x: number, y: number): V[] {
  return [
    { x: x - 0.06, y: y - 0.06, z: 0, w: 0.12, d: 0.12, h: 1.4, c: '#2a2a36' },
    { x: x - 0.16, y: y - 0.16, z: 1.4, w: 0.32, d: 0.32, h: 0.24, c: '#9aa0a8', top: '#b4b9c0' }, // éteint le jour
    { x: x - 0.19, y: y - 0.19, z: 1.64, w: 0.38, d: 0.38, h: 0.06, c: '#2a2a36' },
  ];
}

function banc(x: number, y: number): V[] {
  return [
    { x, y, z: 0.22, w: 1.3, d: 0.4, h: 0.07, c: '#a8744a' },
    { x, y: y + 0.38, z: 0.22, w: 1.3, d: 0.07, h: 0.35, c: '#a8744a' },
    { x: x + 0.05, y: y + 0.05, z: 0, w: 0.08, d: 0.3, h: 0.22, c: '#2a2a36' },
    { x: x + 1.17, y: y + 0.05, z: 0, w: 0.08, d: 0.3, h: 0.22, c: '#2a2a36' },
  ];
}

// (les six derniers éclairent les terrains de basket et de foot, des deux côtés : on y joue le soir, src/sim/vie.ts ;
// la nuit tombée, les joueurs restent dans la lumière)
export const LAMPADAIRES: [number, number][] = [
  [12.6, 31.2], [29.4, 31.2], [40.3, 31.3], [40.3, 16.4], [33.6, 35.75],
  [-1.0, 20.2], [-1.0, 10.3], [-7.75, 8.4], [-7.75, 12.4], [-7.75, 18.2], [-7.75, 22.2],
];

/**
 * Les allées en pavés, posés à la main (un peu de jeu, trois teintes) : le long de la façade de devant, de l'entrée au
 * banc et à la mare, puis le long du côté droit jusqu'au lampadaire. Juste au-dessus de l'herbe.
 */
export const ALLEES: [number, number, number, number][] = [[0.3, 30.1, 39.6, 0.72], [39.15, 10.6, 0.75, 20.2]];
function allees(r: () => number): V[] {
  const out: V[] = [];
  const teintes = ['#d8c9a8', '#cbb994', '#e0d3b6', '#d2c29f'];
  for (const [x0, y0, w, d] of ALLEES) {
    for (let i = 0; i * 0.4 < w - 0.1; i++) for (let j = 0; j * 0.4 < d - 0.1; j++) {
      const t = 0.33 + r() * 0.04;
      out.push({ x: x0 + i * 0.4 + (r() - 0.5) * 0.04, y: y0 + j * 0.4 + (r() - 0.5) * 0.04, z: 0, w: t, d: t, h: 0.03, c: choix(r, teintes) });
    }
  }
  return out;
}

/** Un point d'herbe libre : sur l'île, hors du bâtiment, des allées, des sols (cour, terrasse, terrain, parking…), de la mare et du ruisseau. */
function libre(x: number, y: number) {
  if (x < ILE.x + 0.1 || x > ILE.x + ILE.w - 0.1 || y < ILE.y + 0.1 || y > ILE.y + ILE.d - 0.1) return false;
  if (x > -0.45 && x < GRID.w + 0.3 && y > -0.45 && y < GRID.h + 0.3) return false; // le bâtiment et ses murs
  if ([...ALLEES, ...SOLS].some(([ax, ay, w, d]) => x > ax - 0.08 && x < ax + w + 0.08 && y > ay - 0.08 && y < ay + d + 0.08)) return false;
  if (x > CASCADE.x - 0.3 && x < CASCADE.x + CASCADE.w + 0.3 && y > MARE.y + MARE.d - 0.4) return false;
  return !dansLaMare(x, y, 0.35);
}

/** Les touffes d'herbe (deux ou trois brins) et de petites fleurs, semées sur l'herbe visible. */
function herbe(r: () => number): V[] {
  const out: V[] = [];
  let touffes = 0, petites = 0;
  for (let essai = 0; essai < 14000 && (touffes < 500 || petites < 130); essai++) {
    const x = ILE.x + r() * ILE.w, y = ILE.y + r() * ILE.d;
    if (!libre(x, y)) continue;
    if (touffes < 500) {
      touffes++;
      const n = 2 + Math.floor(r() * 2);
      for (let b = 0; b < n; b++) out.push({ x: x + b * 0.05 - 0.05, y: y + (r() - 0.5) * 0.06, z: 0, w: 0.05, d: 0.05, h: 0.1 + r() * 0.12, c: choix(r, ['#4e9a3a', '#5aa040', '#6bb84e']) });
    } else {
      petites++;
      out.push({ x, y, z: 0, w: 0.04, d: 0.04, h: 0.08, c: '#3d8f4a' });
      out.push({ x: x - 0.03, y: y - 0.03, z: 0.08, w: 0.1, d: 0.1, h: 0.05, c: choix(r, ['#ffffff', '#ffd84a', '#ff9ed2', '#ffb347']) });
    }
  }
  return out;
}

function decor(): V[] {
  const r = rng(20261111);
  arbres = [];
  const d = Math.PI / 2; // penché vers l'avant (+y) ; 0 : vers la droite (+x)
  return [
    // devant, à gauche du parking : le coin, le banc, le flamboyant, la mare et sa cascade ; à droite, le parking
    ...cocotier(-1.9, 31.6, r, 1.05, d + 0.6), ...cocotier(-0.7, 32.4, r, 0.9, d - 0.3), ...bananier(1.0, 31.5, r), ...bougainvillier(2.6, 31.6, r),
    ...manguier(5.4, 31.95, r, 1.05), ...fleurs(8.0, 32.3, r, 11), ...banc(10.2, 31.05),
    ...flamboyant(15.3, 31.95, r), ...mare(r), ...ruisseauEtCascade(MARE.y + MARE.d - 0.15), ...rochers(23.4, 32.0, r),
    ...cocotier(-6.3, 33.6, r, 1.0, d + 0.4), ...bananier(-4.3, 31.2, r), ...bougainvillier(3.6, 34.7, r, 0.9), ...flamboyant(8.6, 34.4, r, 0.85),
    ...cocotier(12.6, 35.0, r, 1.0, d), ...rochers(16.6, 34.9, r), ...hautesHerbes(18.5, 34.6, r), ...hautesHerbes(23.6, 34.4, r),
    ...palmier(24.4, 34.4, r, 0.95), ...cocotier(42.0, 32.1, r, 1.1, Math.PI / 4), ...cocotier(42.8, 35.2, r, 0.9, d), ...manguier(44.2, 33.0, r),
    ...devant(),
    // à droite : le potager, le hamac entre deux cocotiers, un flamboyant, des bananiers
    ...droite(r), ...bananier(40.4, 9.5, r), ...bananier(45.7, 9.9, r), ...manguier(44.0, -2.4, r, 1.15), ...bananier(45.6, 0.1, r),
    ...cocotier(42.4, 13.6, r, 1.05, 0), ...cocotier(42.4, 18.8, r, 1.05, Math.PI), ...hamac(42.4, 13.85, 18.55, 1.05), ...fleurs(41.0, 11.2, r),
    ...bougainvillier(40.7, 22.6, r), ...flamboyant(44.5, 22.0, r, 0.95), ...rochers(44.8, 16.0, r), ...palmier(42.3, 26.5, r), ...cocotier(45.2, 29.2, r, 1.05, 0.3),
    ...hautesHerbes(45.4, 19.2, r), ...hautesHerbes(41.6, 28.8, r),
    // à gauche : la terrasse de pause, le terrain de basket ; derrière eux, des arbres
    ...gauche(r), ...terrainDeFoot(),
    ...flamboyant(-4.8, 27.4, r), ...cocotier(-6.6, 28.9, r, 1.0, Math.PI), ...palmier(-2.4, 26.4, r, 0.9),
    ...bougainvillier(-6.9, 25.3, r, 0.75), ...hautesHerbes(-3.4, 25.2, r), ...rochers(-7.2, 30.2, r),
    // derrière : la cour de service, la clôture et ses bougainvilliers, le fromager géant dans le coin
    ...derriere(), ...fromager(-4.2, -3.2, r),
    ...flamboyant(8.2, -3.6, r, 0.85), ...manguier(19.0, -3.7, r, 0.95), ...cocotier(32.6, -3.9, r, 1.0, -d), ...bananier(40.5, -4.4, r),
    ...[-1.8, 16.5, 30.8, 38.6].flatMap(x => bougainvillier(x, -5.35, r, 0.75)),
    ...hautesHerbes(-6.8, -1.2, r), ...hautesHerbes(14.8, -5.0, r), ...rochers(9.6, -5.1, r),
    ...LAMPADAIRES.flatMap(([x, y]) => lampadaire(x, y)),
    ...allees(r),
    ...herbe(r),
    ...bords(r),
    ...dessous(r),
  ];
}

/** Les arbres du décor (pied, hauteur, couronne), pour les vérifier : aucun derrière les murs du fond, rien devant l'entrée. */
export function arbresDuDecor(): readonly Arbre[] {
  decor();
  return arbres;
}

/** La pelouse à deux tons : une seule image posée sur l'île, des plaques plus claires et plus sombres (bruit doux). */
function pelouse() {
  const P = 4, W = Math.round(ILE.w * P), H = Math.round(ILE.d * P);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(77);
  const G = 7, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
  const grille = Array.from({ length: gw * gh }, () => r());
  const v = (i: number, j: number) => grille[j * gw + i];
  const doux = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / G, fy = y / G, i = Math.floor(fx), j = Math.floor(fy), tx = doux(fx - i), ty = doux(fy - j);
    const n = (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
    g.fillStyle = n < 0.36 ? '#72b852' : n > 0.66 ? '#88cb63' : '#7cc35a';
    g.fillRect(x, y, 1, 1);
  }
  for (let k = 0; k < W * H * 0.02; k++) { g.fillStyle = r() < 0.5 ? '#6aae4b' : '#8ed06a'; g.fillRect(Math.floor(r() * W), Math.floor(r() * H), 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Pelouse() {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useLayoutEffect(() => { if (ref.current) { ref.current.map = pelouse(); ref.current.needsUpdate = true; } }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ILE.x + ILE.w / 2, 0.001, ILE.y + ILE.d / 2]}>
      <planeGeometry args={[ILE.w, ILE.d]} />
      <meshBasicMaterial ref={ref} color="#ffffff" />
    </mesh>
  );
}

// ── Les ombres des arbres : une tache sombre et douce au sol, à l'opposé du soleil, relue à chaque minute.
// Une ombre ne tombe que dehors, sur l'herbe : chaque arbre la garde de son côté du bâtiment (src/sim/lumiere.ts,
// coteDehors), au-delà de ses murs ; jamais sur une pièce, un mur ou un meuble. Juste au-dessus de l'herbe et des pavés.
const SOL = 0.035;
/** Le bâtiment (le sol des pièces), agrandi de l'épaisseur des murs du fond. */
const BATIMENT = { x: 0, y: 0, w: GRID.w, h: GRID.h, marge: 0.35 };
const PLAQUE = new THREE.PlaneGeometry(1, 1);
/** Les bords de l'île : une ombre longue du soir ne dépasse pas dans le ciel. */
const BORDS = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), -ILE.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), ILE.x + ILE.w),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), -ILE.y), new THREE.Plane(new THREE.Vector3(0, 0, -1), ILE.y + ILE.d),
];
/** Une tache ronde au bord fondu (dessinée une fois). */
function tacheDouce() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  d.addColorStop(0, 'rgba(255,255,255,1)'); d.addColorStop(0.7, 'rgba(255,255,255,.92)'); d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Une tache allongée dans la direction de l'ombre : `long` et `large` sont les demi-axes. */
function Tache({ x, y, angle, long, large, map, opacite, plans }: { x: number; y: number; angle: number; long: number; large: number; map: THREE.Texture; opacite: number; plans: THREE.Plane[] }) {
  return (
    <group position={[x, SOL, y]} rotation={[0, angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[long * 2, large * 2, 1]} geometry={PLAQUE}>
        <meshBasicMaterial color="#14321a" map={map} transparent opacity={opacite} depthWrite={false} clippingPlanes={plans} />
      </mesh>
    </group>
  );
}

function Ombres({ liste }: { liste: Arbre[] }) {
  const o = ombreAuSol(minutesDe(useQG(s => s.horloge)));
  const map = useMemo(() => tacheDouce(), []);
  // pour chaque arbre : les bords de l'île et le bord du bâtiment de son côté
  const plans = useMemo(() => liste.map(a => {
    const c = coteDehors(a.x, a.y, BATIMENT);
    return [...BORDS, new THREE.Plane(new THREE.Vector3(c.nx, 0, c.ny), c.c)];
  }), [liste]);
  if (o.force <= 0) return null; // la nuit, pas d'ombre
  const angle = Math.atan2(-o.dy, o.dx), L = o.longueur, op = 0.42 * o.force;
  return (
    <group>
      {liste.map((a, i) => {
        const dc = a.cz * L, dt = (a.tronc * L) / 2;
        return (
          <group key={i}>
            {/* le tronc, puis la couronne, plus loin et plus étirée quand le soleil est bas */}
            <Tache x={a.x + o.dx * dt} y={a.y + o.dy * dt} angle={angle} long={dt + a.l / 2} large={a.l * 0.6} map={map} opacite={op * 0.8} plans={plans[i]} />
            <Tache x={a.x + o.dx * dc} y={a.y + o.dy * dc} angle={angle} long={Math.hypot(a.rx, a.rz * L)} large={a.rx} map={map} opacite={op} plans={plans[i]} />
          </group>
        );
      })}
    </group>
  );
}

export function Nature() {
  // tous les cubes du décor (feuilles, troncs, pavés, rochers, lampadaires…) sont dessinés d'un seul coup (Blocs.tsx)
  const [tous, liste] = useMemo(() => [decor(), arbres] as const, []);
  return (
    <group>
      <Pelouse />
      <Ombres liste={liste} />
      <Blocs blocs={tous} />
    </group>
  );
}
