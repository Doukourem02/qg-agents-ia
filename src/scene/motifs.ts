import * as THREE from 'three';
import type { Motif } from '@/data/layout';

// Les images dessinées sur l'objet typique de chaque pôle, en pixel art (petite toile agrandie sans lissage).

const W = 64, H = 32;
type G = CanvasRenderingContext2D;
const r = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

/** Une petite police de 5 × 7 pixels, pour les quelques mots écrits sur les murs (ON AIR, ACCUEIL). */
const LETTRES: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
};
/** Écrit un mot centré, en pixels (`k` : la taille d'un pixel de la police, `kx` : en largeur). */
function mot(g: G, texte: string, y: number, c: string, k = 2, kx = k) {
  const l = texte.length * 6 - 1, x0 = Math.round((W - l * kx) / 2);
  [...texte].forEach((ch, i) => (LETTRES[ch] ?? []).forEach((ligne, j) => [...ligne].forEach((p, x) => { if (p === '#') r(g, x0 + (i * 6 + x) * kx, y + j * k, kx, k, c); })));
}

/** Une petite police de 3 × 5 pixels (minuscules et signes), pour les affiches de l'Atelier et du Pôle Code. */
const PETITES: Record<string, string[]> = {
  a: ['...', '.##', '#.#', '#.#', '.##'], c: ['...', '###', '#..', '#..', '###'], d: ['..#', '..#', '###', '#.#', '###'],
  e: ['.#.', '#.#', '###', '#..', '.##'], f: ['.##', '#..', '##.', '#..', '#..'], g: ['###', '#.#', '###', '..#', '##.'],
  h: ['#..', '#..', '###', '#.#', '#.#'], i: ['.#.', '...', '.#.', '.#.', '.#.'], j: ['..#', '...', '..#', '#.#', '.#.'],
  l: ['##.', '.#.', '.#.', '.#.', '###'], m: ['...', '###', '###', '#.#', '#.#'], n: ['...', '##.', '#.#', '#.#', '#.#'],
  o: ['...', '###', '#.#', '#.#', '###'], q: ['###', '#.#', '###', '..#', '..#'], r: ['...', '#.#', '##.', '#..', '#..'],
  s: ['.##', '#..', '.#.', '..#', '##.'], t: ['.#.', '###', '.#.', '.#.', '.##'], u: ['...', '#.#', '#.#', '#.#', '###'],
  w: ['...', '#.#', '#.#', '###', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'], S: ['###', '#..', '###', '..#', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '-': ['...', '...', '###', '...', '...'],
  ',': ['...', '...', '...', '.#.', '#..'], '!': ['.#.', '.#.', '.#.', '...', '.#.'], ':': ['...', '.#.', '...', '.#.', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], '/': ['..#', '..#', '.#.', '#..', '#..'],
  '{': ['.##', '.#.', '#..', '.#.', '.##'], '}': ['##.', '.#.', '..#', '.#.', '##.'], '$': ['.##', '##.', '.#.', '.##', '##.'],
  '"': ['#.#', '#.#', '...', '...', '...'], ' ': ['...', '...', '...', '...', '...'],
};
/**
 * Écrit un texte en petite police, centré en `cx` (milieu de l'image par défaut), les lettres hautes de `h` pixels.
 * `sx` : l'étirement horizontal de l'image sur sa face (largeur affichée / hauteur affichée / 2) : on le compense pour
 * que les lettres ne soient ni écrasées ni étirées.
 */
function ecrit(g: G, texte: string, y: number, c: string, h: number, sx: number, cx = W / 2) {
  const k = h / 5, kx = k / sx, l = (texte.length * 4 - 1) * kx;
  [...texte].forEach((ch, i) => (PETITES[ch] ?? []).forEach((ligne, j) => [...ligne].forEach((p, x) => { if (p === '#') r(g, cx - l / 2 + (i * 4 + x) * kx, y + j * k, kx, k, c); })));
}
/** Un hexagone (le logo de Node.js), en contour, sur une face carrée (sx = 0,5). */
function hexagone(g: G, cx: number, cy: number, rayon: number, c: string, ep = 1.6) {
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    const k = Math.cos(Math.PI / 6) / Math.cos(((a % (Math.PI / 3)) - Math.PI / 6));
    for (let e = 0; e < ep; e += 0.5) { const rr = rayon * k - e; r(g, cx + Math.sin(a) * rr * 2, cy - Math.cos(a) * rr, 2, 1, c); }
  }
}

/** Un pictogramme de porte de toilettes (homme, ou femme en robe), sur une plaque blanche carrée. */
function personnage(g: G, c: string, robe: boolean) {
  const p = (x: number, y: number, w: number, h: number) => r(g, x * 2, y, w * 2, h, c);
  r(g, 0, 0, W, H, '#ffffff');
  p(14, 3, 4, 1); p(13, 4, 6, 4); p(14, 8, 4, 1); // la tête
  if (!robe) {
    p(11, 10, 10, 10); p(9, 10, 2, 9); p(21, 10, 2, 9); // le buste, les bras
    p(12, 20, 3, 9); p(17, 20, 3, 9); // les jambes
  } else {
    for (let y = 10; y < 23; y++) { const l = 5 + Math.floor((y - 10) / 2); p(16 - l, y, 2 * l, 1); } // la robe
    p(9, 10, 2, 7); p(21, 10, 2, 7); // les bras
    p(13, 23, 2, 6); p(17, 23, 2, 6); // les jambes
  }
}

const DESSINS: Record<Motif, (g: G) => void> = {
  // Box & pause : la télé allumée sur un jeu de plateforme (un petit robot du QG, des pièces, un ennemi, le score)
  jeu: g => {
    r(g, 0, 0, W, H, '#1f2a6b'); r(g, 0, 14, W, 8, '#2d3c8f');
    [[6, 3], [19, 6], [33, 2], [47, 5], [58, 3], [26, 9]].forEach(([x, y]) => r(g, x, y, 1, 1, '#ffffff'));
    r(g, 50, 4, 5, 5, '#ffe28a');
    r(g, 0, 26, W, 6, '#7a4a2a'); r(g, 0, 25, W, 2, '#3dbb5a');
    for (let x = 0; x < W; x += 8) r(g, x, 28, 1, 4, '#5e361c');
    r(g, 36, 17, 14, 3, '#c97a3a'); r(g, 36, 17, 14, 1, '#e8a05a');
    [[38, 13], [42, 13], [46, 13], [16, 15], [20, 13]].forEach(([x, y]) => { r(g, x, y, 2, 2, '#ffd23f'); r(g, x, y, 1, 1, '#fff3a8'); });
    r(g, 10, 18, 6, 7, '#3fc6e8'); r(g, 11, 19, 4, 2, '#0d1117'); r(g, 12, 19, 1, 1, '#3dff8a'); r(g, 14, 19, 1, 1, '#3dff8a');
    r(g, 10, 25, 2, 1, '#1d1b2e'); r(g, 14, 25, 2, 1, '#1d1b2e'); r(g, 13, 16, 1, 2, '#ff6fa8');
    r(g, 54, 21, 6, 4, '#9b5de5'); r(g, 55, 20, 4, 1, '#9b5de5'); r(g, 55, 22, 1, 1, '#ffffff'); r(g, 58, 22, 1, 1, '#ffffff');
    r(g, 2, 2, 3, 3, '#ff6fa8'); r(g, 6, 2, 3, 3, '#ff6fa8'); r(g, 10, 2, 3, 3, '#ff6fa8');
    for (let i = 0; i < 5; i++) r(g, 42 + i * 4, 2, 3, 4, '#ffffff');
  },
  // Box & pause : la borne d'arcade, une course rétro au coucher du soleil
  arcade: g => {
    r(g, 0, 0, W, H, '#14082e'); r(g, 0, 10, W, 4, '#3a1460');
    r(g, 24, 4, 16, 8, '#ff7a3d'); r(g, 24, 7, 16, 1, '#14082e'); r(g, 24, 10, 16, 1, '#14082e');
    r(g, 0, 14, W, 18, '#1a0f3a');
    for (let i = 0; i < 6; i++) { const y = 14 + i * 3; r(g, 0, y, W, 1, '#ff3ca6'); }
    for (let i = 0; i < 9; i++) { const x = 32 + (i - 4) * 8; r(g, Math.round((x + 32) / 2), 14, 1, 18, '#ff3ca6'); }
    r(g, 26, 22, 12, 6, '#3fc6e8'); r(g, 28, 20, 8, 3, '#2a8fb0'); r(g, 26, 27, 3, 2, '#0d1117'); r(g, 35, 27, 3, 2, '#0d1117');
    r(g, 27, 23, 2, 1, '#ffe28a'); r(g, 35, 23, 2, 1, '#ffe28a');
  },
  // Pôle Code : un terminal, des lignes de code vertes et blanches, un curseur
  terminal: g => {
    r(g, 0, 0, W, H, '#0d1117');
    r(g, 0, 0, W, 3, '#2a2f3a'); r(g, 2, 1, 1, 1, '#ff5f57'); r(g, 4, 1, 1, 1, '#febc2e'); r(g, 6, 1, 1, 1, '#28c840');
    const lignes = [[3, 18, '#3dff8a'], [5, 30, '#c9d1d9'], [5, 22, '#79c0ff'], [3, 26, '#3dff8a'], [7, 16, '#c9d1d9'], [5, 34, '#d2a8ff']] as const;
    lignes.forEach(([x, w, c], i) => r(g, x, 6 + i * 4, w, 2, c));
    r(g, 3, 29, 2, 2, '#3dff8a'); r(g, 6, 29, 3, 2, '#3dff8a');
  },
  // Communication : un téléphone sur LinkedIn, avec un post et son visuel
  linkedin: g => {
    r(g, 0, 0, W, H, '#1d1b2e');
    r(g, 2, 2, W - 4, H - 4, '#f3f2ef');
    r(g, 2, 2, W - 4, 6, '#0a66c2');
    r(g, 5, 3, 4, 4, '#ffffff'); r(g, 6, 4, 1, 2, '#0a66c2'); r(g, 7, 5, 1, 1, '#0a66c2');
    r(g, 5, 11, 5, 5, '#e98bb2'); r(g, 12, 12, 20, 2, '#1d1b2e'); r(g, 12, 15, 14, 1, '#9aa0a8');
    r(g, 5, 19, 54, 8, '#9ad7ff'); r(g, 22, 21, 18, 4, '#ffffff');
    r(g, 40, 12, 18, 4, '#0a66c2');
  },
  // Direction : l'organigramme, le CEO en haut puis les trois pôles
  organigramme: g => {
    r(g, 0, 0, W, H, '#f4f1ea');
    r(g, 25, 3, 14, 6, '#e0a42a');
    r(g, 31, 9, 2, 4, '#1d1b2e'); r(g, 10, 13, 44, 1, '#1d1b2e');
    [[10, '#4f86e8'], [32, '#e0753f'], [54, '#3fae6a']].forEach(([x, c]) => {
      r(g, (x as number), 13, 1, 4, '#1d1b2e');
      r(g, (x as number) - 6, 17, 12, 6, c as string);
      r(g, (x as number) - 4, 25, 8, 3, '#d9d6cc');
    });
  },
  // Mac & Outils : la jauge du disque
  disque: g => {
    r(g, 0, 0, W, H, '#1d1b2e');
    r(g, 4, 5, 22, 3, '#c9d1d9');
    r(g, 4, 13, W - 8, 8, '#2a2f3a');
    r(g, 4, 13, 26, 8, '#4f86e8'); r(g, 30, 13, 12, 8, '#e0a42a'); r(g, 42, 13, 6, 8, '#d64545');
    r(g, 4, 25, 10, 3, '#4f86e8'); r(g, 18, 25, 10, 3, '#e0a42a'); r(g, 32, 25, 10, 3, '#d64545'); r(g, 48, 25, 12, 3, '#3dff8a');
  },
  // Atelier : le tableau des tâches, des cartes de couleur dans trois colonnes, sans aucun nom
  kanban: g => {
    r(g, 0, 0, W, H, '#f4f1ea');
    const cols = [['#9aa0a8', 4], ['#e0a42a', 24], ['#3fae6a', 44]] as const;
    const cartes = ['#f2cf6b', '#7fd6c4', '#f29a9a', '#9ab8f2', '#c7a6f2'];
    cols.forEach(([c, x], i) => {
      r(g, x, 3, 16, 3, c);
      for (let k = 0; k < 4 - i; k++) r(g, x + 1, 8 + k * 6, 14, 4, cartes[(i * 2 + k) % cartes.length]);
    });
  },
  // Bureau des accords : accord (vert) ou refus (rouge)
  accord: g => {
    r(g, 0, 0, W, H, '#f4f1ea');
    r(g, 4, 4, 26, 24, '#3dbb5a');
    [[10, 16], [12, 18], [14, 20], [16, 18], [18, 16], [20, 14], [22, 12], [24, 10]].forEach(([x, y]) => r(g, x, y, 3, 3, '#ffffff'));
    r(g, 34, 4, 26, 24, '#d64545');
    for (let i = 0; i < 14; i++) { r(g, 40 + i, 9 + i, 3, 3, '#ffffff'); r(g, 53 - i, 9 + i, 3, 3, '#ffffff'); }
  },
  // Les façades des meubles bas : deux colonnes de tiroirs, chacun avec sa poignée, un joint sombre entre eux
  tiroirs: g => {
    r(g, 0, 0, W, H, '#f4f1ea');
    for (const x of [1, 33]) for (const y of [1, 11, 21]) { r(g, x, y, 30, 9, '#fbf8f2'); r(g, x + 11, y + 4, 8, 1, '#8a8f99'); }
    r(g, 31, 0, 2, H, '#d9d4c8');
  },
  // Les portes d'un placard haut : deux battants, deux poignées verticales au milieu
  placard: g => {
    r(g, 0, 0, W, H, '#e9e3d6');
    r(g, 1, 1, 30, H - 2, '#f6f2ea'); r(g, 33, 1, 30, H - 2, '#f6f2ea');
    r(g, 28, 10, 1, 12, '#8a8f99'); r(g, 35, 10, 1, 12, '#8a8f99');
  },
  // Les toilettes : les pictogrammes Homme et Femme des portes. La plaque est carrée : on dessine sur une grille de
  // 32 × 32, chaque colonne en vaut deux de l'image (64 × 32), pour que le personnage ne soit pas écrasé.
  homme: g => personnage(g, '#2f6fd6', false),
  femme: g => personnage(g, '#d6247a', true),
  // Mac & Outils : le panneau perforé de l'établi, les outils accrochés (marteau, clés, tournevis, pince, mètre)
  outils: g => {
    r(g, 0, 0, W, H, '#d8c29a');
    for (let x = 3; x < W; x += 4) for (let y = 3; y < H; y += 4) r(g, x, y, 1, 1, '#b39a6e');
    r(g, 5, 5, 2, 16, '#7a4a2a'); r(g, 2, 4, 8, 4, '#5b6275'); // le marteau
    r(g, 14, 6, 2, 14, '#9aa0a8'); r(g, 13, 4, 4, 3, '#9aa0a8'); r(g, 19, 6, 2, 11, '#9aa0a8'); r(g, 18, 4, 4, 3, '#9aa0a8'); // deux clés
    r(g, 27, 4, 2, 7, '#c94a4a'); r(g, 27.5, 11, 1, 10, '#c9ccd3'); // le tournevis
    r(g, 34, 5, 2, 9, '#2f6fd6'); r(g, 38, 5, 2, 9, '#2f6fd6'); r(g, 35, 14, 4, 6, '#9aa0a8'); // la pince
    r(g, 46, 6, 10, 10, '#f2c94c'); r(g, 49, 9, 4, 4, '#1d1b2e'); // le mètre
    r(g, 2, 24, 60, 5, '#a8744a'); r(g, 6, 22, 6, 2, '#3d9c5a'); r(g, 20, 22, 8, 2, '#e0753f'); r(g, 40, 22, 5, 2, '#5ab0c9'); // l'étagère et ses boîtes
  },
  // Le studio : l'enseigne ON AIR éteinte (grise, sans éclat) et allumée (rouge, lettres blanches)
  onair: g => { r(g, 0, 0, W, H, '#2a2a36'); r(g, 1, 1, W - 2, H - 2, '#33333f'); mot(g, 'ON AIR', 9, '#5b6275', 2, 1); },
  'onair-allume': g => { r(g, 0, 0, W, H, '#b51f1f'); r(g, 1, 1, W - 2, H - 2, '#e03030'); mot(g, 'ON AIR', 9, '#ffffff', 2, 1); },
  // L'accueil : le panneau sur le guichet
  accueil: g => { r(g, 0, 0, W, H, '#1d1b2e'); mot(g, 'ACCUEIL', 8, '#f2c94c', 2, 1.4); r(g, 4, 25, W - 8, 1, '#c9a14e'); },
  // La salle de réunion : l'écran au repos, le logo du QG (rien d'autre : la salle n'affiche pas de faux chiffres)
  veille: g => { r(g, 0, 0, W, H, '#14141c'); r(g, 22, 14, 3, 3, '#3dbb5a'); mot(g, 'QG', 9, '#7a8098', 2, 1); },
  // Le tableau blanc de la salle de réunion : un schéma au feutre, des cases et des flèches, sans aucun mot
  schema: g => {
    r(g, 0, 0, W, H, '#fbfbf8');
    const cadre = (x: number, y: number, w: number, h: number, c: string) => { r(g, x, y, w, 1, c); r(g, x, y + h - 1, w, 1, c); r(g, x, y, 1, h, c); r(g, x + w - 1, y, 1, h, c); };
    cadre(4, 5, 14, 9, '#2f6fd6'); cadre(25, 5, 14, 9, '#2f6fd6'); cadre(46, 5, 14, 9, '#2f6fd6'); cadre(25, 20, 14, 8, '#d64545');
    r(g, 18, 9, 7, 1, '#1d1b2e'); r(g, 39, 9, 7, 1, '#1d1b2e'); r(g, 32, 14, 1, 6, '#1d1b2e'); // les flèches
    r(g, 23, 8, 1, 3, '#1d1b2e'); r(g, 44, 8, 1, 3, '#1d1b2e'); r(g, 31, 18, 3, 1, '#1d1b2e');
  },
  // Le tableau noir de la Communication : des croquis à la craie (une ampoule, des cadres de post, des flèches), sans
  // chiffre ni texte inventés. La face est presque carrée : chaque colonne dessinée en vaut deux.
  craie: g => {
    const p = (x: number, y: number, w: number, h: number, c: string) => r(g, x * 2, y, w * 2, h, c);
    r(g, 0, 0, W, H, '#22302a'); r(g, 0, 0, W, 1, '#8a5a34'); r(g, 0, H - 1, W, 1, '#8a5a34');
    p(4, 4, 6, 1, '#f4f1ea'); p(3, 5, 1, 5, '#f4f1ea'); p(10, 5, 1, 5, '#f4f1ea'); p(4, 10, 6, 1, '#f4f1ea'); p(5, 11, 4, 2, '#e8d9a0'); // l'ampoule
    p(1, 6, 1, 1, '#f2c94c'); p(12, 6, 1, 1, '#f2c94c'); p(6, 2, 1, 1, '#f2c94c');
    p(16, 4, 12, 10, '#f4f1ea'); p(17, 5, 10, 5, '#22302a'); p(17, 11, 7, 1, '#22302a'); // un cadre de post
    p(16, 18, 12, 10, '#f4f1ea'); p(17, 19, 10, 5, '#22302a'); p(17, 25, 5, 1, '#22302a');
    p(11, 20, 4, 1, '#9ad7ff'); p(14, 19, 1, 3, '#9ad7ff'); // une flèche vers le second
    p(4, 22, 6, 1, '#f7a1c4'); p(4, 25, 4, 1, '#f7a1c4'); p(4, 28, 7, 1, '#f7a1c4'); // des traits de liste, sans mots
  },
  // ── Les affiches « geek » des murs (des décorations : aucune donnée). Chaque face a sa forme ; `sx` compense.
  'affiche-js': g => { r(g, 0, 0, W, H, '#f7df1e'); ecrit(g, 'JS', 15, '#1d1b2e', 13, 0.5, 44); },
  'affiche-node': g => { r(g, 0, 0, W, H, '#1d1b2e'); hexagone(g, 32, 16, 13, '#68a063'); ecrit(g, 'node', 13, '#8cc84b', 6, 0.5); },
  'affiche-hello': g => { r(g, 0, 0, W, H, '#0d1117'); r(g, 0, 0, W, 3, '#2a2f3a'); r(g, 2, 1, 1, 1, '#ff5f57'); r(g, 4, 1, 1, 1, '#febc2e'); r(g, 6, 1, 1, 1, '#28c840'); ecrit(g, 'hello, world!', 12, '#3dff8a', 9, 1.53); },
  'affiche-git': g => { r(g, 0, 0, W, H, '#f05033'); ecrit(g, '$ git commit -m', 9, '#ffffff', 7, 1.75); ecrit(g, '"..."', 20, '#ffe1d6', 5, 1.75); },
  'affiche-accolades': g => { r(g, 0, 0, W, H, '#7a4fc4'); ecrit(g, '{}', 8, '#ffffff', 16, 0.34); },
  'affiche-cafe': g => {
    r(g, 0, 0, W, H, '#f3e6cc');
    r(g, 6, 12, 12, 11, '#6b4226'); r(g, 18, 14, 3, 6, '#6b4226'); r(g, 8, 13, 8, 2, '#a8744a'); r(g, 9, 6, 1, 4, '#c9b9a0'); r(g, 13, 5, 1, 5, '#c9b9a0'); // la tasse fumante
    r(g, 25, 17, 9, 2, '#1d1b2e'); r(g, 32, 15, 2, 6, '#1d1b2e'); // la flèche
    ecrit(g, 'code', 13, '#2f6fd6', 9, 0.84, 50);
  },
  'affiche-code': g => { r(g, 0, 0, W, H, '#1d1b2e'); ecrit(g, '</>', 7, '#5ab0f0', 18, 1.0); },
  'affiche-404': g => { r(g, 0, 0, W, H, '#f4f1ea'); ecrit(g, '404', 5, '#d64545', 13, 0.46); ecrit(g, 'not found', 23, '#1d1b2e', 4, 0.46); },
  'affiche-wq': g => { r(g, 0, 0, W, H, '#1f3a2a'); ecrit(g, ':wq', 9, '#9be08f', 14, 0.61); },
  // L'atelier : le chevalet et sa grande feuille, un croquis au feutre (des formes et des flèches, aucun mot)
  croquis: g => {
    r(g, 0, 0, W, H, '#fbfbf8');
    const p = (x: number, y: number, w: number, h: number, c: string) => r(g, x * 2, y, w * 2, h, c);
    p(3, 5, 10, 1, '#1d1b2e'); p(3, 5, 1, 9, '#1d1b2e'); p(12, 5, 1, 9, '#1d1b2e'); p(3, 13, 10, 1, '#1d1b2e'); p(4, 2, 8, 3, '#e05a5a'); // une maison
    p(16, 7, 6, 1, '#2f6fd6'); p(21, 6, 1, 3, '#2f6fd6'); // une flèche
    p(24, 4, 5, 5, '#3d9c5a'); p(25, 16, 3, 3, '#f2c94c'); p(14, 20, 12, 1, '#1d1b2e'); p(14, 24, 8, 1, '#1d1b2e'); // des formes, des traits
  },
  // Les casiers du couloir : des portes à fentes d'aération et à poignée
  casiers: g => {
    r(g, 0, 0, W, H, '#4a78c0');
    for (let i = 0; i < 4; i++) {
      const x = 1 + i * 16;
      r(g, x, 1, 14, H - 2, '#5b8fd6');
      for (let k = 0; k < 3; k++) r(g, x + 3, 4 + k * 2, 8, 1, '#3a66a8');
      r(g, x + 11, 16, 1, 4, '#d9dbe0');
    }
  },
  // L'entrée : l'enseigne « ● QG », comme le logo de la page (le point vert, puis Q et G en pixels)
  enseigne: g => {
    r(g, 0, 0, W, H, '#1d1b2e');
    r(g, 1, 1, W - 2, 1, '#3a3f55'); r(g, 1, H - 2, W - 2, 1, '#3a3f55');
    r(g, 13, 14, 4, 4, '#3dbb5a');
    const lettres = [
      ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
      ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    ];
    lettres.forEach((l, i) => l.forEach((ligne, y) => [...ligne].forEach((c, x) => { if (c === '#') r(g, 22 + i * 14 + x * 2, 9 + y * 2, 2, 2, '#fbf4e4'); })));
  },
};

const cache = new Map<Motif, THREE.CanvasTexture>();
export function motifTexture(m: Motif): THREE.Texture {
  let t = cache.get(m);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    DESSINS[m](c.getContext('2d')!);
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(m, t);
  }
  return t;
}
