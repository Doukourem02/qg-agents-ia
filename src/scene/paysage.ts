import { GRID, ILE } from '@/data/layout';
import type { Bloc } from './Blocs';

// Le paysage autour du bâtiment, côté par côté, comme un vrai bureau d'Abidjan (des décors : aucune donnée) :
//  · derrière (le long mur du fond) : la cour de service, les climatiseurs au pied du mur, le polytank sur son pied,
//    le groupe électrogène, l'abri aux panneaux solaires, les grands bacs de tri, une clôture ;
//  · à gauche (la salle de pause, l'Atelier) : un terrain de foot et un terrain de basket, côte à côte, de la même taille ;
//  · à droite (la salle à manger, les toilettes) : le potager, un hamac entre deux cocotiers (les arbres sont dans Nature) ;
//  · devant (l'entrée) : le parking (motos, une voiture, un taxi orange, des vélos), la boîte aux lettres, le drapeau ;
//  · tout autour : le bord de l'île en roche et latérite, des racines, une cascade qui tombe dans le vide.
// Tout est fait de blocs (Blocs.tsx), dessinés d'un seul coup avec le reste de la nature.

export type V = Bloc & { z: number };
const b = (x: number, y: number, z: number, w: number, d: number, h: number, c: string, o: Partial<V> = {}): V => ({ x, y, z, w, d, h, c, ...o });
const cyl = (cx: number, cy: number, z: number, diam: number, h: number, c: string, o: Partial<V> = {}): V => b(cx - diam / 2, cy - diam / 2, z, diam, diam, h, c, { forme: 'cylindre', ...o });
const choix = <T,>(r: () => number, l: readonly T[]) => l[Math.floor(r() * l.length)];

/** Les surfaces posées au sol (pas d'herbe dessus) : [x, y, largeur, profondeur]. */
export const SOLS: [number, number, number, number][] = [
  [0, -1.45, GRID.w, 1.1], // la cour de service, derrière
  [21.6, -5.5, 8, 3.4], // sous l'abri solaire
  [-7.5, 16.0, 6.2, 8.4], // le terrain de basket
  [-1.3, 11, 0.7, 19.8], // l'allée de gauche
  [40.9, 0.8, 4.9, 8.3], // le potager
  [26.3, 31.2, 14.4, 4.5], // le parking
  [39.0, 35.5, 1.6, 0.5], // la sortie du parking
  [-7.5, 5.5, 6.2, 9.8], // le terrain de foot
];
/** La cascade : le ruisseau qui part de la mare et tombe du bord de l'île, devant. */
export const CASCADE = { x: 20.95, w: 0.6 };

// ── Derrière : la cour de service

function climatiseur(x: number): V[] {
  const y = -1.3;
  return [
    b(x - 0.05, y - 0.05, 0.03, 0.9, 0.7, 0.06, '#9aa0a8'), // le socle
    b(x, y, 0.09, 0.8, 0.6, 0.55, '#e9e9ef', { top: '#f4f4f6' }),
    b(x + 0.12, y - 0.015, 0.16, 0.5, 0.02, 0.42, '#3a3f55'), cyl(x + 0.37, y - 0.02, 0.33, 0.12, 0.02, '#c9ccd3'), // la grille du ventilateur
    b(x + 0.62, y + 0.6, 0.3, 0.05, 0.33, 0.05, '#c9ccd3'), b(x + 0.7, y + 0.6, 0.38, 0.05, 0.33, 0.05, '#2a2a36'), // les tuyaux, jusqu'au mur
  ];
}

function polytank(x: number, y: number): V[] {
  const out: V[] = [];
  for (const [dx, dy] of [[0, 0], [1.25, 0], [0, 1.25], [1.25, 1.25]]) out.push(b(x + dx, y + dy, 0, 0.09, 0.09, 1.4, '#7d848c'));
  out.push(b(x - 0.05, y - 0.05, 1.4, 1.44, 1.44, 0.08, '#6b7280'), b(x + 0.3, y + 0.62, 0.55, 0.7, 0.05, 0.05, '#7d848c')); // le plateau, une traverse
  out.push(cyl(x + 0.67, y + 0.67, 1.48, 1.22, 1.25, '#1d1b2e', { top: '#2a2a36' }), cyl(x + 0.67, y + 0.67, 2.73, 0.36, 0.08, '#2a2a36')); // la cuve noire, son couvercle
  out.push(b(x + 1.2, y + 0.6, 0.1, 0.07, 0.07, 1.4, '#3a3f55')); // le tuyau qui descend
  return out;
}

function groupeElectrogene(x: number, y: number): V[] {
  return [
    b(x - 0.15, y - 0.15, 0, 2.1, 1.3, 0.08, '#b9b2a4'),
    b(x, y, 0.08, 1.8, 1.0, 0.95, '#2f7d45', { top: '#256b3a' }),
    b(x + 0.1, y + 1.0, 0.25, 0.5, 0.02, 0.5, '#1d1b2e'), b(x + 0.2, y + 1.01, 0.62, 0.12, 0.02, 0.06, '#f2c94c'), // le tableau de bord
    b(x + 0.8, y + 1.0, 0.2, 0.9, 0.02, 0.7, '#256b3a'), // la grille d'air
    cyl(x + 1.5, y + 0.3, 1.03, 0.12, 0.55, '#3a3f55'), // le pot d'échappement
    cyl(x + 2.35, y + 0.5, 0, 0.55, 0.85, '#2f6fd6', { top: '#2458b0' }), // un fût de gasoil
  ];
}

/** L'abri aux panneaux solaires : six poteaux, un toit en trois gradins de panneaux bleu nuit, quadrillés. */
function abriSolaire(x: number, y: number, w: number): V[] {
  const out: V[] = [];
  for (const dx of [0, w / 2, w - 0.1]) { out.push(b(x + dx, y, 0, 0.1, 0.1, 2.05, '#9aa0a8'), b(x + dx, y + 2.9, 0, 0.1, 0.1, 1.65, '#9aa0a8')); }
  for (let k = 0; k < 3; k++) {
    const yy = y + k * 1.0, z = 2.05 - k * 0.17;
    out.push(b(x - 0.1, yy - 0.05, z, w + 0.2, 1.05, 0.06, '#1f3a6b', { top: '#28508f' }));
    for (let i = 1; i < w; i += 0.9) out.push(b(x + i, yy - 0.05, z + 0.06, 0.03, 1.05, 0.006, '#c9ccd3'));
  }
  return out;
}

function bacsDeTri(x: number, y: number): V[] {
  return (['#3d9c5a', '#f2c94c', '#2f6fd6', '#6b6f78'] as const).flatMap((c, i) => [
    b(x + i * 0.82, y, 0.08, 0.7, 0.65, 0.85, c), b(x + i * 0.82 - 0.02, y - 0.02, 0.93, 0.74, 0.69, 0.05, '#2a2a36'),
    b(x + i * 0.82 + 0.05, y + 0.5, 0, 0.12, 0.12, 0.1, '#1d1b2e'), b(x + i * 0.82 + 0.53, y + 0.5, 0, 0.12, 0.12, 0.1, '#1d1b2e'),
  ]);
}

/** Une clôture de grillage le long d'une ligne (en x à y fixe, ou en y à x fixe), des poteaux tous les mètres. */
function cloture(x0: number, y0: number, longueur: number, enX: boolean): V[] {
  const out: V[] = [];
  for (let u = 0; u <= longueur; u += 1.0) out.push(b(enX ? x0 + u : x0, enX ? y0 : y0 + u, 0, 0.08, 0.08, 1.0, '#7d848c'));
  for (const z of [0.3, 0.92]) out.push(enX ? b(x0, y0 + 0.02, z, longueur, 0.04, 0.04, '#9aa0a8') : b(x0 + 0.02, y0, z, 0.04, longueur, 0.04, '#9aa0a8'));
  out.push(enX ? b(x0, y0 + 0.035, 0.32, longueur, 0.01, 0.6, '#b8bec6') : b(x0 + 0.035, y0, 0.32, 0.01, longueur, 0.6, '#b8bec6')); // le grillage
  return out;
}

export function derriere(): V[] {
  return [
    b(0, -1.45, 0, GRID.w, 1.08, 0.03, '#c9c2b4', { top: '#d6cfc1' }), // la cour de service, en béton (jusqu'au pied du mur)
    ...[2.5, 7.5, 12.5, 18.2, 24.5, 30.2, 35.8].flatMap(climatiseur),
    ...polytank(4.0, -4.6),
    ...groupeElectrogene(11.5, -4.2),
    b(21.6, -5.5, 0, 8, 3.4, 0.03, '#b9b2a4'), ...abriSolaire(21.8, -5.3, 7.4),
    ...bacsDeTri(34.6, -3.0),
    ...cloture(-7.6, -5.75, 53.8, true),
  ];
}

// ── À gauche : le terrain de basket (le terrain de foot est à côté, plus bas dans ce fichier)

/** Le terrain de basket (les joueurs de la simulation y jouent : src/sim/vie.ts). */
export const BASKET = { x: -7.3, y: 16.2, w: 5.8, d: 8.0 };
/** Les deux arceaux : le centre du cercle, en haut (côté y0) et en bas (côté y0 + d), à 1,87 du sol. */
export const PANIERS: [number, number, number][] = [[BASKET.x + BASKET.w / 2, BASKET.y + 0.15, 1.87], [BASKET.x + BASKET.w / 2, BASKET.y + BASKET.d - 0.15, 1.87]];

export function gauche(r: () => number): V[] {
  const out: V[] = [];
  // le terrain de basket : le sol, ses lignes blanches, deux paniers, un ballon
  const { x: x0, y: y0, w, d } = BASKET;
  out.push(b(x0 - 0.2, y0 - 0.2, 0, w + 0.4, d + 0.4, 0.03, '#2f6f5e'), b(x0, y0, 0.03, w, d, 0.01, '#c9673a'));
  const ligne = (x: number, y: number, lw: number, ld: number) => out.push(b(x, y, 0.04, lw, ld, 0.004, '#fbfbf8'));
  ligne(x0, y0, w, 0.06); ligne(x0, y0 + d - 0.06, w, 0.06); ligne(x0, y0, 0.06, d); ligne(x0 + w - 0.06, y0, 0.06, d); ligne(x0, y0 + d / 2 - 0.03, w, 0.06);
  for (const [ky, sens] of [[y0, 1], [y0 + d, -1]] as const) {
    const ka = sens > 0 ? ky : ky - 1.9;
    ligne(x0 + w / 2 - 0.9, ka, 0.06, 1.9); ligne(x0 + w / 2 + 0.84, ka, 0.06, 1.9); ligne(x0 + w / 2 - 0.9, sens > 0 ? ky + 1.84 : ky - 1.9, 1.8, 0.06);
    // le panier : le poteau, le panneau, l'arceau orange, le filet
    const px = x0 + w / 2, py = sens > 0 ? ky - 0.5 : ky + 0.4;
    out.push(b(px - 0.06, py, 0, 0.12, 0.12, 2.05, '#3a3f55'), b(px - 0.03, sens > 0 ? py + 0.12 : py - 0.3, 1.95, 0.06, 0.3, 0.06, '#3a3f55'));
    const pan = sens > 0 ? ky - 0.12 : ky + 0.06;
    out.push(b(px - 0.5, pan, 1.75, 1.0, 0.06, 0.62, '#fbfbf8'), b(px - 0.2, pan, 1.85, 0.4, 0.065, 0.28, '#e05a5a', { left: '#fbfbf8' }));
    const ry = sens > 0 ? pan + 0.08 : pan - 0.4;
    out.push(b(px - 0.2, ry, 1.86, 0.4, 0.03, 0.03, '#f07c28'), b(px - 0.2, ry + 0.37, 1.86, 0.4, 0.03, 0.03, '#f07c28'), b(px - 0.2, ry, 1.86, 0.03, 0.4, 0.03, '#f07c28'), b(px + 0.17, ry, 1.86, 0.03, 0.4, 0.03, '#f07c28'));
    for (const [nx, ny] of [[0.05, 0.05], [0.3, 0.05], [0.05, 0.3], [0.3, 0.3]]) out.push(b(px - 0.2 + nx, ry + ny, 1.62, 0.02, 0.02, 0.24, '#f4f1ea'));
  }
  out.push(cyl(x0 + 1.9, y0 + 3.2, 0.04, 0.24, 0.22, '#e8742a'));
  // l'allée de gauche, qui relie la façade de devant aux deux terrains
  for (let j = 0; j * 0.4 < 19.8; j++) out.push(b(-1.25 + (j % 2) * 0.02, 11 + j * 0.4, 0, 0.66, 0.36, 0.03, choix(r, ['#d8c9a8', '#cbb994', '#e0d3b6'])));
  return out;
}

// ── À droite : le potager

export function droite(r: () => number): V[] {
  const out: V[] = [];
  // quatre bacs en bois, de la terre, des rangs : salades, tomates sur tuteurs, gombos, piments
  for (let k = 0; k < 4; k++) {
    const y = 1.0 + k * 2.05, x = 41.1;
    out.push(b(x, y, 0, 4.5, 1.1, 0.3, '#8a5a34', { top: '#5a3a26' }));
    for (let i = 0; i < 9; i++) {
      const px = x + 0.3 + i * 0.47;
      if (k === 0) out.push(b(px - 0.12, y + 0.3, 0.3, 0.24, 0.24, 0.14, choix(r, ['#8fd16a', '#7cc35a', '#a6dc7e'])), b(px - 0.12, y + 0.65, 0.3, 0.24, 0.24, 0.14, choix(r, ['#8fd16a', '#7cc35a'])));
      if (k === 1) { out.push(b(px - 0.02, y + 0.5, 0.3, 0.04, 0.04, 0.7, '#a8794a'), b(px - 0.1, y + 0.42, 0.45, 0.2, 0.2, 0.4, '#3d8f4a')); if (r() < 0.7) out.push(b(px + 0.05, y + 0.48, 0.55, 0.09, 0.09, 0.09, '#d64545')); }
      if (k === 2) out.push(b(px - 0.05, y + 0.5, 0.3, 0.1, 0.1, 0.5, '#4e9a3a'), b(px - 0.12, y + 0.43, 0.65, 0.24, 0.24, 0.12, '#5aa843'));
      if (k === 3) { out.push(b(px - 0.1, y + 0.45, 0.3, 0.2, 0.2, 0.22, '#3d8f4a')); if (r() < 0.8) out.push(b(px - 0.03, y + 0.5, 0.48, 0.06, 0.06, 0.08, choix(r, ['#e05a5a', '#f2a33a']))); }
    }
  }
  out.push(cyl(45.75, 9.4, 0, 0.3, 0.28, '#3d9c5a'), b(45.9, 9.36, 0.12, 0.22, 0.06, 0.04, '#3d9c5a')); // l'arrosoir
  return out;
}

/** Le hamac, tendu entre deux points (x, y1) et (x, y2) à la hauteur z : une toile rayée qui creuse au milieu. */
export function hamac(x: number, y1: number, y2: number, z: number): V[] {
  const out: V[] = [], n = 14, L = y2 - y1;
  for (let k = 0; k <= n; k++) {
    const f = k / n, y = y1 + f * L, creux = 0.55 * Math.sin(Math.PI * f), large = 0.25 + 0.4 * Math.sin(Math.PI * f);
    if (f < 0.12 || f > 0.88) out.push(b(x - 0.02, y, z - creux, 0.04, L / n, 0.03, '#c9a27a')); // les cordes
    else out.push(b(x - large / 2, y, z - creux, large, L / n + 0.01, 0.04, ['#e0753f', '#f2c94c', '#3d9c5a'][k % 3]));
  }
  return out;
}

// ── Devant : le parking

function voiture(x: number, y: number, c: string, toit: string, taxi = false): V[] {
  // garée en épi, l'avant vers le bâtiment (vers le haut du plan)
  const out = [
    b(x, y, 0.14, 1.1, 2.0, 0.34, c, { top: toit }),
    b(x + 0.08, y + 0.5, 0.48, 0.94, 1.0, 0.3, '#9cc0e8', { top: c }), // l'habitacle et ses vitres
    b(x + 0.1, y - 0.01, 0.3, 0.2, 0.02, 0.08, '#fff3c4'), b(x + 0.8, y - 0.01, 0.3, 0.2, 0.02, 0.08, '#fff3c4'), // les phares
    b(x + 0.1, y + 2.0, 0.3, 0.2, 0.02, 0.08, '#d64545'), b(x + 0.8, y + 2.0, 0.3, 0.2, 0.02, 0.08, '#d64545'),
  ];
  for (const [dx, dy] of [[-0.04, 0.25], [1.0, 0.25], [-0.04, 1.4], [1.0, 1.4]]) out.push(b(x + dx, y + dy, 0, 0.14, 0.4, 0.28, '#1d1b2e'));
  if (taxi) out.push(b(x + 0.4, y + 0.85, 0.78, 0.3, 0.2, 0.1, '#fbfbf8'), b(x + 0.02, y + 0.95, 0.3, 1.06, 0.3, 0.06, '#1d1b2e')); // le lumineux, la bande
  return out;
}
function moto(x: number, y: number, c: string): V[] {
  return [
    b(x, y, 0.1, 0.04, 0.32, 0.32, '#1d1b2e'), b(x, y + 0.9, 0.1, 0.04, 0.32, 0.32, '#1d1b2e'), // les roues
    b(x - 0.08, y + 0.25, 0.25, 0.2, 0.75, 0.18, c), b(x - 0.07, y + 0.55, 0.43, 0.18, 0.38, 0.06, '#2a2a36'), // le corps, la selle
    b(x - 0.02, y + 0.12, 0.25, 0.08, 0.08, 0.35, '#7d848c'), b(x - 0.25, y + 0.14, 0.58, 0.54, 0.04, 0.04, '#2a2a36'), // la fourche, le guidon
  ];
}
function velo(x: number, y: number, c: string): V[] {
  return [
    b(x, y, 0.05, 0.03, 0.34, 0.34, '#2a2a36'), b(x, y + 0.62, 0.05, 0.03, 0.34, 0.34, '#2a2a36'),
    b(x - 0.005, y + 0.17, 0.25, 0.04, 0.62, 0.04, c), b(x - 0.005, y + 0.4, 0.25, 0.04, 0.04, 0.22, c), b(x - 0.04, y + 0.36, 0.47, 0.11, 0.14, 0.03, '#1d1b2e'),
    b(x - 0.005, y + 0.12, 0.25, 0.04, 0.04, 0.28, c), b(x - 0.15, y + 0.12, 0.53, 0.33, 0.03, 0.03, '#2a2a36'),
  ];
}

export function devant(): V[] {
  const out: V[] = [];
  const [x0, y0, w, d] = [26.3, 31.2, 14.4, 4.5];
  out.push(b(x0, y0, 0, w, d, 0.025, '#5b6275', { top: '#6b7280' }));
  // les places, en épi : des lignes blanches, une bordure
  for (let x = x0 + 0.4; x < x0 + w - 0.2; x += 1.45) out.push(b(x, y0 + 2.3, 0.025, 0.05, 2.0, 0.004, '#fbfbf8'));
  out.push(b(x0 + 0.2, y0 + 2.25, 0.025, w - 0.4, 0.05, 0.004, '#fbfbf8'));
  out.push(b(39.0, 35.5, 0, 1.6, 0.5, 0.025, '#5b6275', { top: '#6b7280' })); // la sortie, vers la route
  // la barrière de la sortie : le poteau, la lisse rayée
  out.push(b(38.8, 35.55, 0, 0.18, 0.18, 0.75, '#f2c94c'), ...[0, 1, 2, 3].map(i => b(38.98 + i * 0.4, 35.62, 0.62, 0.4, 0.05, 0.05, i % 2 ? '#fbfbf8' : '#d64545')));
  // les véhicules : une voiture, un taxi orange, deux motos, et des vélos au range-vélos près de l'entrée
  out.push(...voiture(31.95, 33.4, '#2f6fd6', '#4a86e8'), ...voiture(34.85, 33.4, '#f08a24', '#f6a14a', true));
  out.push(...moto(27.2, 33.6, '#d64545'), ...moto(28.0, 33.7, '#1d1b2e'), ...moto(37.9, 33.6, '#3d9c5a'));
  for (const x of [27.2, 27.6, 28.0]) out.push(b(x - 0.03, 31.55, 0, 0.04, 0.04, 0.4, '#9aa0a8'), b(x - 0.03, 32.25, 0, 0.04, 0.04, 0.4, '#9aa0a8'), b(x - 0.03, 31.55, 0.38, 0.04, 0.74, 0.04, '#9aa0a8')); // le range-vélos
  out.push(...velo(27.4, 31.45, '#e0753f'), ...velo(27.8, 31.5, '#5ab0c9'));
  // la boîte aux lettres, près de l'entrée ; le drapeau (orange, blanc, vert)
  out.push(b(32.95, 31.2, 0, 0.08, 0.08, 0.9, '#3a3f55'), b(32.82, 31.12, 0.9, 0.34, 0.26, 0.3, '#f2c94c', { top: '#2f6fd6' }), b(32.88, 31.385, 1.08, 0.22, 0.01, 0.03, '#1d1b2e'));
  out.push(cyl(25.85, 31.45, 0, 0.3, 0.06, '#9aa0a8'), cyl(25.85, 31.45, 0.06, 0.08, 3.0, '#c9ccd3'));
  ['#f07c28', '#fbfbf8', '#2f9a4a'].forEach((c, i) => out.push(b(25.9 + i * 0.32, 31.43, 2.45, 0.32, 0.03, 0.55, c)));
  return out;
}

// ── Tout autour : le bord de l'île, en roche et en latérite

const COUCHES_BORD = [{ z0: -0.55, z1: -0.12, c: '#c4683f' }, { z0: -1.05, z1: -0.55, c: '#a9502f' }, { z0: -1.6, z1: -1.05, c: '#7c3b25' }];
const ROCHES = ['#8f8a84', '#a39e96', '#7d7872', '#6b665f', '#9a8f80'];

/**
 * Les quatre côtés de l'île (on peut maintenant tourner autour) : la pelouse qui déborde, des bosses de latérite,
 * des affleurements de roche grise, des racines qui pendent, un dessous en gradins ; la cascade passe devant.
 */
export function bords(r: () => number): V[] {
  const out: V[] = [];
  const X0 = ILE.x, Y0 = ILE.y, X1 = ILE.x + ILE.w, Y1 = ILE.y + ILE.d;
  // chaque côté : le long de x (nord, sud) ou de y (ouest, est), sa ligne, et le sens de l'extérieur
  const cotes = [
    { enX: true, n: ILE.w, a0: X0, f: Y1, s: 1 }, { enX: true, n: ILE.w, a0: X0, f: Y0, s: -1 },
    { enX: false, n: ILE.d, a0: Y0, f: X1, s: 1 }, { enX: false, n: ILE.d, a0: Y0, f: X0, s: -1 },
  ];
  for (const c of cotes) {
    /** Un bloc le long du côté : de u à u + l, de `a` à `b` vers l'extérieur (négatif : vers l'intérieur). */
    const piece = (u: number, l: number, a: number, bb: number, z: number, h: number, col: string): V => {
      const p0 = c.f + c.s * a, p1 = c.f + c.s * bb, lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      return c.enX ? b(c.a0 + u, lo, z, l, hi - lo, h, col) : b(lo, c.a0 + u, z, hi - lo, l, h, col);
    };
    for (let u = 0; u < c.n; u += 0.5) {
      const ax = c.a0 + u;
      if (c.enX && c.s > 0 && ax > CASCADE.x - 0.6 && ax < CASCADE.x + CASCADE.w + 0.4) { out.push(piece(u, 0.5, -0.8, 0, -1.9, 0.3, '#6a3220')); continue; }
      if (r() < 0.3) out.push(piece(u + r() * 0.2, 0.25 + r() * 0.25, -0.02, 0.05, -0.08 - r() * 0.1, 0.12 + r() * 0.06, choix(r, ['#5aa040', '#4e9a3a', '#6bb84e'])));
      if (r() < 0.55) { const k = choix(r, COUCHES_BORD), h = 0.15 + r() * 0.25; out.push(piece(u, 0.5, 0, 0.04 + r() * 0.1, k.z0 + r() * Math.max(0.01, k.z1 - k.z0 - h), h, k.c)); }
      // des affleurements de roche : deux ou trois blocs qui sortent, à toutes les hauteurs
      if (r() < 0.22) {
        const z = -1.5 + r() * 1.2, t = 0.2 + r() * 0.35;
        out.push(piece(u, t + 0.1, -0.1, 0.12 + r() * 0.25, z, t, choix(r, ROCHES)));
        if (r() < 0.6) out.push(piece(u + 0.15, t * 0.6, 0, 0.2 + r() * 0.2, z + t * 0.6, t * 0.6, choix(r, ROCHES)));
      }
      if (r() < 0.12) { const h = 0.2 + r() * 0.5; out.push(piece(u + r() * 0.4, 0.05, 0.01, 0.05, -0.12 - h, h, '#4a2c1a')); } // une racine
      const p = 0.3 + r() * 0.9;
      out.push(piece(u, 0.5, -p, 0, -1.6 - (0.15 + r() * 0.35), 0.5, '#6a3220'));
      if (r() < 0.35) { const p2 = p + 0.4 + r() * 0.8; out.push(piece(u, 0.5, -p2, -p, -1.6 - (0.6 + r() * 0.5), 0.8, choix(r, ['#5a2a1b', '#6b665f']))); }
      if (r() < 0.08) out.push(piece(u, 0.5, -p - 0.6, -p, -2.6 - r() * 0.6, 0.6, '#5a2a1b')); // un gros rocher qui pend
    }
  }
  return out;
}

/** Le ruisseau qui sort de la mare et file vers le bord, puis la cascade figée (l'eau qui tombe bouge dans Vie.tsx). */
export function ruisseauEtCascade(yMare: number): V[] {
  const out: V[] = [], { x, w } = CASCADE, Y1 = ILE.y + ILE.d;
  for (let y = yMare; y < Y1; y += 0.25) out.push(b(x, y, -0.03, w, 0.25, 0.05, y % 0.5 < 0.25 ? '#3b80c6' : '#4a90d9'));
  for (let y = yMare; y < Y1; y += 0.45) { out.push(b(x - 0.22, y, 0, 0.2, 0.2, 0.12, '#9aa0a8', { top: '#b4b9c0' }), b(x + w + 0.02, y + 0.2, 0, 0.2, 0.2, 0.1, '#8a9096')); }
  // la chute : un rideau d'eau collé au bord, du haut jusque sous l'île, plus clair en haut, de l'écume au pied
  for (let z = 0.0; z > -4.2; z -= 0.3) out.push(b(x + 0.03, Y1, z - 0.3, w - 0.06, 0.18, 0.3, z > -1 ? '#6fb4ea' : z > -2.5 ? '#5aa3e2' : '#8cc7f0'));
  out.push(b(x - 0.05, Y1 + 0.1, -0.05, w + 0.1, 0.12, 0.1, '#e6f2fa'));
  return out;
}

/** Une petite île flottante, autour de l'origine : sa pelouse, sa latérite en gradins dessous, une plante ou une roche. */
export function ilot(r: () => number, rayon: number): V[] {
  const out: V[] = [];
  for (let i = -rayon; i <= rayon; i += 0.4) for (let j = -rayon; j <= rayon; j += 0.4) {
    const d = Math.hypot(i, j) / rayon;
    if (d > 1) continue;
    out.push(b(i - 0.2, j - 0.2, -0.12, 0.4, 0.4, 0.12, choix(r, ['#7cc35a', '#72b852', '#88cb63']), { top: choix(r, ['#7cc35a', '#72b852', '#88cb63']) }));
    const prof = 0.4 + (1 - d) * 1.6 + r() * 0.3;
    out.push(b(i - 0.2, j - 0.2, -0.12 - prof, 0.4, 0.4, prof, d < 0.5 ? '#7c3b25' : '#a9502f'));
  }
  out.push(b(-0.2, -0.3, 0, 0.45, 0.4, 0.3, '#9aa0a8', { top: '#b4b9c0' }));
  // un petit arbre : un tronc, une boule de feuilles
  out.push(b(rayon * 0.3 - 0.07, 0.1, 0, 0.14, 0.14, 0.9, '#6e4a32'));
  for (let k = 0; k < 9; k++) out.push(b(rayon * 0.3 - 0.35 + (k % 3) * 0.24, -0.15 + Math.floor(k / 3) * 0.24, 0.85 + ((k * 7) % 3) * 0.12, 0.26, 0.26, 0.26, choix(r, ['#2f7d45', '#3a8f4f', '#4caf50'])));
  return out;
}

// ── Encore à gauche, plus loin : le terrain de foot

/** Le terrain de foot : à côté du terrain de basket, à la même taille, là où était la terrasse. */
export const FOOT = { x: -7.3, y: 6.4, w: 5.8, d: 8.0 };

/**
 * Le terrain de foot : une pelouse rayée de deux verts, les lignes blanches (bords, ligne médiane, rond central,
 * surfaces de réparation et de but, points), deux buts et leurs filets, les filets hauts derrière les buts, les
 * drapeaux de coin, une petite tribune en gradins, deux bancs abrités, et un ballon.
 */
export function terrainDeFoot(): V[] {
  const out: V[] = [];
  const { x: x0, y: y0, w, d } = FOOT, cx = x0 + w / 2, cy = y0 + d / 2;
  // la pelouse, bordée d'une bande plus foncée, rayée en travers
  out.push(b(x0 - 0.2, y0 - 0.9, 0, w + 0.4, d + 1.8, 0.012, '#3f8a3e'));
  for (let k = 0; k * 1.0 < d; k++) out.push(b(x0, y0 + k * 1.0, 0.012, w, Math.min(1.0, d - k), 0.008, k % 2 ? '#5fb04f' : '#6cbd5a'));
  const L = (x: number, y: number, lw: number, ld: number) => out.push(b(x, y, 0.02, lw, ld, 0.004, '#fbfbf8'));
  L(x0, y0, w, 0.06); L(x0, y0 + d - 0.06, w, 0.06); L(x0, y0, 0.06, d); L(x0 + w - 0.06, y0, 0.06, d); // les bords
  L(x0, cy - 0.03, w, 0.06); L(cx - 0.06, cy - 0.06, 0.12, 0.12); // la ligne médiane, le point central
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) L(cx + Math.cos(a) * 1.1 - 0.05, cy + Math.sin(a) * 1.1 - 0.05, 0.1, 0.1); // le rond central
  for (const [ly, s] of [[y0, 1], [y0 + d, -1]] as const) {
    const sr = 1.7, sb = 0.65; // profondeurs : surface de réparation, surface de but
    const yr = s > 0 ? ly : ly - sr, yb = s > 0 ? ly : ly - sb;
    L(cx - 1.9, yr, 0.06, sr); L(cx + 1.84, yr, 0.06, sr); L(cx - 1.9, s > 0 ? ly + sr - 0.06 : ly - sr, 3.8, 0.06); // la surface de réparation
    L(cx - 0.95, yb, 0.06, sb); L(cx + 0.89, yb, 0.06, sb); L(cx - 0.95, s > 0 ? ly + sb - 0.06 : ly - sb, 1.9, 0.06); // la surface de but
    L(cx - 0.06, ly + s * 1.15 - 0.06, 0.12, 0.12); // le point de penalty
    // le but : deux poteaux, la barre, et le filet (un quadrillage de fils fins) derrière
    const g = 0.8, h = 0.7, fond = ly - s * 0.55, yp = s > 0 ? ly - 0.07 : ly;
    out.push(b(cx - g - 0.07, yp, 0, 0.07, 0.07, h, '#fbfbf8'), b(cx + g, yp, 0, 0.07, 0.07, h, '#fbfbf8'), b(cx - g - 0.07, yp, h, 2 * g + 0.14, 0.07, 0.07, '#fbfbf8'));
    const y1 = Math.min(fond, yp), y2 = Math.max(fond, yp + 0.07);
    for (let u = -g; u <= g + 1e-6; u += 0.2) { out.push(b(cx + u, s > 0 ? fond : y2 - 0.02, 0, 0.012, 0.02, h * 0.8, '#e6ebf0'), b(cx + u, y1, h * 0.8, 0.012, y2 - y1, 0.012, '#e6ebf0')); }
    for (let z = 0.15; z < h * 0.8; z += 0.2) out.push(b(cx - g, s > 0 ? fond : y2 - 0.02, z, 2 * g, 0.012, 0.012, '#e6ebf0'));
    out.push(b(cx - g, y1, 0, 0.012, y2 - y1, h * 0.8, '#e6ebf0'), b(cx + g, y1, 0, 0.012, y2 - y1, h * 0.8, '#e6ebf0'));
    // le grand filet derrière le but, sur ses poteaux
    const yf = s > 0 ? ly - 0.85 : ly + 0.8;
    for (const px of [cx - 2.6, cx - 0.9, cx + 0.9, cx + 2.6]) out.push(b(px - 0.04, yf, 0, 0.08, 0.08, 1.7, '#7d848c'));
    out.push(b(cx - 2.6, yf + 0.03, 0.15, 5.2, 0.01, 1.5, '#cfd6dc'), b(cx - 2.6, yf, 1.65, 5.2, 0.06, 0.05, '#7d848c'));
  }
  // les drapeaux de coin
  for (const [px, py] of [[x0, y0], [x0 + w, y0], [x0, y0 + d], [x0 + w, y0 + d]]) out.push(b(px - 0.02, py - 0.02, 0, 0.04, 0.04, 0.55, '#f4f1ea'), b(px, py - 0.02, 0.42, 0.2, 0.02, 0.13, '#f2c94c'));
  // le ballon, près du point de penalty du bas
  out.push(b(cx + 0.35, y0 + d - 1.6, 0.02, 0.18, 0.18, 0.18, '#fbfbf8'), b(cx + 0.4, y0 + d - 1.42, 0.08, 0.07, 0.01, 0.06, '#1d1b2e'), b(cx + 0.53, y0 + d - 1.5, 0.06, 0.01, 0.06, 0.06, '#1d1b2e'));
  return out;
}

// ── Sous l'île : le dessous, comme celui des petites îles

/**
 * Le dessous de la grande île : une montagne renversée, en colonnes de terre et de roche qui s'enfoncent plus ou moins
 * (plus profond vers le milieu, avec du hasard : pas un cône parfait), découpées en couches — latérite rouge, latérite
 * sombre, roche grise, roche foncée tout en bas —, quelques pointes rocheuses qui pendent, des racines près des bords.
 * Des colonnes de 2,4 cases : peu de blocs pour beaucoup de volume. Rien ne dépasse du contour de l'île (la cascade
 * tombe le long du bord, devant, sans rien toucher).
 */
export const DESSUS_DU_DESSOUS = -1.6;
export function dessous(r: () => number): V[] {
  const out: V[] = [], pas = 2.4, z0 = DESSUS_DU_DESSOUS;
  const bandes: [number, string][] = [[-3.4, '#a9502f'], [-5.6, '#8a4128'], [-8.4, '#6b665f'], [-99, '#4f4a44']];
  // le sommet (renversé) n'est pas au centre exact : un peu vers le bâtiment
  const cx = ILE.x + ILE.w * 0.55, cy = ILE.y + ILE.d * 0.48;
  const nx = Math.ceil(ILE.w / pas), ny = Math.ceil(ILE.d / pas);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = ILE.x + i * pas, y = ILE.y + j * pas, w = Math.min(pas, ILE.x + ILE.w - x), d = Math.min(pas, ILE.y + ILE.d - y);
    const mx = x + w / 2, my = y + d / 2;
    const rho = Math.hypot((mx - cx) / (ILE.w * 0.5), (my - cy) / (ILE.d * 0.5));
    if (rho > 1.05) continue; // les coins : la latérite du bord suffit
    const bosse = 0.8 + 0.25 * Math.sin(mx * 0.35) * Math.cos(my * 0.42) + r() * 0.35;
    const prof = Math.max(0.4, 13 * Math.pow(Math.max(0, 1 - rho), 0.7) * bosse);
    // la colonne, en couches
    let haut = z0;
    for (const [bas, c] of bandes) {
      const zb = Math.max(z0 - prof, bas);
      if (zb < haut) { out.push(b(x, y, zb, w, d, haut - zb, c)); haut = zb; }
      if (haut <= z0 - prof) break;
    }
    // une pointe rocheuse qui pend, ici et là
    if (rho < 0.7 && r() < 0.06) {
      let z = z0 - prof, t = pas * 0.6;
      for (let k = 0; k < 3; k++) { const h = 0.7 + r() * 0.6; out.push(b(mx - t / 2, my - t / 2, z - h, t, t, h, k < 1 ? '#6b665f' : '#4f4a44')); z -= h; t *= 0.6; }
    }
    // des racines, près des bords
    if (rho > 0.75 && r() < 0.35) { const h = 0.4 + r() * 1.1; out.push(b(x + r() * (w - 0.1), y + r() * (d - 0.1), z0 - h, 0.05, 0.05, h, '#4a2c1a')); }
  }
  return out;
}

