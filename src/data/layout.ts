import { canape, chaise as chaiseFine, chaiseDeBureau, ecranFin, etagere, lampe, pot, table, tableRonde, tabouret, tasse, type Cote } from './meubles';

// Le plan du bureau, en cases, relevé sur open-space/plan-open-space.png (isométrie 2:1, 30 px par case,
// coin du fond à (1098, 218) dans l'image de 2400 × 1350). x va vers le bas à droite de l'écran, y vers le bas à gauche.

export type Pt = [number, number];
export type Side = 'N' | 'S' | 'W' | 'E';

export type Room = {
  id: string;
  nom: string;
  couleur: string; // couleur de l'étiquette et du plan du bureau
  sol?: string; // couleur du sol (absent = carrelage du couloir)
  mur?: string; // murets opaques
  vitre?: boolean; // parois vitrées
  cadre?: string; // couleur du cadre des vitres
  hauteur?: number;
  r: [number, number, number, number]; // x, y, largeur, profondeur
  portes: { cote: Side; a: number }[]; // a = case le long du mur
  /** Une seconde partie de la pièce, à côté (la salle à manger de la Cuisine) : son rectangle et ses portes. */
  annexe?: { r: [number, number, number, number]; portes: { cote: Side; a: number }[]; nom?: string; etiquette?: Pt };
  etiquette: Pt; // centre de l'étiquette, en pixels du plan (2400 × 1350) ; toujours dans la pièce (pieces.test.ts)
};

export type Box = {
  x: number; y: number; z?: number; w: number; d: number; h: number;
  c: string; top?: string; left?: string; right?: string;
  ecran?: string; vitre?: boolean; bloque?: boolean; lumieres?: boolean;
  motif?: Motif; // une image dessinée sur la face avant (l'objet typique d'un pôle)
  poste?: Pt; // l'écran d'un bureau : la place assise devant lui (il n'est allumé que si son occupant est là)
  motifFace?: 'x'; // le motif sur la face de droite (+x) au lieu de celle de gauche (+z)
  forme?: 'cylindre'; // un cylindre debout inscrit dans le pavé (tasses, pots, tables rondes, tabourets)
  /** Un voyant « occupé » (face de gauche) : rouge seulement si quelqu'un est vraiment à cette place, sinon vert. */
  voyant?: Pt;
};

/** Les objets typiques des pôles, dessinés sur la face avant d'un panneau. */
export type Motif = 'terminal' | 'linkedin' | 'organigramme' | 'disque' | 'kanban' | 'accord' | 'jeu' | 'arcade' | 'enseigne' | 'tiroirs' | 'placard' | 'homme' | 'femme' | 'outils'
  | 'onair' | 'onair-allume' | 'accueil' | 'veille' | 'schema' | 'craie' | 'casiers' | 'croquis'
  | 'affiche-js' | 'affiche-node' | 'affiche-hello' | 'affiche-git' | 'affiche-accolades' | 'affiche-cafe' | 'affiche-code' | 'affiche-404' | 'affiche-wq';

export const GRID = { w: 39, h: 30 };
/** L'île : le bâtiment et, tout autour, la cour de service (derrière), la terrasse et le terrain de basket (à gauche),
 *  le potager (à droite), le parking (devant) ; et plus loin à gauche, le terrain de foot. */
export const ILE = { x: -8, y: -6, w: 54.5, d: 42 };
export const MUR_FOND = 2.6;
/** La porte d'entrée, percée dans le mur de devant (y = GRID.h) : de x à x + w, haute de h (le haut du linteau).
 *  Les personnages entrent et sortent par elle (POI.entree, le paillasson juste derrière). */
export const PORTE = { x: 30.1, w: 2.01, h: 1.69 };
/** L'épaisseur des murs du bâtiment, tous à l'extérieur du sol (World.tsx). */
export const EPAISSEUR_MUR = 0.35;

/** Le cadrage de mes plans : image de 2400 × 1350, 30 px par case, coin du fond en (1098, 218). */
export const PLAN = { w: 2400, h: 1350, case: 30, ox: 1098, oy: 218 };
/** Un point du plan (pixels de l'image) → la case au sol correspondante. */
export function planToGrid(px: number, py: number): Pt {
  const a = (px - PLAN.ox) / PLAN.case, b = (py - PLAN.oy) / (PLAN.case / 2);
  return [(a + b) / 2, (b - a) / 2];
}

const L = (dx: number, dy: number): Pt => [dx * 1.2, dy * 1.2]; // relevés faits sur l'image affichée à 2000 px
/** Une case du sol (x, y) → le point du plan (pixels de l'image) : pour poser une étiquette au milieu d'une pièce. */
const G = (x: number, y: number): Pt => [PLAN.ox + PLAN.case * (x - y), PLAN.oy + (PLAN.case / 2) * (x + y)];

export const ROOMS: Room[] = [
  { id: 'code', nom: 'Pôle Code', couleur: '#4f86e8', sol: '#6d9cf0', mur: '#4b78d6', r: [1, 1, 9, 10], portes: [{ cote: 'S', a: 6 }, { cote: 'E', a: 7 }], etiquette: L(775, 350) },
  { id: 'direction', nom: 'Direction', couleur: '#7a8098', sol: '#f6cf5a', vitre: true, cadre: '#3a3f55', hauteur: 0.95, r: [11, 0, 9, 6], portes: [{ cote: 'S', a: 13 }, { cote: 'S', a: 18 }], etiquette: G(15.8, 5.1) },
  { id: 'mac', nom: 'Mac & Outils', couleur: '#5aa86e', sol: '#86d39a', mur: '#4f9e65', r: [22, 0, 7, 7], portes: [{ cote: 'W', a: 3 }, { cote: 'S', a: 24 }], etiquette: G(24.8, 5.0) },
  { id: 'toilettes', nom: 'Toilettes', couleur: '#9aa8c8', sol: '#e6ebf3', mur: '#aeb8cc', r: [32, 0, 7, 5], portes: [{ cote: 'S', a: 34 }, { cote: 'W', a: 3 }], etiquette: G(34.4, 3.3) },
  { id: 'pause', nom: 'Box & pause', couleur: '#d9679a', sol: '#f39ac0', mur: '#b9577f', r: [1, 12, 7, 7], portes: [{ cote: 'E', a: 15 }, { cote: 'N', a: 7 }], etiquette: G(4.6, 15.2) },
  { id: 'atelier', nom: 'Atelier des projets', couleur: '#9a86d8', sol: '#b7a6f0', mur: '#7f6cc9', r: [1, 21, 18, 8], portes: [{ cote: 'N', a: 4 }, { cote: 'N', a: 11 }], etiquette: L(360, 577) },
  { id: 'communication', nom: 'Communication', couleur: '#e0753f', sol: '#f39060', mur: '#b8653f', r: [11, 10, 12, 9], portes: [{ cote: 'N', a: 17 }, { cote: 'W', a: 14 }, { cote: 'S', a: 17 }, { cote: 'S', a: 21 }, { cote: 'E', a: 17 }], etiquette: G(14.7, 17.95) },
  // la Cuisine (identifiant « cafe », gardé pour la simulation) : vitrée, deux ouvertures ; sa salle à manger est à côté,
  // dans l'ancien espace vide sous les toilettes, vitrée elle aussi (une baie vitrée sur le jardin, côté droit)
  {
    id: 'cafe', nom: 'Cuisine', couleur: '#a87b4f', sol: '#ece7de', vitre: true, cadre: '#8a6a4a', hauteur: 0.95, r: [25, 11, 6, 6],
    portes: [{ cote: 'W', a: 12 }, { cote: 'N', a: 30 }], etiquette: G(27.9, 16.45),
    annexe: { r: [32, 6, 7, 5], portes: [{ cote: 'W', a: 10 }, { cote: 'S', a: 36 }], nom: 'Salle à manger', etiquette: G(35.4, 8.65) },
  },
  { id: 'reunion', nom: 'Salle de réunion', couleur: '#6f7690', sol: '#eef0f4', vitre: true, cadre: '#1d1b2e', hauteur: 0.95, r: [21, 21, 9, 7], portes: [{ cote: 'N', a: 25 }, { cote: 'E', a: 24 }], etiquette: G(25.6, 26.9) },
  { id: 'cabines', nom: 'Cabines téléphoniques', couleur: '#6f7690', sol: '#dfe4ee', r: [33, 12, 5, 4], portes: [], etiquette: G(37.5, 15.3) },
  { id: 'studio', nom: 'Studio de contenu', couleur: '#4a3d6e', sol: '#3b2d5a', mur: '#2b2142', r: [31, 17, 8, 6], portes: [{ cote: 'N', a: 32 }, { cote: 'W', a: 20 }], etiquette: G(36.3, 21.2) },
  { id: 'accords', nom: 'Bureau des accords', couleur: '#c9a14e', sol: '#ecca86', mur: '#b8924a', r: [32, 24, 7, 5], portes: [{ cote: 'N', a: 38 }, { cote: 'W', a: 27 }], etiquette: L(1095, 978) },
];

export const roomById = (id: string) => ROOMS.find(r => r.id === id)!;

// ───────── Le mobilier ─────────
// (les meubles en pièces fines sont dans meubles.ts)
const F: Box[] = [];
const box = (x: number, y: number, z: number, w: number, d: number, h: number, c: string, o: Partial<Box> = {}) =>
  F.push({ x, y, z, w, d, h, c, ...o });

const ECRANS = ['#f7a1c4', '#9ad7ff', '#ffd27a', '#b3a4ff', '#8fe3b0'];
let ne = 0;
/** Toutes les places assises (postes, tables, cabines) : un personnage arrêté là s'assoit (Agents.tsx). */
export const ASSISES: Pt[] = [];
/** Un tirage fixe d'après une position, pour varier les accessoires d'un poste à l'autre. */
const tirage = (x: number, y: number) => { let s = (Math.floor(x * 97) * 73856093) ^ (Math.floor(y * 89) * 19349663); return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TASSES = ['#f4f1ea', '#e0753f', '#4f86e8', '#3d9c5a', '#1d1b2e'];
/**
 * Un bureau de `places` postes, en pièces fines : le plateau, deux pieds en panneau, un caisson à tiroirs ; à chaque
 * poste un écran fin (deux pour `double`, un iMac argenté pour `imac`), le clavier, la souris, parfois une tasse ou
 * des papiers, et la chaise de bureau. La place assise est derrière l'écran (côté haut du plan), comme sur mes plans ;
 * les écrans restent bas pour qu'on voie le visage de qui est assis derrière.
 * Renvoie les places assises.
 */
function bureau(x: number, y: number, places = 2, o: { double?: boolean; imac?: boolean; bois?: boolean; chaise?: string } = {}): Pt[] {
  const r = tirage(x, y), plateau = o.bois ? '#8a5a34' : '#f4f1ea';
  box(x, y, 0.37, places, 1, 0.05, plateau, { bloque: true, top: o.bois ? '#a8744a' : undefined });
  box(x + 0.03, y + 0.08, 0, 0.05, 0.84, 0.37, o.bois ? '#6a3f22' : '#d9d4c8'); box(x + places - 0.08, y + 0.08, 0, 0.05, 0.84, 0.37, o.bois ? '#6a3f22' : '#d9d4c8'); // les pieds
  box(x + places - 0.55, y + 0.4, 0, 0.45, 0.5, 0.34, o.bois ? '#7a4a2a' : '#ece7dd', { motif: 'tiroirs' }); // le caisson
  const sieges: Pt[] = [];
  for (let i = 0; i < places; i++) {
    const siege: Pt = [x + 0.5 + i, y - 0.32], cx = x + 0.5 + i;
    if (o.double) for (const dx of [-0.19, 0.19]) F.push(...ecranFin(cx + dx, y + 0.02, 0.42, ECRANS[ne++ % ECRANS.length], { large: 0.36, haut: 0.2, poste: siege }));
    else if (o.imac) F.push(...ecranFin(cx, y + 0.02, 0.42, ECRANS[ne++ % ECRANS.length], { large: 0.48, haut: 0.24, cadre: '#d9dbe0', pied: '#c9ccd3', poste: siege }));
    else F.push(...ecranFin(cx, y + 0.02, 0.42, ECRANS[ne++ % ECRANS.length], { large: 0.46, haut: 0.22, poste: siege }));
    box(cx - 0.18, y + 0.24, 0.42, 0.36, 0.12, 0.015, '#2a2a36', { top: '#3a3f55' }); // le clavier
    box(cx + 0.24, y + 0.26, 0.42, 0.05, 0.08, 0.02, '#2a2a36'); // la souris
    if (r() < 0.6) F.push(...tasse(cx - 0.36, y + 0.62, 0.42, TASSES[Math.floor(r() * TASSES.length)]));
    if (r() < 0.4) box(cx + 0.05, y + 0.55, 0.42, 0.3, 0.22, 0.012, '#ffffff'); // des papiers
    F.push(...chaiseDeBureau(cx, siege[1], 'S', '#2a2a36', o.chaise ?? '#3b3f52'));
    sieges.push(siege); ASSISES.push(siege);
  }
  return sieges;
}
/** Une plante en pot rond (meubles.ts), au coin (x, y) de son ancienne place de 0,45 case. */
const plante = (x: number, y: number) => F.push(...pot(x + 0.225, y + 0.225, 1.05));
// `dos` : côté du dossier, toujours à l'opposé de la table ('N' = vers le haut du plan, 'S' = vers le bas)
const chaise = (x: number, y: number, dos: 'N' | 'S' = 'N') => F.push(...chaiseFine(x + 0.25, y + 0.25, dos === 'N' ? 'S' : 'N', '#2a2a36', '#3b3f52'));

/** Un cylindre debout (meubles.ts) : centre (cx, cy), posé à la hauteur z. */
const cyl = (cx: number, cy: number, z: number, diam: number, h: number, c: string): Box => ({ x: cx - diam / 2, y: cy - diam / 2, z, w: diam, d: diam, h, c, forme: 'cylindre' });
/** Les quatre chaises d'une table ronde : en haut, en bas, à gauche, à droite, tournées vers la table. */
const autour = (cx: number, cy: number): [number, number, Cote][] => [[cx, cy - 0.72, 'S'], [cx, cy + 0.72, 'N'], [cx - 0.72, cy, 'E'], [cx + 0.72, cy, 'W']];
/** Les tables rondes de la Cuisine et de sa salle à manger (une place de déjeuner par chaise, POI.dejeunerCafe). */
const TABLES_CUISINE: Pt[] = [[27.0, 14.85], [29.55, 14.85]];
const TABLES_SALLE: Pt[] = [[33.8, 7.6], [36.9, 7.6], [35.4, 9.7]];

/** Le guichetier, derrière le guichet, sur sa chaise. */
const GUICHETIER: Pt = [35.5, 25.5];
/** La place dans chaque cabine téléphonique : sur le tabouret. */
const POI_CABINES: Pt[] = [[34.1, 13.35], [36.4, 13.35]];

export const SEATS: Record<string, Pt> = {};
export const FIG_SEATS: Pt[] = [];
export const MEETING_SEATS: Pt[] = [];

// Pôle Code : deux rangées de bureaux, les serveurs au fond, la bibliothèque à gauche
{
  // deux écrans par poste : la veille, les sites, les dépôts, les tests se suivent sur plusieurs fenêtres
  const a = bureau(2.5, 3.2, 3, { double: true }), b = bureau(2.5, 6.4, 4, { double: true }), c = bureau(6.3, 3.2, 1, { double: true });
  [SEATS.light, SEATS.mafe, SEATS.luffy] = a;
  [SEATS.lea, SEATS.paul, SEATS.zoro, SEATS.sam] = b;
  FIG_SEATS.push(...c);
  box(8.6, 1.3, 0, 0.9, 0.9, 1.5, '#23232e', { lumieres: true, bloque: true });
  box(8.6, 2.3, 0, 0.9, 0.9, 1.5, '#23232e', { lumieres: true, bloque: true });
  F.push(...etagere(1.15, 7.4, 0.45, 2.4, 1.25, 'E')); // la bibliothèque : manuels et doc
  box(1.15, 9.95, 0, 0.5, 0.6, 0.95, '#9aa0a8', { motif: 'tiroirs', motifFace: 'x', bloque: true }); // le classeur à tiroirs (les archives)
  box(5.1, 3.82, 0.42, 0.1, 0.07, 0.1, '#f2c94c'); box(5.13, 3.81, 0.52, 0.06, 0.06, 0.06, '#f2c94c'); box(5.08, 3.84, 0.5, 0.03, 0.04, 0.02, '#e0753f'); // le canard en plastique
  F.push(...lampe(9.55, 4.2, 1.15));
  plante(9.2, 10.1);
  F.push(...canape(7.7, 9.45, 0.75, 0.75, 'S', '#e8b04a', '#f2c94c')); // le fauteuil jaune
}
// Direction (bureau vitré)
{
  F.push(...canape(11.6, 1.2, 0.9, 2.6, 'E', '#3b3a55', '#4a4968')); // le canapé…
  box(12.65, 1.55, 0, 0.75, 1.9, 0.01, '#9aa0c0'); // … son tapis…
  F.push(...table(12.75, 1.9, 0.55, 1.2, { h: 0.22, c: '#8a5a34', pieds: '#5a3a26' }), ...tasse(13.0, 2.3, 0.22, '#e0753f')); // … et sa table basse
  const a = bureau(14.5, 2.4, 2), b = bureau(17.6, 3.0, 1, { bois: true, chaise: '#1d1b2e' }); // le bureau en bois de Kuroro, son fauteuil (loin des vitres)
  [SEATS.stalker, SEATS.obito] = a; SEATS.kuroro = b[0];
  // Feu, le copilote de trading : un poste à deux écrans (les cours d'un côté, le journal de l'autre), sa chaise jaune
  // Binance, au fond, devant le grand écran mural ; le passage de Kuroro vers la porte reste libre
  SEATS.feu = bureau(16.9, 0.75, 1, { double: true, chaise: '#F0B90B' })[0];
  box(16.7, 0.14, 0.3, 2.2, 0.1, 0.66, '#1d1b2e', { ecran: '#3a8ff0' }); // l'écran au mur du fond, vu de face
  F.push(...etagere(15.0, 0.15, 1.5, 0.45, 1.1, 'S')); // la bibliothèque, contre le mur du fond (plus contre les vitres)
  box(16.15, 0.25, 1.1, 0.12, 0.12, 0.2, '#e8b04a'); box(16.12, 0.22, 1.1, 0.18, 0.18, 0.04, '#5a3a26'); // la coupe
  // la petite table ronde de réunion de la Direction, trois chaises
  F.push(...tableRonde(14.4, 4.85, { diam: 0.7, c: '#f4f1ea' }), ...chaiseFine(14.4, 4.2, 'S', '#3a3f55', '#7a8098'), ...chaiseFine(15.05, 4.85, 'W', '#3a3f55', '#7a8098'), ...chaiseFine(13.75, 4.85, 'E', '#3a3f55', '#7a8098')); // trois chaises, aucune contre la vitre
  F.push(...lampe(11.45, 0.55, 1.2)); // la lampe, dans le coin du canapé (l'horloge est au-dessus de l'autre coin)
  plante(12, 5.1);
}
// Mac & Outils
{
  // (contre le mur du fond, comme la Direction : tout a glissé de deux cases vers la gauche et vers le fond)
  F.push(...etagere(22.25, 1.3, 0.45, 2.0, 1.25, 'E')); // la bibliothèque de Malenia (les notes, les carnets)
  const a = bureau(23.4, 3.6, 1, { imac: true }), b = bureau(25.2, 1.6, 2, { imac: true }); // des iMac
  SEATS.clara = a[0]; [SEATS.isaac, SEATS.malenia] = b;
  // les serveurs, poussés dans le coin du fond à droite : ils ne cachent plus personne et laissent le passage
  box(28.0, 0.15, 0, 0.85, 0.85, 1.5, '#23232e', { lumieres: true, bloque: true });
  box(28.0, 1.05, 0, 0.85, 0.85, 1.5, '#23232e', { lumieres: true, bloque: true });
  box(25.6, 1.75, 0.42, 0.2, 0.2, 0.05, '#d9dbe0', { top: '#eceef2' }); // le Mac mini d'Isaac
  box(24.35, 3.75, 0.42, 0.28, 0.22, 0.05, '#c9a27a'); box(24.37, 3.77, 0.47, 0.24, 0.18, 0.04, '#ffffff'); box(24.37, 3.77, 0.51, 0.24, 0.18, 0.04, '#f7e7a8'); // le courrier de Clara
  // l'établi : le plan en bois, le panneau à outils, la caisse à outils rouge, un Mac mini ouvert, un tournevis
  F.push(...table(26.3, 5.45, 1.8, 0.65, { h: 0.45, c: '#a8744a', pieds: '#5a3a26' }));
  box(26.3, 5.4, 0.45, 1.8, 0.05, 0.8, '#d8c29a', { motif: 'outils' });
  box(26.45, 5.6, 0.45, 0.42, 0.24, 0.18, '#c94a4a', { top: '#e05a5a' }); box(26.55, 5.68, 0.63, 0.22, 0.06, 0.03, '#2a2a36');
  box(27.2, 5.62, 0.45, 0.22, 0.22, 0.04, '#d9dbe0'); box(27.62, 5.75, 0.45, 0.22, 0.03, 0.03, '#e8b04a');
  plante(22.5, 6.3);
}
// Le petit vestiaire, dos au mur du fond, dans les deux cases entre la Direction (jusqu'à x 20) et Mac & Outils (dès
// x 22) : trois casiers (façade vers la pièce, sous la fenêtre) et le portemanteau à côté ; l'horloge est juste
// au-dessus, à gauche (Horloge.tsx). Le couloir reste libre devant. Puis l'imprimante.
box(20.2, 0.14, 0, 1.2, 0.45, 0.95, '#4a78c0', { top: '#5b8fd6', motif: 'casiers', bloque: true });
F.push(cyl(21.62, 0.4, 0, 0.28, 0.03, '#2a2a36'), cyl(21.62, 0.4, 0.03, 0.04, 1.2, '#2a2a36')); // le portemanteau…
box(21.5, 0.32, 0.7, 0.13, 0.2, 0.42, '#c0643e'); box(21.64, 0.42, 0.8, 0.12, 0.16, 0.3, '#3a3f55'); // … une veste, un sac
box(27, 9.9, 0, 0.9, 0.7, 0.35, '#9aa0a8', { motif: 'tiroirs', bloque: true }); // le meuble…
box(27.05, 9.95, 0.35, 0.8, 0.6, 0.28, '#d9dbe0', { top: '#eceef2' }); box(27.1, 10.0, 0.63, 0.7, 0.3, 0.04, '#3a3f55'); // … l'imprimante
box(27.2, 10.36, 0.5, 0.5, 0.2, 0.01, '#ffffff'); // la feuille qui sort
// Communication : la pièce centrale
{
  const a = bureau(12.6, 11.6, 3), b = bureau(16.8, 11.6, 3), c = bureau(12.6, 14.4, 3), l = bureau(17.2, 14.6, 2), t = bureau(20.3, 12.2, 2);
  FIG_SEATS.push(...a, b[1], b[2], ...c, t[1]);
  SEATS.ye = b[0]; SEATS.L = l[0]; SEATS.tom = t[0];
  FIG_SEATS.push(l[1]);
  box(20.1, 10.12, 0, 1.8, 0.1, 1.0, '#f4f1ea'); // tableau de post-it
  ([['#ffd84a', 0], ['#ff8fb1', 1], ['#7cc8ff', 2]] as const).forEach(([c2, i]) =>
    [0, 1].forEach(r => box(20.25 + i * 0.55, 10.24, 0.4 + r * 0.3, 0.42, 0.03, 0.24, c2)));
  F.push(...canape(21.9, 13.6, 0.9, 2.6, 'W', '#2f6fd6', '#4a86e8')); // le canapé bleu…
  F.push(...table(21.0, 14.2, 0.6, 1.2, { h: 0.22, c: '#f4f1ea' })); // … sa table basse, les magazines de Ye
  (['#e0753f', '#4f86e8', '#f2c94c', '#d6247a'] as const).forEach((c, i) => box(21.08 + (i % 2) * 0.24, 14.35 + Math.floor(i / 2) * 0.45, 0.22 + (i % 3) * 0.012, 0.2, 0.28, 0.012 + (i % 3) * 0.012, c));
  F.push(...canape(13, 17.4, 2.6, 0.9, 'S', '#c0643e', '#d9774a')); // la banquette
  box(17.98, 15.25, 0.42, 0.24, 0.32, 0.03, '#1d1b2e'); box(18.28, 15.3, 0.42, 0.02, 0.2, 0.02, '#e0753f'); // le carnet et le stylo de L
  box(17.55, 12.35, 0.42, 0.22, 0.3, 0.06, '#e8d9b0'); box(17.56, 12.36, 0.48, 0.2, 0.28, 0.02, '#d6247a'); // la pile de magazines de Ye
  box(16.4, 17.2, 0, 0.15, 1.0, 1.15, '#1d1b2e', { motif: 'craie', motifFace: 'x' }); // le tableau noir et ses croquis à la craie
  plante(11.5, 10.5); plante(22.2, 10.5); plante(11.5, 18.2); plante(22.2, 18.2);
}
// La Cuisine : le plan de travail (évier, cafetière et sa verseuse, bouilloire, micro-ondes), le frigo à deux portes,
// le placard haut, la fontaine à eau, la poubelle de tri, deux tables rondes ; puis sa salle à manger, trois tables
{
  box(25.2, 11.15, 0, 3.5, 0.6, 0.4, '#f4f1ea', { motif: 'tiroirs', bloque: true }); // les meubles bas
  box(25.17, 11.13, 0.4, 3.56, 0.66, 0.04, '#c9c2b4', { top: '#ddd7cb' }); // le plan de travail
  box(25.5, 11.25, 0.44, 0.8, 0.38, 0.006, '#9aa0a8', { top: '#b8bec6' }); box(25.56, 11.3, 0.442, 0.68, 0.28, 0.004, '#7d848c'); // l'évier
  F.push(cyl(25.9, 11.24, 0.44, 0.045, 0.17, '#c9ccd3'), { x: 25.88, y: 11.22, z: 0.6, w: 0.04, d: 0.16, h: 0.03, c: '#c9ccd3' }); // le robinet
  box(26.55, 11.2, 0.44, 0.3, 0.24, 0.34, '#2a2a36', { top: '#3a3f55' }); box(26.55, 11.2, 0.72, 0.3, 0.42, 0.06, '#2a2a36'); // la cafetière
  F.push(cyl(26.7, 11.52, 0.45, 0.14, 0.13, '#6b4226'), cyl(26.7, 11.52, 0.58, 0.12, 0.02, '#2a2a36')); // sa verseuse
  F.push(cyl(27.3, 11.48, 0.44, 0.16, 0.17, '#e9e9ef'), cyl(27.3, 11.48, 0.61, 0.09, 0.025, '#3a3f55')); box(27.38, 11.44, 0.48, 0.05, 0.08, 0.12, '#3a3f55'); // la bouilloire
  box(27.72, 11.2, 0.44, 0.52, 0.34, 0.28, '#e9e9ef', { top: '#f4f4f6' }); // le micro-ondes…
  box(27.76, 11.54, 0.47, 0.34, 0.012, 0.22, '#14141c'); box(28.13, 11.54, 0.62, 0.07, 0.012, 0.05, '#3dff8a'); // … sa porte noire, son affichage
  box(28.85, 11.15, 0, 0.85, 0.7, 1.2, '#f4f4f6', { left: '#e4e4ea', bloque: true }); // le frigo
  box(28.86, 11.851, 0.8, 0.83, 0.006, 0.02, '#b8bec6'); // la séparation des deux portes
  box(29.56, 11.86, 0.88, 0.04, 0.03, 0.24, '#8a8f99'); box(29.56, 11.86, 0.3, 0.04, 0.03, 0.36, '#8a8f99'); // les poignées
  box(25.15, 13.25, 0, 0.6, 0.9, 1.25, '#e9e3d6', { motif: 'placard', motifFace: 'x', bloque: true }); // le placard haut
  box(25.18, 14.35, 0, 0.34, 0.34, 0.55, '#f4f4f6'); F.push(cyl(25.35, 14.52, 0.55, 0.26, 0.32, '#8fd0f2'), cyl(25.35, 14.52, 0.87, 0.08, 0.04, '#2f6fd6')); // la fontaine à eau
  ([['#f2c94c', '#d9ae2c'], ['#3d9c5a', '#2f7d45'], ['#2f6fd6', '#2458b0']] as const).forEach(([c, couvercle], i) =>
    box(25.18, 15.0 + i * 0.38, 0, 0.3, 0.32, 0.42, c, { top: couvercle })); // la poubelle de tri : emballages, verre, papier
  F.push(...pot(30.45, 16.42, 1.1));
  for (const [cx, cy] of TABLES_CUISINE) F.push(...tableRonde(cx, cy, { c: '#f4f1ea' }), ...autour(cx, cy).flatMap(([x, y, v]) => chaiseFine(x, y, v, '#3a3f55', '#f2cf6b')));
  F.push(...tasse(27.15, 14.75, 0.42, '#e0753f'), ...tasse(29.4, 15.0, 0.42));
  // la salle à manger
  for (const [cx, cy] of TABLES_SALLE) F.push(...tableRonde(cx, cy, { c: '#c9a27a', pied: '#5a3a26' }), ...autour(cx, cy).flatMap(([x, y, v]) => chaiseFine(x, y, v, '#5a3a26', '#e0a96d')));
  F.push(...table(34.7, 6.17, 1.4, 0.42, { c: '#8a5a34', pieds: '#5a3a26' })); // le buffet…
  F.push(cyl(35.4, 6.38, 0.42, 0.3, 0.07, '#f4f1ea'), cyl(35.33, 6.36, 0.46, 0.09, 0.08, '#f2a33a'), cyl(35.48, 6.42, 0.46, 0.08, 0.07, '#e05a5a'), cyl(35.42, 6.3, 0.46, 0.08, 0.07, '#9cc04a')); // … et sa corbeille de fruits
  F.push(...pot(38.45, 6.55, 1.15), ...pot(38.45, 10.45, 1.15), ...pot(32.55, 6.55, 1.0));
}
// Box & pause (la salle de pause) : le canapé d'angle à coussins, le tapis et la table basse aux jeux de société, la
// télé et la console, le baby-foot avec ses barres et ses joueurs, deux poufs ronds, l'étagère à jeux, la borne
// d'arcade (écran, panneau, manette, boutons), une plante
{
  F.push(...canape(1.4, 12.5, 4.2, 0.9, 'S', '#c94a5a', '#d96a7a'), ...canape(1.4, 13.4, 0.9, 2.6, 'E', '#c94a5a', '#d96a7a'));
  box(2.55, 13.95, 0, 2.3, 1.5, 0.01, '#f2cf6b'); // le tapis
  F.push(...table(3.0, 14.45, 1.2, 0.6, { h: 0.22, c: '#f4f1ea' }));
  box(3.1, 14.55, 0.22, 0.45, 0.32, 0.04, '#3d6fd6'); box(3.65, 14.6, 0.22, 0.3, 0.3, 0.03, '#e05a5a'); box(3.7, 14.62, 0.25, 0.08, 0.08, 0.08, '#ffffff'); // les jeux, un dé
  box(5.75, 12.3, 0.3, 2, 0.15, 1.0, '#1d1b2e', { motif: 'jeu' }); // la télé, allumée sur un jeu (avant le muret de droite)
  box(6.1, 12.45, 0, 1.6, 0.4, 0.3, '#3a2f4a', { top: '#4a3d5e', bloque: true }); // meuble télé
  box(6.55, 12.5, 0.3, 0.55, 0.3, 0.1, '#e9e9ef', { top: '#ffffff' }); // la console
  box(2.4, 12.95, 0.29, 0.32, 0.2, 0.07, '#2a2a36', { top: '#3b3b4d' }); // manette sur le canapé
  box(4.1, 13.0, 0.29, 0.32, 0.2, 0.07, '#e9e9ef', { top: '#ffffff' }); // l'autre manette
  // le baby-foot : la caisse, le terrain vert, quatre pieds, les barres en travers et leurs joueurs rouges et bleus
  box(5.4, 16.1, 0.28, 1.6, 0.8, 0.2, '#6a3f22', { top: '#3fae5a' });
  for (const [px, py] of [[5.45, 16.15], [6.9, 16.15], [5.45, 16.75], [6.9, 16.75]]) box(px, py, 0, 0.05, 0.05, 0.28, '#3a2a1e');
  box(5.4, 16.1, 0, 1.6, 0.8, 0.01, '#3a2a1e', { bloque: true }); // (son emprise au sol)
  for (let i = 0; i < 4; i++) {
    const x = 5.62 + i * 0.38, c = i % 2 ? '#2f6fd6' : '#d64545';
    box(x, 15.95, 0.46, 0.025, 1.1, 0.025, '#c9ccd3');
    for (let k = 0; k < 2; k++) box(x - 0.025, 16.28 + k * 0.28, 0.38, 0.075, 0.06, 0.12, c);
  }
  box(5.42, 16.38, 0.42, 0.04, 0.24, 0.08, '#ffffff'); box(6.94, 16.38, 0.42, 0.04, 0.24, 0.08, '#ffffff'); // les buts
  F.push(cyl(4.45, 17.75, 0, 0.5, 0.28, '#e8b04a'), cyl(3.2, 16.95, 0, 0.55, 0.28, '#3d6fd6')); // deux poufs ronds…
  box(3.08, 16.88, 0.28, 0.32, 0.2, 0.07, '#d64545', { top: '#e86a6a' }); // … une manette posée sur l'un d'eux
  F.push(...etagere(1.15, 16.2, 0.4, 1.2, 0.9, 'E', '#6a3f22')); // l'étagère à jeux
  box(1.3, 17.6, 0, 0.8, 0.8, 1.3, '#6b4fc4', { left: '#ff6fa8', bloque: true }); // borne d'arcade
  box(1.4, 18.4, 0.62, 0.6, 0.03, 0.45, '#111018', { motif: 'arcade' }); // l'écran de la borne (course rétro)
  box(1.3, 18.4, 0.42, 0.8, 0.2, 0.1, '#3a2f6a', { top: '#4a3d7e' }); // le panneau de commande
  F.push(cyl(1.55, 18.5, 0.52, 0.03, 0.08, '#1d1b2e'), cyl(1.55, 18.5, 0.6, 0.07, 0.05, '#d64545')); // la manette
  box(1.78, 18.47, 0.52, 0.05, 0.05, 0.02, '#f2c94c'); box(1.9, 18.47, 0.52, 0.05, 0.05, 0.02, '#5ab0c9'); box(1.84, 18.53, 0.52, 0.05, 0.05, 0.02, '#3dbb5a'); // les boutons
  box(1.3, 17.6, 1.3, 0.8, 0.8, 0.12, '#ff6fa8', { top: '#ff8fbd' }); // le fronton
  F.push(...pot(7.3, 18.25, 1.1));
}
// Atelier des projets : un îlot de couleur par projet, sans nom
export const ILOTS: { r: [number, number, number, number]; sol: string }[] = [];
['#f2cf6b', '#7fd6c4', '#f29a9a', '#9ab8f2', '#c7a6f2'].forEach((sol, i) => {
  const x0 = 1.5 + i * 3.5;
  ILOTS.push({ r: [x0, 21.6, 3.2, 6.8], sol });
  FIG_SEATS.push(...bureau(x0 + 0.6, 23.2, 2), ...bureau(x0 + 0.6, 26.4, 2));
  // au bas de chaque îlot, ce qui fait son atelier ; chacun le sien (aucun ne se répète)
  const y = 27.62;
  // jaune : les bacs de rangement, et une étagère basse aux classeurs de couleur, des boîtes d'archives dessus
  if (i === 0) {
    ([['#e05a5a', 0], ['#f2c94c', 0.42], ['#3d9c5a', 0.84]] as const).forEach(([c, dx]) => { box(x0 + 0.3 + dx, y, 0, 0.38, 0.5, 0.3, c); box(x0 + 0.3 + dx, y, 0.3, 0.38, 0.5, 0.26, c); });
    F.push(...etagere(x0 + 1.8, y, 1.2, 0.42, 0.62, 'S', '#a8744a'));
    for (const dx of [0.05, 0.42, 0.79]) box(x0 + 1.8 + dx, y + 0.04, 0.62, 0.34, 0.36, 0.2, '#c9a27a', { top: '#d8b48a' });
  }
  // turquoise : l'imprimante 3D, et une petite vitrine de ce qu'elle a imprimé (figurines, pièces)
  if (i === 1) {
    F.push(...table(x0 + 0.35, y, 0.8, 0.55, { c: '#f4f1ea' }));
    box(x0 + 0.45, y + 0.05, 0.42, 0.55, 0.45, 0.06, '#2a2a36'); box(x0 + 0.45, y + 0.05, 0.48, 0.05, 0.45, 0.42, '#2a2a36'); box(x0 + 0.95, y + 0.05, 0.48, 0.05, 0.45, 0.42, '#2a2a36'); box(x0 + 0.45, y + 0.05, 0.9, 0.55, 0.45, 0.05, '#2a2a36'); // l'imprimante 3D
    F.push(cyl(x0 + 0.72, y + 0.27, 0.48, 0.12, 0.1, '#e0753f'));
    const vx = x0 + 1.55;
    box(vx, y, 0, 0.95, 0.42, 0.12, '#2a2a36'); box(vx, y, 0.9, 0.95, 0.42, 0.05, '#2a2a36'); // le socle, le dessus
    for (const dx of [0, 0.91]) box(vx + dx, y, 0.12, 0.04, 0.42, 0.78, '#2a2a36'); // les montants
    box(vx + 0.04, y, 0.12, 0.87, 0.04, 0.78, '#cfe6fb', { vitre: true }); box(vx + 0.04, y + 0.04, 0.5, 0.87, 0.34, 0.02, '#e6f2fa'); // le fond vitré, l'étagère
    F.push(cyl(vx + 0.2, y + 0.22, 0.12, 0.1, 0.16, '#e0753f'), cyl(vx + 0.5, y + 0.2, 0.12, 0.12, 0.1, '#5ab0c9'), cyl(vx + 0.75, y + 0.24, 0.12, 0.08, 0.2, '#f2c94c')); // figurines
    box(vx + 0.15, y + 0.12, 0.52, 0.18, 0.12, 0.08, '#7fd6c4'); box(vx + 0.45, y + 0.15, 0.52, 0.1, 0.1, 0.14, '#c94a4a'); F.push(cyl(vx + 0.72, y + 0.2, 0.52, 0.14, 0.05, '#9aa0a8')); // pièces
  }
  // saumon : la maquette, et un chevalet à grandes feuilles avec un croquis sans mots
  if (i === 2) {
    F.push(...table(x0 + 0.3, y, 1.3, 0.6, { h: 0.45, c: '#a8744a', pieds: '#5a3a26' }));
    box(x0 + 0.4, y + 0.1, 0.45, 0.35, 0.35, 0.22, '#c9a27a'); box(x0 + 0.85, y + 0.12, 0.45, 0.3, 0.3, 0.16, '#ffffff'); box(x0 + 0.83, y + 0.1, 0.61, 0.34, 0.34, 0.06, '#c94a4a'); // un carton, une maquette
    const cx = x0 + 2.0;
    box(cx, y + 0.3, 0, 0.05, 0.05, 1.25, '#8a5a34'); box(cx + 0.85, y + 0.3, 0, 0.05, 0.05, 1.25, '#8a5a34'); box(cx + 0.42, y, 0, 0.05, 0.05, 1.2, '#8a5a34'); // les trois pieds
    box(cx - 0.02, y + 0.33, 0.35, 0.94, 0.04, 0.03, '#8a5a34'); // l'appui
    box(cx + 0.02, y + 0.35, 0.38, 0.86, 0.02, 0.8, '#fbfbf8', { motif: 'croquis' }); // la grande feuille
  }
  // bleu : la table haute et ses tabourets, et un écran mobile sur pied, au repos (le logo du QG)
  if (i === 3) {
    F.push(...tableRonde(x0 + 1.0, y + 0.35, { diam: 0.55, h: 0.62, c: '#f4f1ea' }), ...tabouret(x0 + 0.4, y + 0.35, '#2a2a36', '#9ab8f2', 0.45), ...tabouret(x0 + 1.6, y + 0.35, '#2a2a36', '#9ab8f2', 0.45));
    const ex = x0 + 2.55;
    box(ex - 0.3, y + 0.1, 0, 0.6, 0.35, 0.05, '#2a2a36'); F.push(cyl(ex - 0.25, y + 0.15, 0, 0.06, 0.04, '#1d1b2e'), cyl(ex + 0.25, y + 0.4, 0, 0.06, 0.04, '#1d1b2e')); // le pied à roulettes
    box(ex - 0.03, y + 0.25, 0.05, 0.06, 0.06, 0.75, '#3a3f55'); // le mât
    box(ex - 0.42, y + 0.32, 0.72, 0.84, 0.05, 0.5, '#1d1b2e', { motif: 'veille' }); // l'écran, au repos
  }
  // violet : la grande plante et le pouf, une cloison de plantes hautes dans l'allée, un lampadaire
  if (i === 4) {
    F.push(...pot(x0 + 0.55, y + 0.35, 1.4), cyl(x0 + 1.5, y + 0.35, 0, 0.6, 0.3, '#7a4fc4'));
    F.push(...lampe(x0 + 2.45, y + 0.35, 1.25));
    const px = x0 + 2.72;
    box(px, 24.2, 0, 0.4, 1.5, 0.35, '#8a5a34', { top: '#5a3a26' }); // le bac de la cloison
    for (let k = 0; k < 7; k++) {
      const yy = 24.28 + k * 0.2, h = 0.75 + ((k * 37) % 5) * 0.12;
      box(px + 0.08 + (k % 2) * 0.1, yy, 0.35, 0.16, 0.16, h, ['#2f7d45', '#3a8f4f', '#4caf50'][k % 3], { top: '#5cbf74' });
    }
  }
});
// Les affiches « geek » du mur de gauche, entre et sous les fenêtres (des décorations, aucune donnée) : le long de
// l'Atelier, puis dans le Pôle Code. Chacune sa taille et son cadre ; l'image est sur la face qui regarde la pièce.
const affiche = (y: number, z: number, d: number, h: number, motif: Motif, cadre: string) => box(0.0, y, z, 0.04, d, h, cadre, { motif, motifFace: 'x' });
affiche(22.95, 1.55, 0.6, 0.6, 'affiche-js', '#1d1b2e');
affiche(22.9, 0.95, 1.1, 0.4, 'affiche-hello', '#2a2a36');
affiche(24.5, 0.28, 0.5, 0.65, 'affiche-accolades', '#f4f1ea');
affiche(25.2, 0.4, 0.8, 0.5, 'affiche-cafe', '#8a5a34');
affiche(26.25, 1.6, 0.6, 0.6, 'affiche-node', '#f4f1ea');
affiche(26.2, 1.0, 1.25, 0.4, 'affiche-git', '#1d1b2e');
affiche(3.15, 1.2, 1.15, 0.6, 'affiche-code', '#f4f1ea');
affiche(6.5, 1.3, 0.6, 0.65, 'affiche-404', '#1d1b2e');
affiche(9.75, 1.35, 0.6, 0.5, 'affiche-wq', '#8a5a34');

// Salle de réunion : la longue table, les chaises, le tableau blanc et le grand écran
{
  F.push(...table(22.3, 23.6, 6.6, 1.8, { c: '#f4f1ea' }));
  F.push(cyl(25.6, 24.5, 0.42, 0.34, 0.03, '#2a2a36'), cyl(25.6, 24.5, 0.45, 0.12, 0.02, '#3a3f55')); // le téléphone de conférence
  for (const [x, y] of [[22.9, 23.85], [24.5, 23.85], [27.7, 24.8]] as const) { box(x, y, 0.42, 0.38, 0.26, 0.03, '#c9ccd3', { top: '#d9dbe0' }); } // des ordinateurs portables fermés
  for (const [x, y] of [[23.7, 24.0], [26.7, 24.1], [26.1, 25.0], [23.4, 25.05]] as const) F.push(cyl(x, y, 0.42, 0.08, 0.2, '#9cd0f0'), cyl(x, y, 0.62, 0.05, 0.03, '#2f6fd6')); // des bouteilles d'eau
  for (const [x, y] of [[23.95, 24.05], [26.95, 24.15], [26.35, 24.95]] as const) F.push(cyl(x, y, 0.42, 0.07, 0.09, '#e6f2fa')); // des verres
  for (let i = 0; i < 6; i++) {
    chaise(22.8 + i * 1.05, 23.0);
    chaise(22.8 + i * 1.05, 25.5, 'S'); // rangée du bas : dossier côté couloir, pas contre la table
    MEETING_SEATS.push([23.05 + i * 1.05, 23.15]);
    if (i < 3) MEETING_SEATS.push([23.05 + i * 1.05, 25.95]);
  }
  box(21.18, 21.8, 0.25, 0.1, 2.6, 1.0, '#f4f1ea', { right: '#ffffff', motif: 'schema', motifFace: 'x' }); // le tableau blanc et son schéma
  box(24.3, 21.12, 0.35, 4.2, 0.12, 0.9, '#1d1b2e', { motif: 'veille' }); // le grand écran, au repos : le logo du QG
  plante(21.5, 27.2); plante(29.3, 21.5);
}
// Toilettes : quatre cabines le long du mur du fond, deux Hommes puis deux Femmes (pictogramme au-dessus de chaque
// porte, une cuvette et son réservoir dedans, visibles par le haut), les lavabos et leur miroir, le sèche-mains.
// Les portes sont à part (PORTES_WC) : fermée quand quelqu'un est dans la cabine, ouverte vers l'intérieur sinon.
/** Les portes des quatre cabines des toilettes : fermée (on y est) et ouverte (libre), avec leur poignée (Activites.tsx). */
export const PORTES_WC: { ferme: Box[]; ouverte: Box[] }[] = [];
{
  for (let i = 0; i < 4; i++) {
    const x = 32.25 + i * 1.17, w = 1.12, femme = i >= 2, porte = femme ? '#e07aa6' : '#5b8fd6';
    box(x, 0.14, 0.08, 0.05, 1.36, 1.05, '#dfe4ee'); // la cloison de gauche (un jour en bas, comme partout)
    if (i === 3) box(x + w - 0.05, 0.14, 0.08, 0.05, 1.36, 1.05, '#dfe4ee'); // et celle de droite, pour la dernière
    box(x + 0.05, 1.45, 1.08, w - 0.05, 0.05, 0.05, '#dfe4ee'); // le linteau, au-dessus de la porte
    box(x + w / 2 - 0.14, 1.47, 1.13, 0.28, 0.01, 0.28, '#ffffff', { motif: femme ? 'femme' : 'homme' }); // son pictogramme
    PORTES_WC.push({
      // fermée : dans l'ouverture, la poignée côté couloir ; ouverte : rabattue contre la cloison de gauche, dedans
      ferme: [{ x: x + 0.05, y: 1.45, z: 0.08, w: w - 0.05, d: 0.05, h: 1.0, c: porte, bloque: true }, { x: x + w - 0.2, y: 1.5, z: 0.5, w: 0.08, d: 0.03, h: 0.03, c: '#c9ccd3' }],
      ouverte: [{ x: x + 0.05, y: 1.5 - w + 0.05, z: 0.08, w: 0.05, d: w - 0.05, h: 1.0, c: porte }, { x: x + 0.1, y: 1.5 - w + 0.2, z: 0.5, w: 0.03, d: 0.08, h: 0.03, c: '#c9ccd3' }],
    });
    F.push(cyl(x + w / 2, 0.62, 0, 0.32, 0.3, '#ffffff')); box(x + w / 2 - 0.17, 0.16, 0, 0.34, 0.16, 0.48, '#f4f6fa'); // la cuvette, le réservoir
  }
  box(37.05, 0.15, 0, 1.75, 0.5, 0.4, '#f4f1ea', { motif: 'tiroirs', bloque: true }); box(37.03, 0.14, 0.4, 1.79, 0.54, 0.04, '#c9c2b4', { top: '#ddd7cb' }); // le meuble des lavabos
  for (const x of [37.5, 38.35]) {
    F.push(cyl(x, 0.42, 0.44, 0.32, 0.05, '#ffffff'), cyl(x, 0.2, 0.44, 0.04, 0.14, '#c9ccd3')); // la vasque, le robinet
    F.push(cyl(x + 0.22, 0.24, 0.44, 0.06, 0.12, '#9cc0e8')); // le savon
  }
  box(37.1, 0.14, 0.55, 1.65, 0.02, 0.42, '#d6e6f3', { top: '#eef5fb' }); // le miroir
  box(36.88, 0.55, 0.62, 0.12, 0.3, 0.26, '#e9e9ef'); box(36.98, 0.62, 0.6, 0.03, 0.16, 0.03, '#2a2a36'); // le sèche-mains, sur la cloison
  F.push(cyl(38.55, 0.98, 0, 0.24, 0.3, '#9aa0a8')); // la poubelle
  F.push(...pot(38.45, 4.35, 1.1));
}
// Cabines téléphoniques : deux vraies cabines, le fond et un côté en feutre de couleur, la façade et l'autre côté
// vitrés, une porte vitrée, une tablette avec le téléphone, un tabouret, une petite lampe au plafond, et le voyant
// « occupé » au-dessus de la porte (rouge seulement si quelqu'un y est, POI.cabines)
const CABINES: [number, number, string, string][] = [[33.35, 12.45, '#8a5ac8', '#6a3fa8'], [35.65, 12.45, '#2f8a8a', '#1f6a6a']];
CABINES.forEach(([x, y, c, toit], i) => {
  const t = 1.5;
  for (const [px, py] of [[x, y], [x + t - 0.06, y], [x, y + t - 0.06], [x + t - 0.06, y + t - 0.06]]) box(px, py, 0, 0.06, 0.06, t, '#2a2a36'); // l'ossature
  box(x + 0.06, y, 0, t - 0.12, 0.06, t, c); box(x, y + 0.06, 0, 0.06, t - 0.12, t, c); // le fond et le côté en feutre
  box(x - 0.03, y - 0.03, t, t + 0.06, t + 0.06, 0.08, c, { top: toit }); // le toit
  box(x + t - 0.05, y + 0.06, 0.03, 0.04, t - 0.12, t - 0.07, '#cfe6fb', { vitre: true }); // le côté vitré
  box(x + 0.06, y + t - 0.05, 0.03, 0.4, 0.04, t - 0.07, '#cfe6fb', { vitre: true }); // la façade…
  box(x + 0.48, y + t - 0.03, 0.03, t - 0.54, 0.04, t - 0.07, '#cfe6fb', { vitre: true }); // … et sa porte
  box(x + 0.54, y + t + 0.01, 0.55, 0.03, 0.03, 0.42, '#c9ccd3'); // la poignée
  box(x + 0.06, y + 0.06, 0, t - 0.12, t - 0.12, 0.01, '#5b6275'); // le tapis
  box(x + 0.25, y + 0.06, 0.62, 1.0, 0.32, 0.04, '#c9a27a'); // la tablette
  box(x + 0.38, y + 0.12, 0.66, 0.24, 0.16, 0.05, '#1d1b2e'); box(x + 0.4, y + 0.13, 0.71, 0.2, 0.06, 0.04, '#2a2a36'); // le téléphone et son combiné
  F.push(...tabouret(x + 0.75, y + 0.9, '#2a2a36', '#3a3f55'));
  F.push(cyl(x + 0.75, y + 0.75, 1.36, 0.2, 0.12, '#ffe9b0')); // la lampe
  box(x + 0.9, y + t + 0.032, t + 0.015, 0.36, 0.006, 0.05, '#3dff8a', { voyant: POI_CABINES[i] }); // le voyant « occupé »
});
// Studio de contenu : le fond orange (le décor), l'enseigne ON AIR (éteinte tant que L ne tourne pas vraiment,
// src/scene/onair.ts), le canapé des invités et sa petite table, un pied de micro devant la place de L, la caméra sur son
// pied tournée vers la scène, deux projecteurs, la régie (deux écrans, la console, une chaise), des caisses de transport
{
  box(34, 17.35, 0, 4.6, 0.25, 1.6, '#e8694a');
  box(38.35, 17.6, 0, 0.25, 2.6, 1.6, '#e8694a', { right: '#c9563c' });
  box(34.55, 17.6, 1.1, 0.95, 0.04, 0.38, '#1d1b2e', { motif: 'onair' }); // l'enseigne, posée sur le décor
  F.push(...canape(34.45, 17.75, 1.5, 0.7, 'S', '#3a2f6a', '#5a4b8f')); // le canapé des invités (à gauche : le décor de droite ne le cache pas)
  F.push(...tableRonde(36.3, 18.05, { diam: 0.42, h: 0.3, c: '#f4f1ea' }), ...tasse(36.25, 18.0, 0.3, '#e0753f'));
  F.push(cyl(36.55, 19.75, 0, 0.18, 0.02, '#1d1b2e'), cyl(36.55, 19.75, 0.02, 0.03, 0.8, '#2a2a36'), cyl(36.55, 19.75, 0.82, 0.06, 0.1, '#1d1b2e')); // le pied de micro
  // la caméra : le pied, le corps, l'objectif tourné vers la scène
  F.push(cyl(33.5, 20.4, 0, 0.36, 0.03, '#2a2a36'), cyl(33.5, 20.4, 0.03, 0.05, 0.72, '#2a2a36'));
  box(33.28, 20.25, 0.75, 0.46, 0.3, 0.28, '#1d1b2e', { top: '#2a2a36' }); box(33.74, 20.33, 0.8, 0.16, 0.14, 0.16, '#14141c', { right: '#3a6fc0' });
  // deux projecteurs : un pied, une tête dont la face éclairée regarde la scène
  F.push(cyl(33.4, 18.1, 0, 0.3, 0.03, '#2a2a36'), cyl(33.4, 18.1, 0.03, 0.04, 1.05, '#2a2a36'));
  box(33.22, 17.94, 1.05, 0.36, 0.32, 0.28, '#1d1b2e', { right: '#fff3c4' });
  F.push(cyl(37.95, 21.55, 0, 0.3, 0.03, '#2a2a36'), cyl(37.95, 21.55, 0.03, 0.04, 1.05, '#2a2a36'));
  box(37.75, 21.4, 1.05, 0.4, 0.3, 0.3, '#1d1b2e', { left: '#fff3c4' });
  // la régie
  F.push(...table(31.5, 18, 1.4, 0.7, { c: '#2a2240', pieds: '#1d1b2e' }));
  F.push(...ecranFin(31.85, 18.02, 0.42, '#b3a4ff', { large: 0.5, haut: 0.26 }), ...ecranFin(32.55, 18.02, 0.42, '#f7a1c4', { large: 0.5, haut: 0.26 }));
  box(31.6, 18.38, 0.42, 0.7, 0.24, 0.03, '#3a3f55'); for (let i = 0; i < 5; i++) box(31.66 + i * 0.13, 18.45, 0.45, 0.04, 0.12, 0.02, ['#3dbb5a', '#f2c94c', '#e0753f', '#5ab0c9', '#f4f1ea'][i]); // la console et ses curseurs
  F.push(...chaiseDeBureau(32.2, 17.6, 'S'));
  // les caisses de transport, au fond, et un rouleau de câble
  box(35.3, 21.75, 0, 0.75, 0.5, 0.42, '#1d1b2e', { top: '#2a2a36' }); box(36.15, 21.8, 0, 0.6, 0.45, 0.32, '#1d1b2e', { top: '#2a2a36' });
  for (const x of [35.3, 35.99]) box(x, 21.75, 0.42, 0.06, 0.5, 0.02, '#9aa0a8');
  F.push(cyl(37.05, 22.1, 0, 0.36, 0.08, '#2a2a36'));
}
// Bureau des accords, qui sert aussi d'accueil : les étagères de classeurs de couleur, le meuble à tiroirs, le
// guichet et son panneau « Accueil », la sonnette, les tampons vert et rouge, la chaise du guichetier, deux chaises
// d'attente près de la porte, une plante
{
  F.push(...etagere(33.0, 24.15, 2.2, 0.4, 1.0, 'S', '#6a3f22'), ...etagere(35.3, 24.15, 2.2, 0.4, 1.0, 'S', '#6a3f22'));
  box(37.65, 24.15, 0, 0.6, 0.5, 0.9, '#9aa0a8', { motif: 'tiroirs', bloque: true });
  box(33.4, 25.8, 0, 4.2, 0.9, 0.55, '#8a5a34', { top: '#b07a4c', bloque: true });
  box(34.7, 26.7, 0.18, 1.6, 0.02, 0.32, '#1d1b2e', { motif: 'accueil' }); // le panneau « Accueil »
  box(34, 25.9, 0.55, 0.45, 0.45, 0.2, '#3dbb5a'); box(36.8, 25.9, 0.55, 0.45, 0.45, 0.2, '#d64545');
  box(35.2, 25.95, 0.55, 0.6, 0.4, 0.12, '#f4f1ea'); box(35.25, 25.95, 0.67, 0.55, 0.35, 0.12, '#f4f1ea');
  F.push(cyl(36.2, 26.45, 0.55, 0.14, 0.04, '#c9a14e'), cyl(36.2, 26.45, 0.59, 0.1, 0.05, '#e8c547')); // la sonnette
  F.push(...chaiseDeBureau(GUICHETIER[0], GUICHETIER[1], 'S')); ASSISES.push(GUICHETIER); // le guichetier s'assoit
  F.push(...chaiseFine(32.65, 28.35, 'N', '#3a3f55', '#c9a14e'), ...chaiseFine(33.3, 28.35, 'N', '#3a3f55', '#c9a14e'));
  plante(38.2, 28.2);
}
// L'entrée du bâtiment (devant le guichet, entre la salle de réunion et le bureau des accords) : le paillasson,
// l'encadrement de la porte, percée dans le mur de devant (World.tsx), un petit auvent, l'enseigne « QG » et la marche
// qui descend vers l'allée ; la porte vitrée, grande ouverte vers le dehors
box(30.5, 28.7, 0, 1.3, 0.9, 0.03, '#8a5a34', { top: '#a8744a' });
box(PORTE.x, 29.9, 0, 0.16, 0.16, 1.55, '#3a3f55'); box(PORTE.x + PORTE.w - 0.16, 29.9, 0, 0.16, 0.16, 1.55, '#3a3f55'); // les montants
box(PORTE.x, 29.9, 1.55, PORTE.w, 0.16, PORTE.h - 1.55, '#3a3f55'); // le linteau
// la porte vitrée, sur ses gonds à gauche, rabattue contre le tableau du mur : le cadre (bas, chant, poignée), la vitre
box(PORTE.x + 0.02, GRID.h + 0.06, 0.06, 0.06, 0.82, 0.1, '#3a3f55');
box(PORTE.x + 0.02, GRID.h + 0.82, 0.06, 0.06, 0.08, 1.46, '#3a3f55');
box(PORTE.x + 0.08, GRID.h + 0.7, 0.72, 0.04, 0.03, 0.2, '#c9ccd3');
box(PORTE.x + 0.03, GRID.h + 0.06, 0.16, 0.04, 0.76, 1.28, '#cfe6fb', { vitre: true });
// l'auvent, posé sur le linteau, fixé au mur (il ne dépasse pas à l'intérieur), puis l'enseigne posée dessus
box(29.95, GRID.h, PORTE.h, 2.3, 0.95, 0.08, '#c0643e', { top: '#d9774a' });
box(30.6, 30.6, 1.77, 1.0, 0.08, 0.5, '#1d1b2e', { motif: 'enseigne' });
// le seuil, dans l'épaisseur du mur, et la marche, dehors (elle ne passe pas sous le mur)
box(PORTE.x, GRID.h, 0, PORTE.w, EPAISSEUR_MUR, 0.06, '#c9c2b4', { top: '#ddd7cb' });
box(29.85, GRID.h + EPAISSEUR_MUR, 0, 2.5, 0.65, 0.06, '#c9c2b4', { top: '#ddd7cb' });

// ───────── L'objet typique de chaque pôle (prompt 7) ─────────
/** Deux pieds sous un panneau (x, y, largeur) posé à la hauteur `z` : il ne flotte plus au-dessus du muret. */
const pieds = (x: number, y: number, w: number, z: number) => [x + 0.25, x + w - 0.35].forEach(px => box(px, y, 0, 0.1, 0.08, z, '#2a2a36'));
box(3.4, 1.12, 0.55, 2.8, 0.12, 1.15, '#1d1b2e', { motif: 'terminal' }); // Pôle Code : le grand écran de terminal
pieds(3.4, 1.14, 2.8, 0.55); // … sur ses deux pieds
box(19.85, 17.55, 0, 0.5, 0.5, 0.25, '#2a2a36'); // Communication : le téléphone LinkedIn géant, sur son socle
box(19.7, 17.85, 0.25, 0.8, 0.14, 1.35, '#1d1b2e', { motif: 'linkedin' });
box(12.9, 0.14, 0.12, 2.0, 0.08, 0.86, '#f4f1ea', { motif: 'organigramme' }); // Direction : l'organigramme, collé au mur du fond
box(23.8, 0.14, 0.5, 2.2, 0.1, 0.95, '#1d1b2e', { motif: 'disque' }); // Mac & Outils : la jauge du disque
pieds(23.8, 0.15, 2.2, 0.5);
box(6.8, 21.14, 0.4, 3.4, 0.1, 1.0, '#f4f1ea', { motif: 'kanban' }); // Atelier : le tableau des tâches (sans nom de projet)
pieds(6.8, 21.15, 3.4, 0.4);
box(35.4, 24.2, 1.05, 1.5, 0.08, 0.75, '#f4f1ea', { motif: 'accord' }); // Bureau des accords : accord ou refus

export const FURNITURE = F;
// les autres places assises : les chaises de la salle de réunion, les tabourets des cabines ; celles du déjeuner
// à la Cuisine sont ajoutées avec les lieux (plus bas)
ASSISES.push(...MEETING_SEATS, ...POI_CABINES);

export const TREES: Pt[] = [
  [-1.4, 6], [-1.4, 15], [-1.4, 24], [7, 31], [16, 31], [25, 31], [33, 31.2], [40.6, 3.5], [40.6, 11.6], [40.4, 20.5],
];

// Lieux où vont les agents
export const POI = {
  /** Prendre un café : devant le plan de travail, à côté de la cafetière, devant le frigo. */
  cafe: [[26.0, 12.35], [26.85, 12.4], [29.1, 12.45]] as Pt[],
  cafeDebout: [[28.3, 13.2], [26.2, 13.45], [30.3, 13.05], [28.25, 16.3], [29.4, 16.4]] as Pt[],
  /** Celui qui tient la cuisine, devant le micro-ondes (le « barista » de la simulation). */
  barista: [27.95, 12.1] as Pt,
  imprimante: [26.6, 10.4] as Pt,
  sieste: [3.4, 13.9] as Pt,
  babyfoot: [[4.9, 16.5], [7.3, 16.5]] as Pt[],
  toilettes: [[33.2, 2.6], [34.5, 2.6]] as Pt[],
  /** Dans chaque cabine, sur son tabouret. */
  cabines: POI_CABINES,
  reunion: [[23.1, 22.9], [25.3, 22.9], [24.2, 26.1]] as Pt[],
  scene: [36.2, 19.4] as Pt,
  camera: [33.2, 20.9] as Pt,
  guichet: [35.6, 27.6] as Pt,
  guichetier: GUICHETIER,
  centreComm: [17.5, 16.8] as Pt,
  coinCode: [8.5, 9.8] as Pt,
  coinMac: [25.5, 5.8] as Pt,
  couloir: [[11.0, 19.6], [11.8, 20.3]] as Pt[],
  /**
   * Les places du déjeuner, une personne par place, espacées (au moins 0,8 case) : à la Cuisine, une par chaise ;
   * en salle de pause, au bord du canapé, devant la télé, au baby-foot, à l'arcade.
   */
  dejeunerCafe: [...TABLES_CUISINE, ...TABLES_SALLE].flatMap(([x, y]) => autour(x, y).map(([a, b]): Pt => [a, b])),
  dejeunerPause: [
    [3, 13.75], [4, 13.75], [5, 13.75], // au bord du canapé
    [6.4, 13.9], [7.3, 13.9], // devant la télé
    [5, 15], [6.2, 15], [3.8, 15.95], [2.75, 16.1], // debout, au milieu
    [4.9, 16.5], [7.3, 16.5], // au baby-foot
    [1.7, 18.9], // à l'arcade
  ] as Pt[],
  /** L'entrée du bâtiment, sur le paillasson : on y arrive le matin, on en repart le soir. */
  entree: [31.1, 29.2] as Pt,
  /** Un point avec Kuroro : les deux places du canapé de la Direction. */
  canapeDirection: [[12.15, 1.95], [12.15, 3.05]] as Pt[],
  /** Un café à deux, hors déjeuner : face à face à une table de la salle à manger (deux chaises par table). */
  cafeADeux: TABLES_SALLE.map(([x, y]) => autour(x, y).slice(2).map(([a, b]): Pt => [a, b])),
  /** La salle de pause : devant la télé, à l'arcade. */
  tele: [6.85, 13.9] as Pt,
  arcade: [1.7, 18.9] as Pt,
};

ASSISES.push(...POI.dejeunerCafe, ...POI.canapeDirection);

/** Les parties d'une pièce (la pièce, puis son annexe s'il y en a une), chacune avec ses portes. */
export const partiesDe = (r: Room) => [{ r: r.r, portes: r.portes }, ...(r.annexe ? [r.annexe] : [])];

/**
 * Les annexes qui ont leur propre nom (la Salle à manger de la Cuisine) : leur pictogramme et leur étiquette au survol,
 * comme une pièce ; un clic ouvre la fiche de la pièce. `cle` : l'identifiant de leur survol et de leurs étiquettes.
 */
export const ANNEXES = ROOMS.filter(r => r.annexe?.nom).map(r => {
  const [x, y, w, d] = r.annexe!.r;
  return { cle: `${r.id}-annexe`, piece: r.id, nom: r.annexe!.nom!, couleur: r.couleur, etiquette: r.annexe!.etiquette ?? G(x + w / 2, y + d / 2) };
});

export function roomAt(x: number, y: number): Room | undefined {
  const dans = ([x0, y0, w, d]: [number, number, number, number]) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + d;
  return ROOMS.find(r => partiesDe(r).some(p => dans(p.r)));
}
