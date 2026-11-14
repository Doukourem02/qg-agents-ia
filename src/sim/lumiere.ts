// La lumière du QG suit l'heure d'Abidjan (UTC, sans heure d'été), en continu : la nuit, l'aube, le matin, le plein
// jour, la fin d'après-midi dorée, le coucher, le crépuscule. Le ciel (fond de la page), la luminosité de la scène
// (assombrie dans la scène 3D, src/scene/Lumieres.tsx, pour que les lampes et les pièces occupées y échappent) et un
// filtre (saturation, sépia) changent ; les panneaux gardent leur lumière. L'ouverture du bureau (07:00 – 20:00, src/sim/horaire.ts) ne change pas.
// Le soleil d'Abidjan en novembre : lever ≈ 06:00, coucher ≈ 18:10, à l'est le matin, au sud vers midi, à l'ouest le soir.

export type Lumiere = {
  cielHaut: string; cielMilieu: string; cielBas: string;
  /** Le filtre de la scène : brightness(), saturate(), sepia(). */
  luminosite: number; saturation: number; sepia: number;
};

const JOUR_MIN = 1440;
const norm = (m: number) => ((m % JOUR_MIN) + JOUR_MIN) % JOUR_MIN;

const NUIT: Lumiere = { cielHaut: '#1f2a52', cielMilieu: '#2f3566', cielBas: '#463f6e', luminosite: 0.62, saturation: 0.8, sepia: 0 };
const JOUR: Lumiere = { cielHaut: '#6f8fe0', cielMilieu: '#9aa3e3', cielBas: '#c3b0e2', luminosite: 1, saturation: 1, sepia: 0 };

/** Les moments de la journée, à leur minute ; entre deux, la lumière passe de l'un à l'autre en ligne droite. */
export const CLES_LUMIERE: readonly { nom: string; minute: number; lumiere: Lumiere }[] = [
  { nom: 'nuit', minute: 0, lumiere: NUIT },
  { nom: 'nuit', minute: 5 * 60 + 15, lumiere: NUIT },
  // l'aube : un bas de ciel rose orangé, le haut encore bleu nuit, le bureau encore sombre
  { nom: 'aube', minute: 5 * 60 + 45, lumiere: { cielHaut: '#2c3366', cielMilieu: '#6a5a8c', cielBas: '#d98a86', luminosite: 0.72, saturation: 0.85, sepia: 0.06 } },
  // le matin : un bleu clair et frais
  { nom: 'matin', minute: 7 * 60, lumiere: { cielHaut: '#7aa2e6', cielMilieu: '#a6c0ee', cielBas: '#e3d6ec', luminosite: 0.95, saturation: 0.95, sepia: 0 } },
  { nom: 'jour', minute: 10 * 60, lumiere: JOUR },
  { nom: 'jour', minute: 15 * 60, lumiere: JOUR },
  // la fin d'après-midi : le bas du ciel ambré, la scène un peu dorée
  { nom: 'fin d\'après-midi', minute: 16 * 60 + 30, lumiere: { cielHaut: '#6c86d8', cielMilieu: '#b0a2dc', cielBas: '#f1c193', luminosite: 1, saturation: 1.05, sepia: 0.15 } },
  // le coucher : orange en bas, violet en haut
  { nom: 'coucher', minute: 18 * 60, lumiere: { cielHaut: '#4b4c96', cielMilieu: '#b0739f', cielBas: '#f0985e', luminosite: 0.85, saturation: 1.05, sepia: 0.12 } },
  // le crépuscule : violet profond, bleu nuit
  { nom: 'crépuscule', minute: 19 * 60, lumiere: { cielHaut: '#252d62', cielMilieu: '#43397a', cielBas: '#6e4f86', luminosite: 0.72, saturation: 0.85, sepia: 0.04 } },
  { nom: 'nuit', minute: 19 * 60 + 45, lumiere: NUIT },
];

const canaux = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexa = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const melange = (a: string, b: string, t: number) => { const x = canaux(a), y = canaux(b); return hexa(x.map((v, i) => v + (y[i] - v) * t)); };
const arrondi = (v: number) => Math.round(v * 1000) / 1000;

/** La lumière à une minute de la journée (minutes depuis minuit UTC ; au-delà de 24 h, on fait le tour). */
export function lumiereA(minutesUTC: number): Lumiere {
  const m = norm(minutesUTC);
  const cles = [...CLES_LUMIERE, { ...CLES_LUMIERE[0], minute: JOUR_MIN }];
  let i = 0;
  while (i < cles.length - 2 && cles[i + 1].minute <= m) i++;
  const a = cles[i], b = cles[i + 1];
  const t = (m - a.minute) / (b.minute - a.minute);
  const A = a.lumiere, B = b.lumiere;
  return {
    cielHaut: melange(A.cielHaut, B.cielHaut, t),
    cielMilieu: melange(A.cielMilieu, B.cielMilieu, t),
    cielBas: melange(A.cielBas, B.cielBas, t),
    luminosite: arrondi(A.luminosite + (B.luminosite - A.luminosite) * t),
    saturation: arrondi(A.saturation + (B.saturation - A.saturation) * t),
    sepia: arrondi(A.sepia + (B.sepia - A.sepia) * t),
  };
}

// ── Les lumières de la nuit : elles s'allument au crépuscule et s'éteignent au matin, en suivant lumiereA.

const lisse = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** La part de nuit d'une lumière : 0 en plein jour (luminosité 1), 1 la nuit (luminosité de la nuit). */
const partDeNuit = (l: Lumiere) => Math.min(1, Math.max(0, (1 - l.luminosite) / (1 - NUIT.luminosite)));

/**
 * L'allumage des lampadaires et des pièces occupées : 0 le jour, 1 la nuit, en douceur au crépuscule (≈ 18:00 → 19:15)
 * et à l'aube (≈ 05:30 → 06:45). Ces lumières échappent à l'assombrissement de la scène.
 */
export const allumage = (l: Lumiere) => lisse(0.25, 0.8, partDeNuit(l));
/** La lune et les étoiles : seulement quand le ciel est bien sombre. */
export const astres = (l: Lumiere) => lisse(0.45, 0.95, partDeNuit(l));

// ── Le soleil (modèle simple) : azimut de 90° (est) au lever à 270° (ouest) au coucher, en passant par 180° (sud) ;
// hauteur en arc de sinus, ≈ 68° au plus haut (Abidjan, 5° N, en novembre).
export const LEVER = 6 * 60, COUCHER = 18 * 60 + 10;
const HAUTEUR_MAX = 68;

export type Soleil = { azimut: number; elevation: number; visible: boolean };

export function soleilA(minutesUTC: number): Soleil {
  const m = norm(minutesUTC);
  const f = (m - LEVER) / (COUCHER - LEVER);
  if (f <= 0 || f >= 1) return { azimut: f <= 0 ? 90 : 270, elevation: 0, visible: false };
  return { azimut: 90 + 180 * f, elevation: HAUTEUR_MAX * Math.sin(Math.PI * f), visible: true };
}

/** Au plus 4 fois la hauteur de l'objet : au ras du soleil levant, l'ombre ne traverse pas toute l'île. */
const LONGUEUR_MAX = 4;
/** L'ombre apparaît en douceur dans les 6 premiers degrés du soleil (et s'efface de même le soir). */
const FONDU = 6;

/**
 * L'ombre au sol, à l'opposé du soleil, sur le plan : x vers l'est (côté « E » des pièces), y vers le sud (côté « S »).
 * `dx, dy` : la direction de l'ombre ; `longueur` : sa longueur pour une hauteur de 1 ; `force` : 0 la nuit, 1 en plein soleil.
 */
export function ombreAuSol(minutesUTC: number) {
  const s = soleilA(minutesUTC);
  const a = (s.azimut * Math.PI) / 180;
  // vers le soleil : (sin a) à l'est, (cos a) au nord, soit -cos a en y ; l'ombre part à l'opposé
  const dx = -Math.sin(a), dy = Math.cos(a);
  if (!s.visible) return { dx, dy, longueur: 0, force: 0 };
  const longueur = Math.min(LONGUEUR_MAX, 1 / Math.tan((Math.max(s.elevation, 1) * Math.PI) / 180));
  const force = Math.min(1, s.elevation / FONDU);
  return { dx, dy, longueur, force };
}

// ── L'heure de la page

const MIN = 60_000, JOUR_MS = 24 * 60 * MIN;

/** Les minutes depuis minuit à Abidjan (UTC). */
export const minutesDe = (ms: number) => Math.floor((((ms % JOUR_MS) + JOUR_MS) % JOUR_MS) / MIN);

/** `?heure=17:20` (aperçu de /demo seulement) : les minutes, ou null si l'heure n'est pas valide. */
export function lireHeure(t: string | null | undefined): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  return h < 24 && mn < 60 ? h * 60 + mn : null;
}

/** L'instant affiché, à la minute : l'heure réelle, ou l'heure forcée du même jour (aperçu de /demo). */
export function instantAbidjan(now: number, forcee: number | null): number {
  if (forcee === null) return Math.floor(now / MIN) * MIN;
  return Math.floor(now / JOUR_MS) * JOUR_MS + forcee * MIN;
}

/** L'étiquette de l'horloge : « 17:20 · mercredi 11 novembre ». */
export function texteHorloge(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${d.toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })}`;
}

/** Les angles des aiguilles (radians, sens des aiguilles d'une montre, 0 = midi). */
export function aiguilles(minutesUTC: number) {
  const m = norm(minutesUTC);
  return { heures: ((m % 720) / 720) * Math.PI * 2, minutes: ((m % 60) / 60) * Math.PI * 2 };
}

/**
 * /demo commence en pleine énergie, en plein jour : 10:30 par défaut (journee.ts : la matinée) ; `?heure=` choisit
 * l'heure de départ. Ensuite, la démo avance en temps réel (instantDemo).
 */
export const HEURE_DEMO = 10 * 60 + 30;
export const heureDeLaDemo = (param: string | null | undefined) => lireHeure(param) ?? HEURE_DEMO;

/**
 * L'instant affiché par /demo, à la minute : l'heure de départ (`depart`, en minutes, le jour de l'ouverture de la page
 * à `debut`), plus le temps réel écoulé depuis. La lumière, les moments, les arrivées et les départs avancent avec.
 */
export function instantDemo(now: number, depart: number, debut: number, jour: number | null = null): number {
  return versLeJour(instantAbidjan(debut, depart), jour) + Math.floor(Math.max(0, now - debut) / MIN) * MIN;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** `?jour=samedi` (aperçu de /demo seulement, pour voir le week-end) : le jour de la semaine (0 = dimanche), ou null. */
export function lireJour(t: string | null | undefined): number | null {
  const i = JOURS.indexOf((t ?? '').trim().toLowerCase());
  return i < 0 ? null : i;
}
/** Le même instant, le prochain jour de la semaine voulu (ou ce jour-là s'il l'est déjà) ; sans jour, inchangé. */
export function versLeJour(ms: number, jour: number | null): number {
  if (jour === null) return ms;
  return ms + ((jour - new Date(ms).getUTCDay() + 7) % 7) * JOUR_MS;
}

/**
 * Le côté du bâtiment où se trouve un arbre (le plus éloigné des quatre bords) : le demi-plan du plan, au-delà de ce bord,
 * où son ombre a le droit d'aller. On garde les points où `nx·x + ny·y + c ≥ 0` ; aucun point du bâtiment (agrandi de
 * `marge`, l'épaisseur des murs du fond) n'y est. Ainsi une ombre ne se pose jamais sur une pièce, un mur ou un meuble.
 */
export function coteDehors(x: number, y: number, bat: { x: number; y: number; w: number; h: number; marge?: number }) {
  const m = bat.marge ?? 0;
  const ouest = bat.x - m, est = bat.x + bat.w + m, nord = bat.y - m, sud = bat.y + bat.h + m;
  const cotes = [
    { d: ouest - x, nx: -1, ny: 0, c: ouest },
    { d: x - est, nx: 1, ny: 0, c: -est },
    { d: nord - y, nx: 0, ny: -1, c: nord },
    { d: y - sud, nx: 0, ny: 1, c: -sud },
  ];
  const { nx, ny, c } = cotes.reduce((a, b) => (b.d > a.d ? b : a));
  return { nx, ny, c };
}
