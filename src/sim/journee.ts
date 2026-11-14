// La journée qui vit (demande du 11 novembre 2026 : « dans l'après-midi on n'a pas la même énergie »).
// Fonctions pures, à l'heure d'Abidjan (UTC, sans heure d'été) : le moment de la journée, son énergie, l'heure
// d'arrivée et de départ de chacun (la même à chaque rechargement), les relances du couloir et les petits échanges
// entre collègues. Le moteur (engine.ts) s'en sert en « Moment calme » ; « Pleine journée » n'en dépend pas.

export type MomentJour = 'arrivees' | 'matinee' | 'dejeuner' | 'creux' | 'reprise' | 'departs' | 'nuit';

const H = (h: number, m = 0) => h * 60 + m;
const JOUR_MIN = 1440, JOUR_MS = 86_400_000;
const norm = (m: number) => ((m % JOUR_MIN) + JOUR_MIN) % JOUR_MIN;

/** Le début de chaque moment de jour ; à 20:00, la nuit (le bureau ferme, horaire.ts). */
export const BORNES: readonly { moment: Exclude<MomentJour, 'nuit'>; debut: number }[] = [
  { moment: 'arrivees', debut: H(7) },
  { moment: 'matinee', debut: H(8, 30) },
  { moment: 'dejeuner', debut: H(12) },
  { moment: 'creux', debut: H(13, 30) },
  { moment: 'reprise', debut: H(15) },
  { moment: 'departs', debut: H(17, 30) },
];
export const FIN_DE_JOURNEE = H(20);

/** Le moment de la journée à cette minute (minutes depuis minuit UTC). */
export function momentA(minutesUTC: number): MomentJour {
  const m = norm(minutesUTC);
  if (m < BORNES[0].debut || m >= FIN_DE_JOURNEE) return 'nuit';
  let r: MomentJour = 'nuit';
  for (const b of BORNES) if (m >= b.debut) r = b.moment;
  return r;
}

/**
 * L'énergie d'un moment, pour la page privée (la démo, plus vive, l'amplifie de moitié) :
 * `marcheurs` au plus en vadrouille, `course` la chance de partir en course quand on a fini d'attendre,
 * `vitesse` de marche (1 = normale), `attente` au poste (secondes), `bulle` la chance de dire ce qu'on fait,
 * `bavardage` l'écart moyen (secondes) entre deux petits échanges entre collègues.
 */
export type Energie = { marcheurs: number; course: number; vitesse: number; attente: [number, number]; bulle: number; bavardage: number };

export const ENERGIES: Record<MomentJour, Energie> = {
  arrivees: { marcheurs: 2, course: 0.2, vitesse: 1, attente: [8, 18], bulle: 0.15, bavardage: 16 },
  // la pleine énergie du matin : le comportement « calme » d'avant
  matinee: { marcheurs: 4, course: 0.4, vitesse: 1, attente: [5, 14], bulle: 0.3, bavardage: 12 },
  dejeuner: { marcheurs: 2, course: 0.15, vitesse: 0.9, attente: [10, 20], bulle: 0.25, bavardage: 9 },
  // le coup de mou : on bouge peu, on marche lentement, on reste longtemps assis, on parle rarement
  creux: { marcheurs: 1, course: 0.1, vitesse: 0.6, attente: [18, 35], bulle: 0.06, bavardage: 55 },
  reprise: { marcheurs: 3, course: 0.28, vitesse: 0.9, attente: [7, 18], bulle: 0.2, bavardage: 18 },
  departs: { marcheurs: 2, course: 0.15, vitesse: 1, attente: [8, 20], bulle: 0.12, bavardage: 20 },
  nuit: { marcheurs: 0, course: 0, vitesse: 1, attente: [30, 60], bulle: 0, bavardage: Infinity },
};

/** D'un moment de jour au suivant, l'énergie change en douceur sur 20 minutes (10 de part et d'autre de la borne). */
export const TRANSITION = 10;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function energieA(minutesUTC: number): Energie {
  const m = norm(minutesUTC);
  const ici = ENERGIES[momentA(m)];
  for (let i = 1; i < BORNES.length; i++) {
    const b = BORNES[i].debut;
    if (Math.abs(m - b) >= TRANSITION) continue;
    const A = ENERGIES[BORNES[i - 1].moment], B = ENERGIES[BORNES[i].moment];
    const t = (m - (b - TRANSITION)) / (2 * TRANSITION);
    return {
      marcheurs: mix(A.marcheurs, B.marcheurs, t), course: mix(A.course, B.course, t), vitesse: mix(A.vitesse, B.vitesse, t),
      attente: [mix(A.attente[0], B.attente[0], t), mix(A.attente[1], B.attente[1], t)],
      bulle: mix(A.bulle, B.bulle, t), bavardage: mix(A.bavardage, B.bavardage, t),
    };
  }
  return ici;
}

// ── Les arrivées et les départs : un tirage fixe par personnage et par jour (hash de l'id et de la date)

/** Un nombre de [0, 1[ tiré de la chaîne (FNV-1a 32 bits) : toujours le même pour la même chaîne. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  // un dernier mélange : des chaînes voisines (« fig1 », « fig2 ») donnent des nombres bien différents
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32;
}

/** Le jour (UTC) de l'instant : un numéro, le même de 00:00 à 23:59. */
export const jourDe = (ms: number) => Math.floor(ms / JOUR_MS);
/** Les minutes depuis minuit UTC, avec les secondes (fraction). */
export const minutesPrecises = (ms: number) => ((((ms % JOUR_MS) + JOUR_MS) % JOUR_MS)) / 60_000;

export const ARRIVEE_MIN = H(7), ARRIVEE_MAX = H(8, 30);
export const DEPART_MIN = H(17, 30), DEPART_MAX = H(19, 45);

/** L'heure d'arrivée (minutes UTC, avec fraction) : entre 07:00 et 08:30. */
export const heureArrivee = (id: string, jour: number) => ARRIVEE_MIN + hash01(`${id}|${jour}|arrivee`) * (ARRIVEE_MAX - ARRIVEE_MIN);
/** L'heure de départ (minutes UTC, avec fraction) : entre 17:30 et 19:45. */
export const heureDepart = (id: string, jour: number) => DEPART_MIN + hash01(`${id}|${jour}|depart`) * (DEPART_MAX - DEPART_MIN);

/** Environ la moitié déjeune à la Cuisine ou en salle de pause ; les autres restent à leur bureau. */
export const dejeuneDehors = (id: string, jour: number) => hash01(`${id}|${jour}|dejeuner`) < 0.5;
/** On part manger entre 12:00 et 12:25, on revient entre 13:05 et 13:25. */
export function heuresDuRepas(id: string, jour: number) {
  return { va: H(12) + hash01(`${id}|${jour}|va`) * 25, revient: H(13, 5) + hash01(`${id}|${jour}|revient`) * 20 };
}

// ── Le panneau Réglages

export const TITRES: Record<MomentJour, { titre: string; detail: string }> = {
  arrivees: { titre: 'Matin · les arrivées', detail: 'ils arrivent un par un' },
  matinee: { titre: 'Matinée · plein régime', detail: 'ça bouge, ça parle, réunions' },
  dejeuner: { titre: 'Midi · la pause déjeuner', detail: 'cuisine et salle de pause pleines' },
  creux: { titre: "Début d'après-midi · le coup de mou", detail: 'chacun reste à son poste' },
  reprise: { titre: 'Après-midi · ça repart', detail: 'petite pause café vers 16 h' },
  departs: { titre: 'Fin de journée · les départs', detail: 'ils partent petit à petit' },
  nuit: { titre: 'Nuit · bureau fermé', detail: 'seuls ceux qui travaillent vraiment restent' },
};

// ── Ce qu'on entend

/** Les bulles du déjeuner : on parle d'autre chose que du travail. */
export const BULLES_DEJEUNER = [
  'on mange quoi ?', 'attiéké poisson ?', 'il fait chaud aujourd\'hui', 'garba ou alloco ?', 'qui descend au maquis ?',
  'y\'a encore du jus de bissap ?', 'le foot ce soir, tu regardes ?', 'je reprends un peu de riz', 'c\'est pimenté hein', 'on se pose dehors ?',
];
export const BONJOURS = ['bonjour !', 'bonjour tout le monde', 'salut, bien ou bien ?', 'bonne journée à tous'];
export const AU_REVOIRS = ['bonne soirée !', 'à demain !', 'je file, à demain', 'on se voit demain'];

/** La pause café de 16 h : entre 15:50 et 16:15. */
export const pauseCafe = (minutesUTC: number) => { const m = norm(minutesUTC); return m >= H(15, 50) && m < H(16, 15); };

/** Les relances du couloir (avant : « pause café dans 5 min ? » toutes les 18 s) : selon le moment, rares l'après-midi. */
export function relanceA(minutesUTC: number): { textes: string[]; intervalle: number } {
  if (pauseCafe(minutesUTC)) return { textes: ['pause café de 16 h ?', 'on descend au café ?'], intervalle: 30 };
  switch (momentA(minutesUTC)) {
    case 'arrivees': return { textes: ['bonjour !', 'le café est prêt ?', 'y\'a du monde ce matin'], intervalle: 30 };
    case 'matinee': return { textes: ['réunion dans 10 min ?', 'pause café dans 5 min ?', 'tu passes me voir ?'], intervalle: 25 };
    case 'dejeuner': return { textes: ['on mange quoi ?', 'qui vient au maquis ?', 'il fait chaud aujourd\'hui'], intervalle: 30 };
    case 'creux': return { textes: ['un café pour se réveiller ?', 'dur, l\'après-midi…'], intervalle: 120 };
    case 'reprise': return { textes: ['on finit ça avant 18 h ?', 'ça avance de ton côté ?'], intervalle: 75 };
    case 'departs': return { textes: ['bonne soirée !', 'à demain !'], intervalle: 45 };
    default: return { textes: [], intervalle: 60 };
  }
}

/**
 * Les petits échanges entre deux collègues proches (demande du 11 novembre) : 2 à 4 répliques qui alternent
 * (A, B, A, B). Du bavardage d'ambiance seulement : personne n'y affirme avoir fait ou trouvé un vrai travail
 * (règle « rien de faux qui semble réel » : un vrai agent peut y prendre part dans /demo sans rien inventer).
 */
export const ECHANGES: Record<Exclude<MomentJour, 'nuit'>, string[][]> = {
  arrivees: [
    ['bien dormi ?', 'pas assez…'],
    ['y\'a embouteillage à Plateau ce matin', 'comme d\'hab', 'j\'ai mis une heure'],
    ['bonjour ! ça va ?', 'ça va bien, et toi ?', 'on est là'],
    ['t\'as pris le gbaka ?', 'non, woro-woro'],
    ['le café est déjà prêt ?', 'pas encore, j\'arrive'],
    ['il pleut à Yopougon', 'ici c\'est sec', 'ça va venir'],
    ['t\'as pris ton petit-déj ?', 'un pain beurre en route'],
  ],
  matinee: [
    ['t\'as vu la nouvelle maquette ?', 'oui, elle est belle', 'on la montre à 11 h ?'],
    ['réunion à 10 h ?', 'je viens', 'je prends mon café d\'abord'],
    ['j\'ai une idée pour le tableau', 'vas-y, raconte', 'après le café'],
    ['tu peux m\'aider deux minutes ?', 'j\'arrive'],
    ['un café ?', 'avec plaisir', 'je te suis'],
    ['on garde le bleu ou le orange ?', 'le orange, sans hésiter'],
    ['c\'est calme ce matin', 'profitons-en'],
  ],
  dejeuner: [
    ['on mange quoi ?', 'attiéké poisson ?', 'garba même'],
    ['il fait chaud hein', 'chaud chaud', 'un jus de bissap ?'],
    ['alloco ce midi ?', 'avec du poulet braisé', 'c\'est parti'],
    ['qui descend au maquis ?', 'moi !', 'attends-moi'],
    ['t\'as goûté le foutou d\'hier ?', 'trop bon', 'on y retourne vendredi'],
    ['le foot ce soir ?', 'les Éléphants jouent ?', 'oui, à 20 h'],
    ['c\'est pimenté ça', 'c\'est comme ça qu\'on aime'],
  ],
  creux: [
    ['j\'ai sommeil…', 'encore un café ?'],
    ['il fait lourd', 'la clim est en panne ?'],
    ['la sieste me manque', 'tiens bon'],
    ['trop mangé à midi…', 'pareil'],
    ['c\'est long l\'après-midi', 'à qui le dis-tu'],
    ['un café ?', 'deux même'],
  ],
  reprise: [
    ['on finit ça avant 18 h ?', 'on peut', 'allez'],
    ['pause café à 16 h ?', 'je suis partant'],
    ['ça avance ?', 'petit à petit', 'courage'],
    ['tu restes tard ce soir ?', 'non, je pars à l\'heure'],
    ['ça va mieux après le café', 'carrément'],
    ['on se fait un point rapide ?', 'dans 5 min'],
  ],
  departs: [
    ['à demain !', 'bonne soirée'],
    ['tu rentres comment ?', 'en gbaka', 'bon courage'],
    ['bonne soirée !', 'à toi aussi', 'repose-toi bien'],
    ['y\'a embouteillage sur le pont ?', 'comme tous les soirs'],
    ['on se voit demain ?', 'à 8 h pile'],
    ['je file, à demain', 'à demain !'],
  ],
};

/** Les échanges possibles à cette minute (aucun la nuit). */
export function echangesA(minutesUTC: number): string[][] {
  const m = momentA(minutesUTC);
  return m === 'nuit' ? [] : ECHANGES[m];
}
