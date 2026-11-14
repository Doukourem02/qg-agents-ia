import { lookFor, type Look } from './sprites';

// Les personnages en 3D (v2) : de vrais petits corps en cubes, dans les couleurs des portraits (sprites.ts).
// Tout est en « pixels » de personnage (U) : x vers sa gauche, y vers le haut, z devant lui. Les pieds sont à y = 0.
// Cinq morceaux : le tronc (buste, tête, cheveux, visage, accessoires), deux bras et deux jambes qui pivotent.

/** Un pixel de personnage, en cases du plan : il mesure ≈ 0,78 case, comme le sprite d'origine. */
export const U = 0.038;
export type Cube = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; c: string };
const k = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string): Cube => ({ x0, x1, y0, y1, z0, z1, c });

/** Les repères du corps. */
export const HANCHE = 5.5, EPAULE: [number, number] = [4.6, 11.5], ECART_JAMBES = 1.9, HAUT_TETE = 19.5;
const INK = '#1d1b2e';

function fonce(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16), v = (x: number) => Math.max(0, Math.min(255, Math.round(x * f))).toString(16).padStart(2, '0');
  return `#${v(n >> 16)}${v((n >> 8) & 255)}${v(n & 255)}`;
}

/** Ce que chaque personnage a en plus, d'après son portrait : sur le tronc, et parfois dans la main. */
type Plus = { tronc?: Cube[]; main?: Cube[]; sansCheveux?: boolean; chevelure?: Cube[] };
const yeux = (c = INK) => [k(-2.3, -1.1, 15, 16.7, 3.5, 3.7, c), k(1.1, 2.3, 15, 16.7, 3.5, 3.7, c)];
const bandeau = (c: string, y0: number, y1: number) => [k(-4.15, 4.15, y0, y1, -3.65, 3.75, c)];
const objet = (c: string, w = 2, h = 2.4, c2?: string): Cube[] => [k(-w / 2, w / 2, -7.6, -7.6 + h, 0.6, 2.2, c), ...(c2 ? [k(-w / 4, w / 4, -7.2, -6.6, 2.2, 2.4, c2)] : [])];

const PLUS: Record<string, Plus> = {
  // Kuroro : le col de fourrure blanc, la croix sur le front
  kuroro: { tronc: [k(-4.3, 4.3, 11.4, 12.9, -2.6, 2.6, '#f2efe8'), k(-0.3, 0.3, 17, 19, 3.5, 3.7, INK), k(-1, 1, 17.8, 18.4, 3.5, 3.7, INK)] },
  // Stalker : le casque, la visière verte, un voyant bleu sur la poitrine
  stalker: { tronc: [k(-4.4, -3.9, 13.5, 19, -1.5, 1.5, '#4a4d57'), k(3.9, 4.4, 13.5, 19, -1.5, 1.5, '#4a4d57'), k(-3.4, 3.4, 15.2, 16.4, 3.5, 3.9, '#38f28a'), k(-0.8, 0.8, 8.6, 10, 2, 2.2, '#3b82f6')] },
  // Obito : le masque orange à un seul œil, le col violet
  obito: { tronc: [k(1, 2.2, 15.2, 16.4, 3.5, 3.7, INK), k(-3, -1, 17, 17.6, 3.5, 3.65, '#c7661a'), k(-2.4, 0, 13.6, 14.2, 3.5, 3.65, '#c7661a'), k(-4.2, 4.2, 11.4, 12.4, -2.4, 2.4, '#5b3a8c')] },
  // L : les cheveux en bataille, les cernes
  L: {
    tronc: [k(-3, -1, 14.4, 14.9, 3.5, 3.65, '#c9aab4'), k(1, 3, 14.4, 14.9, 3.5, 3.65, '#c9aab4'), k(-0.8, 0.8, 8.4, 10, 2, 2.2, '#2b6fd6'),
      k(-5, -3.8, 18, 21.4, -1, 1, '#121212'), k(3.6, 4.8, 18.4, 21, -2, 0, '#121212'), k(-2, -0.8, 20, 22, 0, 1.4, '#121212'), k(1, 2.4, 20, 21.8, -1.6, 0, '#121212'), k(-0.6, 0.8, 20, 21.4, -3.4, -2, '#121212')],
    main: objet('#ff5fa2', 1.6, 1.6),
  },
  // Light : le col blanc, la cravate rouge, le carnet noir
  light: { tronc: [k(-1.6, 1.6, 11.2, 12.2, 1.9, 2.3, '#ffffff'), k(-0.5, 0.5, 7.4, 11.4, 2, 2.3, '#dd3333')], main: objet(INK, 2.2, 3) },
  // Mafe : la grande coiffure afro, la tasse blanche
  mafe: { chevelure: [k(-5.4, 5.4, 17.4, 22.6, -4.8, 4.2, '#1d1b2e'), k(-4.6, 4.6, 14, 18, -4.6, -2.6, '#1d1b2e')], main: objet('#ffffff', 1.8, 2) },
  // Luffy : le chapeau de paille au ruban rouge, la cicatrice, le gilet ouvert
  luffy: {
    tronc: [k(-6.4, 6.4, 19.2, 20, -6, 6, '#f2d26b'), k(-4.3, 4.3, 20, 22.4, -3.9, 3.9, '#f2d26b'), k(-4.4, 4.4, 20, 20.8, -4, 4, '#dd3333'),
      k(-3, -1.8, 14.2, 14.8, 3.5, 3.65, '#aa3333'), k(-1, 1, 6.5, 11.6, 2, 2.2, '#f3d2b3')],
  },
  // Zoro : la ceinture verte, le sabre au côté
  zoro: { tronc: [k(-3.9, 3.9, 5.5, 7, -2.3, 2.3, '#2f8a48'), k(4.6, 5.2, 2, 11, -3.4, -2.6, '#c0392b'), k(4.5, 5.3, 10.6, 12.4, -3.5, -2.5, '#2a2a36')] },
  // Isaac : les perles dorées dans les cheveux, la clé à la main
  isaac: { tronc: [-3, 0, 2.6].map(x => k(x - 0.5, x + 0.5, 18.6, 19.6, 3.6, 4, '#e2b13c')), main: objet('#8a8f98', 1.4, 3) },
  // Léa : les lunettes, la queue de cheval, le stylo rouge
  lea: { tronc: [k(-3.2, 3.2, 15.2, 16.2, 3.5, 3.8, INK), k(-1.2, 1.2, 13, 18.6, -5.4, -4, '#c8622e'), k(-1, 1, 10.5, 13, -5, -4, '#c8622e')], main: objet('#dd3333', 0.8, 3) },
  // Feu : la casquette au logo jaune, les cordons du sweat, le petit écran de cours
  feu: {
    tronc: [k(-4.3, 4.3, 18.6, 20.8, -3.9, 3.9, '#1d1b2e'), k(-3.6, 3.6, 18.6, 19.2, 3.9, 6, '#1d1b2e'), k(-0.9, 0.9, 19.2, 20.2, 3.9, 4.1, '#F0B90B'),
      k(-1.8, -1.2, 8.4, 11.4, 2, 2.2, '#F0B90B'), k(1.2, 1.8, 8.4, 11.4, 2, 2.2, '#F0B90B'), k(-4.2, 4.2, 11.2, 12.2, -2.5, 2.5, '#3a3a48')],
    sansCheveux: true, main: objet(INK, 2.4, 3, '#3dbb5a'),
  },
  // Paul : le classeur bleu sous le bras
  paul: { main: objet('#3b82f6', 2.2, 3.2, '#e8b04a') },
  // Ye : le bandeau blanc, les lunettes noires, la chaîne dorée
  ye: { tronc: [...bandeau('#f4f4f4', 17.2, 18.2), k(-3.3, 3.3, 14.6, 16.4, 3.5, 3.9, INK), k(-1.6, 1.6, 9.6, 10.4, 2, 2.25, '#d4a531')] },
  // Malenia : le casque doré ailé, les longues mèches rouges
  malenia: {
    tronc: [k(-4.3, 4.3, 18.4, 20.8, -3.8, 3.9, '#d4a531'), k(-6, -4.3, 19.4, 21.6, -1, 1, '#d4a531'), k(4.3, 6, 19.4, 21.6, -1, 1, '#d4a531'),
      k(-4.6, -3.6, 4, 15, -4.2, -2.4, '#a32020'), k(3.6, 4.6, 4, 15, -4.2, -2.4, '#a32020'), k(-3.6, 3.6, 7, 17, -4.4, -3.4, '#c0392b')],
    sansCheveux: true,
  },
  // Tom : le bonnet rouge
  tom: { tronc: [k(-4.3, 4.3, 17.8, 21, -3.9, 3.9, '#d94b3b'), k(-0.8, 0.8, 21, 22, -0.8, 0.8, '#d94b3b'), k(-1, 1, 8.6, 10, 2, 2.2, '#9fd3ff')], sansCheveux: true },
  // Clara : le chignon, des feuilles à la main
  clara: { tronc: [k(-1.6, 1.6, 20.4, 22.6, -2.4, 0.6, '#2b1d16')], main: objet('#f4f1ea', 2.4, 2.8) },
  // Sam : le bandeau blanc, le testeur sur la poitrine
  sam: { tronc: [...bandeau('#f4f4f4', 17, 17.9), k(-1.2, 1.2, 7.6, 10, 2, 2.25, INK), k(-0.4, 0.4, 8.6, 9.4, 2.25, 2.35, '#3dbb5a')] },
};

export type Corps = { tronc: Cube[]; brasG: Cube[]; brasD: Cube[]; jambeG: Cube[]; jambeD: Cube[] };

/** Le corps d'un personnage. Les bras et les jambes sont donnés autour de leur pivot (l'épaule, la hanche). */
export function corps(cle: string): Corps {
  const l: Look = lookFor(cle), plus = PLUS[cle] ?? {};
  const manche = fonce(l.top, 0.88), chaussure = fonce(l.legs, 0.55);
  const tronc: Cube[] = [
    k(-3.6, 3.6, HANCHE, 12, -2, 2, l.top),                      // le buste
    k(-4, 4, 12, HAUT_TETE, -3.5, 3.5, l.skin),                  // la tête
  ];
  if (!plus.sansCheveux) tronc.push(...(plus.chevelure ?? [
    k(-4.2, 4.2, 18.4, 20.4, -3.7, 3.7, l.hair),                 // le dessus
    k(-4.2, 4.2, 14, 18.4, -3.8, -2.6, l.hair),                  // l'arrière
    k(-4.2, -3.7, 16, 18.4, -2.6, 1.6, l.hair), k(3.7, 4.2, 16.6, 18.4, -2.6, 1.6, l.hair), // les côtés
  ]));
  if (!l.noEyes) tronc.push(...yeux());
  tronc.push(...(plus.tronc ?? []));
  const bras = (main?: Cube[]): Cube[] => [k(-1, 1, -4.6, 0.5, -1.4, 1.4, manche), k(-0.9, 0.9, -6.4, -4.6, -1.2, 1.2, l.skin), ...(main ?? [])];
  const jambe = (): Cube[] => [k(-1.5, 1.5, -4.3, 0, -1.6, 1.6, l.legs), k(-1.5, 1.5, -HANCHE, -4.3, -1.6, 2, chaussure)];
  return { tronc, brasG: bras(plus.main), brasD: bras(), jambeG: jambe(), jambeD: jambe() };
}

/** La hauteur totale d'un personnage debout, en cases (le plus haut cube du tronc). */
export const hauteur = (cle: string) => Math.max(...corps(cle).tronc.map(c => c.y1)) * U;

/** Le cap d'un personnage assis, d'après le côté où regarde sa chaise (S = vers le bas du plan = devant lui). */
export const CAP: Record<'N' | 'S' | 'E' | 'W', number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

/** L'angle le plus court de `de` vers `a`, parcouru d'une fraction `t`. */
export function versAngle(de: number, a: number, t: number): number {
  const d = Math.atan2(Math.sin(a - de), Math.cos(a - de));
  return de + d * t;
}
