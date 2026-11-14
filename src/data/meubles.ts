import type { Box, Pt } from './layout';

// Les meubles en pièces fines, aux proportions d'un vrai bureau (un personnage fait ≈ 1,1 de haut : une table 0,42,
// une assise 0,24, un frigo 1,2). Chaque fonction rend la liste des blocs du meuble ; ils sont tous dessinés d'un seul
// coup (src/scene/Blocs.tsx), si bien qu'un meuble en douze pièces ne coûte pas plus qu'un cube.
// `vers` : le côté vers lequel on est tourné quand on s'assoit (le dossier est à l'opposé), ou la face avant d'un meuble.

export type Cote = 'N' | 'S' | 'E' | 'W';
const b = (x: number, y: number, z: number, w: number, d: number, h: number, c: string, o: Partial<Box> = {}): Box => ({ x, y, z, w, d, h, c, ...o });
const cyl = (cx: number, cy: number, z: number, diam: number, h: number, c: string, o: Partial<Box> = {}): Box =>
  b(cx - diam / 2, cy - diam / 2, z, diam, diam, h, c, { forme: 'cylindre', ...o });
const DIR: Record<Cote, Pt> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Vers où regarde chaque chaise posée (son centre, son côté) : un personnage assis là regarde du même côté (Agents.tsx). */
export const CHAISES: { x: number; y: number; vers: Cote }[] = [];

/** Un tirage fixe d'après une position : deux meubles identiques ne le sont jamais tout à fait. */
function hasard(x: number, y: number) {
  let s = (Math.floor(x * 97) * 73856093) ^ (Math.floor(y * 89) * 19349663);
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Une table : un plateau fin et quatre pieds en retrait. */
export function table(x: number, y: number, w: number, d: number, o: { h?: number; c?: string; pieds?: string; bloque?: boolean } = {}): Box[] {
  const h = o.h ?? 0.42, p = o.pieds ?? '#8a8f99', e = 0.05;
  return [
    b(x, y, h - e, w, d, e, o.c ?? '#f4f1ea', { bloque: o.bloque ?? true }),
    ...[[x + 0.04, y + 0.04], [x + w - 0.04 - e, y + 0.04], [x + 0.04, y + d - 0.04 - e], [x + w - 0.04 - e, y + d - 0.04 - e]].map(([px, py]) => b(px, py, 0, e, e, h - e, p)),
  ];
}

/** Une table ronde : un plateau rond, un pied central, une base ronde. */
export function tableRonde(cx: number, cy: number, o: { diam?: number; h?: number; c?: string; pied?: string } = {}): Box[] {
  const diam = o.diam ?? 0.9, h = o.h ?? 0.42, p = o.pied ?? '#3a3f55';
  return [
    cyl(cx, cy, h - 0.05, diam, 0.05, o.c ?? '#f4f1ea', { bloque: true }),
    cyl(cx, cy, 0.03, 0.08, h - 0.08, p),
    cyl(cx, cy, 0, diam * 0.45, 0.03, p),
  ];
}

/** Une chaise : quatre pieds fins, une assise, un dossier à l'opposé de `vers`. */
export function chaise(cx: number, cy: number, vers: Cote, c = '#3a3f55', assise = c): Box[] {
  CHAISES.push({ x: cx, y: cy, vers });
  const t = 0.38, e = 0.04, z = 0.22, x = cx - t / 2, y = cy - t / 2;
  const [dx, dy] = DIR[vers];
  const out = [
    ...[[x, y], [x + t - e, y], [x, y + t - e], [x + t - e, y + t - e]].map(([px, py]) => b(px, py, 0, e, e, z, c)),
    b(x, y, z, t, t, 0.05, assise),
  ];
  // le dossier, du côté opposé à `vers`
  if (dx) out.push(b(dx > 0 ? x : x + t - e, y, z + 0.05, e, t, 0.3, c));
  else out.push(b(x, dy > 0 ? y : y + t - e, z + 0.05, t, e, 0.3, c));
  return out;
}

/** Une chaise de bureau : la base en étoile, la colonne, l'assise rembourrée, le dossier. */
export function chaiseDeBureau(cx: number, cy: number, vers: Cote, c = '#2a2a36', tissu = '#3b3f52'): Box[] {
  CHAISES.push({ x: cx, y: cy, vers });
  const t = 0.4, x = cx - t / 2, y = cy - t / 2;
  const [dx, dy] = DIR[vers];
  const out = [
    b(cx - 0.2, cy - 0.025, 0.02, 0.4, 0.05, 0.03, c), b(cx - 0.025, cy - 0.2, 0.02, 0.05, 0.4, 0.03, c), // l'étoile
    cyl(cx, cy, 0.05, 0.06, 0.15, c), // la colonne
    b(x, y, 0.2, t, t, 0.07, tissu),
  ];
  if (dx) out.push(b(dx > 0 ? x : x + t - 0.06, y + 0.03, 0.3, 0.06, t - 0.06, 0.3, tissu));
  else out.push(b(x + 0.03, dy > 0 ? y : y + t - 0.06, 0.3, t - 0.06, 0.06, 0.3, tissu));
  return out;
}

/** Un tabouret : une assise ronde, un pied, une base ronde. */
export function tabouret(cx: number, cy: number, c = '#3a3f55', assise = '#c9a27a', h = 0.3): Box[] {
  return [cyl(cx, cy, h - 0.05, 0.32, 0.05, assise), cyl(cx, cy, 0.03, 0.05, h - 0.08, c), cyl(cx, cy, 0, 0.26, 0.03, c)];
}

/** Un canapé : le socle, le dossier (à l'opposé de `vers`), deux accoudoirs, des coussins un peu plus clairs. */
export function canape(x: number, y: number, w: number, d: number, vers: Cote, c: string, coussin: string): Box[] {
  const long = vers === 'N' || vers === 'S' ? w : d, ep = 0.2, acc = 0.15;
  const out = [b(x, y, 0.06, w, d, 0.16, c, { bloque: true })]; // on ne traverse pas un canapé
  for (const [px, py] of [[x, y], [x + w - 0.05, y], [x, y + d - 0.05], [x + w - 0.05, y + d - 0.05]]) out.push(b(px, py, 0, 0.05, 0.05, 0.06, '#2a2a36'));
  const [dx, dy] = DIR[vers];
  if (dy) {
    out.push(b(x, dy > 0 ? y : y + d - ep, 0.22, w, ep, 0.3, c)); // le dossier
    out.push(b(x, y, 0.22, acc, d, 0.14, c), b(x + w - acc, y, 0.22, acc, d, 0.14, c)); // les accoudoirs
  } else {
    out.push(b(dx > 0 ? x : x + w - ep, y, 0.22, ep, d, 0.3, c));
    out.push(b(x, y, 0.22, w, acc, 0.14, c), b(x, y + d - acc, 0.22, w, acc, 0.14, c));
  }
  // les coussins de l'assise, séparés par un petit joint
  const n = Math.max(1, Math.round((long - 2 * acc) / 0.6)), l = (long - 2 * acc) / n;
  for (let i = 0; i < n; i++) {
    if (dy) out.push(b(x + acc + i * l + 0.015, dy > 0 ? y + ep : y + 0.02, 0.22, l - 0.03, d - ep - 0.02, 0.07, coussin));
    else out.push(b(dx > 0 ? x + ep : x + 0.02, y + acc + i * l + 0.015, 0.22, w - ep - 0.02, l - 0.03, 0.07, coussin));
  }
  return out;
}

const LIVRES = ['#c94a4a', '#2f6fd6', '#e8b04a', '#3d9c5a', '#7a4fc4', '#f4f1ea', '#e0753f', '#1d1b2e', '#5ab0c9'];
/**
 * Une étagère ouverte vers `vers` ('S' : face de gauche, 'E' : face de droite) : les montants, les tablettes, et des
 * livres de largeurs, de hauteurs et de couleurs variées, quelques-uns penchés ou couchés.
 */
export function etagere(x: number, y: number, w: number, d: number, h: number, vers: 'S' | 'E', c = '#8a5a34'): Box[] {
  const r = hasard(x, y), e = 0.04, niveaux = Math.max(2, Math.round(h / 0.32));
  const out: Box[] = [];
  const long = vers === 'S' ? w : d;
  // les montants et les tablettes
  if (vers === 'S') out.push(b(x, y, 0, e, d, h, c), b(x + w - e, y, 0, e, d, h, c), b(x, y, 0, w, 0.03, h, c, { bloque: true }));
  else out.push(b(x, y, 0, w, e, h, c), b(x, y + d - e, 0, w, e, h, c), b(x, y, 0, 0.03, d, h, c, { bloque: true }));
  for (let k = 0; k <= niveaux; k++) {
    const z = Math.min(h - e, (k * h) / niveaux);
    out.push(vers === 'S' ? b(x, y, z, w, d, e, c) : b(x, y, z, w, d, e, c));
  }
  for (let k = 0; k < niveaux; k++) {
    const z0 = (k * h) / niveaux + e, haut = h / niveaux - e - 0.02;
    let u = e + 0.02;
    while (u < long - e - 0.08) {
      const l = 0.05 + r() * 0.05, hh = haut * (0.6 + r() * 0.35), col = LIVRES[Math.floor(r() * LIVRES.length)];
      if (r() < 0.1) { u += 0.08; continue; } // un trou
      const prof = (vers === 'S' ? d : w) - 0.08;
      if (vers === 'S') out.push(b(x + u, y + 0.05, z0, l, prof, hh, col));
      else out.push(b(x + 0.05, y + u, z0, prof, l, hh, col));
      u += l + 0.01;
    }
  }
  return out;
}

/** Une lampe sur pied : la base ronde, la tige, l'abat-jour. */
export function lampe(cx: number, cy: number, h = 1.1, abatJour = '#f3e3b5'): Box[] {
  return [cyl(cx, cy, 0, 0.24, 0.03, '#2a2a36'), cyl(cx, cy, 0.03, 0.03, h - 0.2, '#2a2a36'), cyl(cx, cy, h - 0.2, 0.3, 0.2, abatJour)];
}

/** Une tasse posée à la hauteur `z`. */
export const tasse = (cx: number, cy: number, z: number, c = '#f4f1ea'): Box[] => [cyl(cx, cy, z, 0.07, 0.08, c)];

const FEUILLES = ['#2f7d45', '#3a8f4f', '#4caf50', '#5cbf74'];
/** Une plante en pot rond : le pot (terre cuite, terreau dessus), des feuilles en touffe, plus hautes au centre. */
export function pot(cx: number, cy: number, taille = 1, potC = '#c0643e'): Box[] {
  const r = hasard(cx, cy), d = 0.42 * taille, hp = 0.3 * taille;
  const out = [cyl(cx, cy, 0, d, hp, potC, { top: '#5a3a26' }), cyl(cx, cy, hp, d * 1.05, 0.04, potC)];
  // une touffe : un cœur haut, une couronne de feuilles qui s'écartent, d'autres plus basses qui retombent du pot
  out.push(b(cx - 0.08 * taille, cy - 0.08 * taille, hp + 0.02, 0.16 * taille, 0.16 * taille, 0.5 * taille, FEUILLES[1], { top: FEUILLES[3] }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + r() * 0.4, o = (0.13 + r() * 0.07) * taille, t = (0.13 + r() * 0.04) * taille;
    out.push(b(cx + Math.cos(a) * o - t / 2, cy + Math.sin(a) * o - t / 2, hp + (0.12 + r() * 0.12) * taille, t, t, (0.12 + r() * 0.14) * taille, FEUILLES[Math.floor(r() * FEUILLES.length)]));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r(), o = (0.24 + r() * 0.04) * taille, t = 0.11 * taille;
    out.push(b(cx + Math.cos(a) * o - t / 2, cy + Math.sin(a) * o - t / 2, hp - 0.02, t, t, 0.1 * taille, FEUILLES[Math.floor(r() * 2)]));
  }
  return out;
}

/**
 * Un écran fin sur son pied, posé à la hauteur `z` (un bureau), sa dalle tournée vers la face de gauche (+z) :
 * le pied, le cou, puis la dalle et son image (`ecran`, comme les écrans des postes).
 */
export function ecranFin(cx: number, y: number, z: number, couleur: string, o: { large?: number; haut?: number; cadre?: string; pied?: string; poste?: Pt } = {}): Box[] {
  const l = o.large ?? 0.55, h = o.haut ?? l * 0.58, pied = o.pied ?? '#2a2a36';
  return [
    b(cx - 0.11, y, z, 0.22, 0.12, 0.02, pied),
    b(cx - 0.025, y + 0.03, z + 0.02, 0.05, 0.04, 0.06, pied),
    b(cx - l / 2, y + 0.06, z + 0.06, l, 0.04, h, o.cadre ?? '#1d1b2e', { ecran: couleur, poste: o.poste }),
  ];
}
