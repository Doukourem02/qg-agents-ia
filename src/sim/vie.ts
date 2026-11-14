import { POI, type Pt } from '@/data/layout';
import { BASKET, FOOT, PANIERS } from '@/scene/paysage';
import { findPath } from './path';
import { dejeuneDehors, hash01, heureArrivee, heureDepart } from './journee';

// Tout ce qu'on voit sert vraiment (demande du 12 novembre 2026 : « tout ce que tu vois doit être exploitable ») :
// le programme de la journée de chacun, en fonctions pures, tiré une fois par jour (le même à chaque rechargement).
// Les toilettes (2 à 3 fois par jour, une personne par cabine), le match du soir après le travail, les paniers de midi,
// la sieste au hamac, l'arrosage du potager, un café à deux en salle à manger, un point avec Kuroro sur le canapé de la
// Direction, ceux qui viennent en voiture ou à moto ; le week-end, moins de monde et les matchs du samedi.
// C'est la vie simulée de l'open space (« Moment calme ») : jamais du travail. Le moteur (engine.ts) l'exécute ; un vrai
// agent en vraie tâche reste à son poste, une vraie réunion de crise passe avant.

const H = (h: number, m = 0) => h * 60 + m;
const JOUR_MS = 86_400_000;

// ── Le jour de la semaine

export type TypeJour = 'semaine' | 'samedi' | 'dimanche';
/** Le type du jour (UTC, l'heure d'Abidjan) : samedi, dimanche, ou un jour de semaine. */
export function typeDeJour(jour: number): TypeJour {
  const d = new Date(jour * JOUR_MS).getUTCDay();
  return d === 6 ? 'samedi' : d === 0 ? 'dimanche' : 'semaine';
}
export const weekEnd = (jour: number) => typeDeJour(jour) !== 'semaine';

/** Le week-end, environ un tiers vient au bureau ; arrivée entre 09:00 et 10:00, départ entre 15:30 et 17:30. */
export const PART_DU_WEEK_END = 1 / 3;
export const vientLeWeekEnd = (id: string, jour: number) => hash01(`${id}|${jour}|weekend`) < PART_DU_WEEK_END;
export const arriveeWeekEnd = (id: string, jour: number) => H(9) + hash01(`${id}|${jour}|arrivee`) * 60;
export const departWeekEnd = (id: string, jour: number) => H(15, 30) + hash01(`${id}|${jour}|depart`) * 120;

// ── Les lieux du dehors

/** Les quatre cabines des toilettes (layout.ts) : devant la porte, et dedans (on n'y voit personne, la porte est fermée). */
export const CABINES_WC = [0, 1, 2, 3].map(i => {
  const x = 32.25 + i * 1.17 + 0.56;
  return { devant: [x, 2.05] as Pt, dedans: [x, 0.95] as Pt };
});

/** Les places du parking où l'on gare (à côté de la voiture, du taxi, des trois motos, du range-vélos). */
export const VEHICULES: Pt[] = [[31.75, 34.2], [36.15, 34.2], [27.5, 34.25], [28.35, 34.35], [38.25, 34.2], [27.6, 32.55]];
/** La sortie du parking, vers la route : ceux qui viennent à pied pour un match du week-end arrivent par là. */
export const ROUTE: Pt = [39.8, 35.9];
/** Le hamac, entre les deux cocotiers : au milieu de la toile, là où elle creuse. */
export const HAMAC: Pt = [42.4, 16.2];
/**
 * Le potager : on y entre par le chemin entre le mur et les bacs, puis on arrose entre les rangs (on s'arrête aux points
 * `arrose`) ; pour changer de rang, on repasse par le chemin de gauche (on ne marche pas dans les bacs).
 */
export const TOUR_DU_POTAGER: { p: Pt; arrose?: boolean }[] = [6.68, 4.62, 2.57].flatMap(y => [
  { p: [40.6, y] as Pt }, { p: [42.4, y] as Pt, arrose: true }, { p: [44.5, y] as Pt, arrose: true }, { p: [40.6, y] as Pt },
]);
/** Le canapé de la Direction (un point avec Kuroro) et une table de la salle à manger (un café à deux). */
export const CANAPE_DIRECTION: Pt[] = POI.canapeDirection;
export const TABLES_CAFE_A_DEUX: Pt[][] = POI.cafeADeux;

// Le chemin du dehors : un U de pavés autour du bâtiment (l'allée de gauche, l'allée de devant, l'allée de droite). On
// y entre par la porte (POI.entree) ; chaque lieu du dehors s'y raccorde par un petit bout de chemin.
const XG = -0.75, YD = 30.45, XD = 39.5, Y_HAUT_G = 11, Y_HAUT_D = 10.6;
const S_COIN_G = YD - Y_HAUT_G, S_COIN_D = S_COIN_G + (XD - XG), S_FIN = S_COIN_D + (YD - Y_HAUT_D);
/** Le point du U à l'abscisse curviligne s. */
function pointU(s: number): Pt {
  if (s <= S_COIN_G) return [XG, Y_HAUT_G + s];
  if (s <= S_COIN_D) return [XG + (s - S_COIN_G), YD];
  return [XD, YD - (s - S_COIN_D)];
}
/** Le chemin le long du U, de s1 à s2 (les coins en chemin, puis l'arrivée). */
function longU(s1: number, s2: number): Pt[] {
  const out: Pt[] = [];
  for (const c of s1 < s2 ? [S_COIN_G, S_COIN_D] : [S_COIN_D, S_COIN_G]) if ((c - s1) * (c - s2) < 0) out.push(pointU(c));
  out.push(pointU(s2));
  return out;
}
const sG = (y: number) => y - Y_HAUT_G, sAvant = (x: number) => S_COIN_G + (x - XG), sD = (y: number) => S_COIN_D + (YD - y);

type Zone = { nom: 'porte' | 'foot' | 'basket' | 'parking' | 'hamac' | 'potager'; s: number; approche: (p: Pt) => Pt[] };
const ALLEE_PARKING = 32.7;
const ZONES: Record<Zone['nom'], Zone> = {
  porte: { nom: 'porte', s: sAvant(POI.entree[0]), approche: () => [POI.entree] },
  foot: { nom: 'foot', s: sG(11.2), approche: () => [[-1.7, 11.2]] },
  basket: { nom: 'basket', s: sG(19.6), approche: () => [[-1.7, 19.6]] },
  parking: { nom: 'parking', s: sAvant(30.7), approche: p => [[30.7, ALLEE_PARKING], [p[0] > 39.3 ? 39.8 : p[0], ALLEE_PARKING]] },
  hamac: { nom: 'hamac', s: sD(HAMAC[1]), approche: () => [[41.6, HAMAC[1]]] },
  potager: { nom: 'potager', s: S_FIN, approche: p => [[39.6, 8.75], [40.6, 8.75], [40.6, p[1]]] },
};
/** Dedans (le bâtiment), dans une zone du dehors, ou sur le U lui-même. */
export function zoneDe(p: Pt): Zone | 'dedans' | { nom: 'u'; s: number } {
  const [x, y] = p;
  if (x >= -0.3 && x <= 39.2 && y >= -0.3 && y <= 30.05) return 'dedans';
  if (x < -1.3) return y < (FOOT.y + FOOT.d + BASKET.y) / 2 ? ZONES.foot : ZONES.basket;
  if (x <= -0.3) return { nom: 'u', s: sG(Math.max(Y_HAUT_G, Math.min(YD, y))) };
  if (y > 31) return ZONES.parking;
  if (x > 40.1 && y < 10.3) return ZONES.potager;
  if (x > 40.1) return ZONES.hamac;
  if (x >= 39.2) return { nom: 'u', s: sD(Math.max(Y_HAUT_D, Math.min(YD, y))) };
  return { nom: 'u', s: sAvant(Math.max(XG, Math.min(XD, x))) };
}
export const dehors = (p: Pt) => zoneDe(p) !== 'dedans';

/**
 * Le chemin de `de` à `a`, dedans comme dehors : dans le bâtiment, la grille (path.ts) ; pour sortir, jusqu'à la porte,
 * puis le U et le petit bout de chemin du lieu ; pour rentrer, l'inverse. Renvoie [] si le chemin du dedans n'existe pas.
 */
export function chemin(de: Pt, a: Pt): Pt[] {
  const zd = zoneDe(de), za = zoneDe(a);
  if (zd === 'dedans' && za === 'dedans') return findPath(de, a);
  const out: Pt[] = [];
  let s: number;
  if (zd === 'dedans') {
    const p = findPath(de, POI.entree);
    if (!p.length) return [];
    out.push(...p);
    s = ZONES.porte.s;
    out.push(pointU(s));
  } else if (zd.nom === 'u') s = zd.s;
  else {
    if (za !== 'dedans' && za.nom === zd.nom) return [a]; // dans le même lieu : tout droit
    out.push(...zd.approche(de).slice().reverse(), pointU(zd.s));
    s = zd.s;
  }
  if (za === 'dedans') {
    out.push(...longU(s, ZONES.porte.s), POI.entree);
    const p = findPath(POI.entree, a);
    if (!p.length) return [];
    out.push(...p);
  } else if (za.nom === 'u') out.push(...longU(s, za.s));
  else out.push(...longU(s, za.s), ...za.approche(a), a);
  return out;
}

// ── Les terrains : les places des joueurs

export type Sport = 'foot' | 'basket';
export type Terrain = { x: number; y: number; w: number; d: number };
export const TERRAINS: Record<Sport, Terrain> = { foot: FOOT, basket: BASKET };
/** Les buts du foot (le centre de la ligne de but) et les arceaux du basket : en haut (côté y) puis en bas. */
export const CIBLES: Record<Sport, [number, number, number][]> = {
  foot: [[FOOT.x + FOOT.w / 2, FOOT.y + 0.05, 0.3], [FOOT.x + FOOT.w / 2, FOOT.y + FOOT.d - 0.05, 0.3]],
  basket: PANIERS,
};

/**
 * La place de base d'un joueur (en fraction du terrain : u en travers, v le long) : l'équipe 0 défend le haut (v = 0),
 * l'équipe 1 le bas. Au foot, le premier de chaque équipe garde les buts.
 */
export function placeDeBase(sport: Sport, equipe: 0 | 1, rang: number): [number, number] {
  const foot = sport === 'foot';
  const places: [number, number][] = foot
    ? [[0.5, 0.07], [0.28, 0.3], [0.72, 0.3], [0.5, 0.48], [0.35, 0.62], [0.65, 0.62]]
    : [[0.3, 0.32], [0.7, 0.32], [0.5, 0.55], [0.22, 0.6], [0.78, 0.6]];
  const [u, v] = places[rang % places.length];
  return equipe === 0 ? [u, v] : [1 - u, 1 - v];
}
/** Les paniers de midi : autour de l'arceau du bas, à distance de tir. */
export const PLACES_PANIERS: [number, number][] = [[0.25, 0.78], [0.75, 0.8], [0.5, 0.66]];
export const versTerrain = (t: Terrain, [u, v]: [number, number]): Pt => [t.x + u * t.w, t.y + v * t.d];

// ── Le programme de la journée

export type Activite =
  | { type: 'toilettes'; cabine: number }
  | { type: 'match'; cle: string; sport: Sport; equipe: 0 | 1; rang: number }
  | { type: 'paniers'; cle: string; rang: number }
  | { type: 'hamac' }
  | { type: 'arrosage' }
  | { type: 'rdv'; lieu: 'salle' | 'direction'; place: Pt; avec: string; cle: string };
export type Creneau = { id: string; debut: number; fin: number; act: Activite };
export type Match = { cle: string; sport: Sport; debut: number; fin: number; joueurs: string[] };
export type Presence = { arrivee: number; depart: number; vehicule: Pt | null; /** il ne vient que pour un match (le week-end) */ terrain: boolean };
export type PlanJour = {
  jour: number; type: TypeJour;
  /** Ceux qui viennent aujourd'hui (absents : pas dans la table). */
  presence: Map<string, Presence>;
  creneaux: Creneau[];
  parAgent: Map<string, Creneau[]>;
  matchs: Match[];
};
export type Personne = { id: string; still?: boolean; scripted?: boolean };

const tri = (ids: string[], cle: string) => [...ids].sort((a, b) => hash01(`${a}|${cle}`) - hash01(`${b}|${cle}`));

/** Le programme du jour (le même à chaque rechargement) pour ces personnes. */
export function planDuJour(jour: number, gens: readonly Personne[]): PlanJour {
  const type = typeDeJour(jour), we = type !== 'semaine';
  const presence = new Map<string, Presence>();
  for (const g of gens) {
    if (we && !vientLeWeekEnd(g.id, jour)) continue;
    presence.set(g.id, {
      arrivee: we ? arriveeWeekEnd(g.id, jour) : heureArrivee(g.id, jour),
      depart: we ? departWeekEnd(g.id, jour) : heureDepart(g.id, jour),
      vehicule: null, terrain: false,
    });
  }
  const creneaux: Creneau[] = [];
  const pris = new Map<string, [number, number][]>();
  const libre = (id: string, a: number, b: number, marge = 2) => !(pris.get(id) ?? []).some(([x, y]) => a < y + marge && b > x - marge);
  const ajoute = (c: Creneau) => { creneaux.push(c); pris.set(c.id, [...(pris.get(c.id) ?? []), [c.debut, c.fin]]); };
  // ceux qui peuvent jouer, faire la sieste, arroser : ni figurants fixes (barista, guichetier), ni agents à scénario
  const mobiles = gens.filter(g => !g.still && !g.scripted).map(g => g.id);
  const ici = (id: string) => presence.has(id);
  const k = (s: string) => `${jour}|${s}`;

  // les matchs
  const matchs: Match[] = [];
  const programme: { cle: string; sport: Sport; debut: number; fin: number; n: number }[] = [];
  if (type === 'semaine') {
    const sport: Sport = hash01(k('sport')) < 0.5 ? 'foot' : 'basket';
    programme.push({ cle: 'soir', sport, debut: H(17, 45), fin: H(19, 25), n: sport === 'foot' ? (hash01(k('n')) < 0.5 ? 8 : 10) : (hash01(k('n')) < 0.5 ? 6 : 8) });
  } else if (type === 'samedi') {
    programme.push({ cle: 'samedi-foot', sport: 'foot', debut: H(10), fin: H(12), n: 10 });
    programme.push({ cle: 'samedi-basket', sport: 'basket', debut: H(16), fin: H(18), n: 8 });
  } else {
    const sport: Sport = hash01(k('sport')) < 0.5 ? 'foot' : 'basket';
    programme.push({ cle: 'dimanche', sport, debut: H(16, 30), fin: H(18), n: 6 });
  }
  for (const p of programme) {
    // en semaine, ceux qui sont là ; le week-end, ceux qui sont là d'abord, puis des collègues qui viennent pour le match
    const candidats = tri(mobiles, k(p.cle));
    const ok = (id: string) => libre(id, p.debut - 10, p.fin + 5);
    const deLaMaison = candidats.filter(id => ici(id) && ok(id)), duDehors = candidats.filter(id => !ici(id) && ok(id));
    // (le week-end, la moitié environ vient exprès : de chez soi, en voiture ou par la route)
    const joueurs = we
      ? [...deLaMaison.slice(0, Math.ceil(p.n / 2)), ...duDehors].slice(0, p.n)
      : deLaMaison.slice(0, p.n);
    if (we && joueurs.length < p.n) joueurs.push(...deLaMaison.filter(id => !joueurs.includes(id)).slice(0, p.n - joueurs.length));
    joueurs.forEach((id, i) => {
      const venu = !presence.has(id);
      // on quitte son bureau un par un (ou on arrive du parking), on repart un par un après la fin
      const debut = p.debut - 9 + i * 0.8 + hash01(`${id}|${k(p.cle)}|d`) * 1.5;
      const fin = p.fin + hash01(`${id}|${k(p.cle)}|f`) * 8;
      if (venu) presence.set(id, { arrivee: debut, depart: fin + 0.5, vehicule: null, terrain: true });
      else {
        const pr = presence.get(id)!;
        // le soir en semaine, le match remplace le départ : on part du terrain ; le week-end, on reste après si c'est l'heure
        if (!we || pr.depart < fin + 10) pr.depart = fin + 0.5;
        if (pr.arrivee > debut - 15) pr.arrivee = debut - 15;
      }
      ajoute({ id, debut, fin, act: { type: 'match', cle: p.cle, sport: p.sport, equipe: (i % 2) as 0 | 1, rang: Math.floor(i / 2) } });
    });
    matchs.push({ cle: p.cle, sport: p.sport, debut: p.debut, fin: p.fin, joueurs });
  }

  // en voiture, à moto, à vélo (ou déposé en taxi) : une personne par véhicule
  const auParking = tri([...presence.keys()].filter(id => !gens.find(g => g.id === id)?.still), k('parking'));
  VEHICULES.forEach((v, i) => { const id = auParking[i]; if (id) presence.get(id)!.vehicule = v; });

  const presents = (ids: string[]) => ids.filter(id => ici(id) && !presence.get(id)!.terrain);
  const dispo = (id: string, a: number, b: number) => {
    const p = presence.get(id);
    return !!p && !p.terrain && a >= p.arrivee + 10 && b <= p.depart - 10 && libre(id, a, b);
  };

  // midi (en semaine) : deux ou trois font des paniers au basket ; ceux qui mangent à leur bureau
  if (!we) {
    const n = 2 + (hash01(k('paniers')) < 0.5 ? 1 : 0);
    const qui = tri(presents(mobiles), k('paniers')).filter(id => !dejeuneDehors(id, jour) && dispo(id, H(12, 5), H(12, 55))).slice(0, n);
    qui.forEach((id, i) => ajoute({ id, debut: H(12, 6) + i * 1.2, fin: H(12, 50) + i, act: { type: 'paniers', cle: 'midi', rang: i } }));
  }

  // la sieste au hamac, pendant le coup de mou (13:30 – 15:00) ; une seule personne à la fois
  const siestes: [number, number][] = we ? [[H(13, 30), H(14, 30)]] : [[H(13, 34), H(14, 14)], [H(14, 18), H(14, 58)]];
  for (const [a, b] of siestes) {
    const id = tri(presents(mobiles), k(`hamac${a}`)).find(x => dispo(x, a, b));
    if (id) ajoute({ id, debut: a, fin: b, act: { type: 'hamac' } });
  }

  // le potager : arrosé le matin à l'arrivée, ou le soir avant de partir (le week-end, en fin de matinée)
  {
    const matin = hash01(k('arrosage')) < 0.5;
    for (const id of tri(presents(mobiles), k('arrosage'))) {
      const p = presence.get(id)!;
      const [a, b] = we ? [H(10, 30), H(10, 42)] : matin ? [p.arrivee + 12, p.arrivee + 24] : [p.depart - 16, p.depart - 3];
      if (!libre(id, a, b) || a < p.arrivee + 10 || b > p.depart - 1) continue;
      ajoute({ id, debut: a, fin: b, act: { type: 'arrosage' } });
      break;
    }
  }

  // un café à deux en salle à manger (hors déjeuner), un point avec Kuroro sur le canapé de la Direction
  const rdv = (cle: string, lieu: 'salle' | 'direction', a: number, b: number, places: Pt[], imposes: string[] = []) => {
    const ids = [...imposes];
    if (!imposes.every(id => ici(id) && libre(id, a, b))) return;
    for (const id of tri(presents(mobiles), k(cle))) { if (ids.length >= 2) break; if (!ids.includes(id) && dispo(id, a, b)) ids.push(id); }
    if (ids.length < 2) return;
    ids.forEach((id, i) => ajoute({ id, debut: a + i * 0.6, fin: b, act: { type: 'rdv', lieu, place: places[i], avec: ids[1 - i], cle } }));
  };
  if (!we) {
    rdv('cafe1', 'salle', H(10, 20), H(10, 32), TABLES_CAFE_A_DEUX[0]);
    rdv('cafe2', 'salle', H(15, 22), H(15, 34), TABLES_CAFE_A_DEUX[1]);
    rdv('cafe3', 'salle', H(16, 40), H(16, 52), TABLES_CAFE_A_DEUX[2]);
    if (gens.some(g => g.id === 'kuroro')) {
      rdv('kuroro1', 'direction', H(11, 10), H(11, 22), CANAPE_DIRECTION, ['kuroro']);
      rdv('kuroro2', 'direction', H(16, 30), H(16, 42), CANAPE_DIRECTION, ['kuroro']);
    }
  } else rdv('cafe-we', 'salle', H(11), H(11, 12), TABLES_CAFE_A_DEUX[0]);

  // les toilettes : chacun deux ou trois fois (le matin, après le déjeuner, après le café de 16 h), 3 à 5 minutes ;
  // une personne par cabine (s'il n'y en a pas de libre, on y va un peu plus tard)
  const cabines: [number, number][][] = [[], [], [], []];
  const demandes: { id: string; t: number; fen: [number, number]; duree: number }[] = [];
  for (const [id, p] of presence) {
    if (p.terrain) continue;
    const h = (s: string) => hash01(`${id}|${jour}|wc|${s}`);
    const fenetres: [number, number][] = we
      ? [[p.arrivee + 25, H(12, 30)], [H(13, 30), p.depart - 20]]
      : (() => {
        const matin: [number, number] = [p.arrivee + 30, H(11, 50)], apresDej: [number, number] = [H(13, 28), H(14, 40)], cafe: [number, number] = [H(16, 15), H(17, 15)];
        if (h('n') < 0.55) return [matin, apresDej, cafe];
        return h('quoi') < 0.6 ? [apresDej, cafe] : [matin, apresDej];
      })();
    for (const [i, [a, b0]] of fenetres.entries()) {
      const b = Math.min(b0, p.depart - 15);
      if (b - a < 6) continue;
      demandes.push({ id, t: a + h(`t${i}`) * (b - a - 5), fen: [a, b], duree: 3 + h(`d${i}`) * 2 });
    }
  }
  demandes.sort((x, y) => x.t - y.t);
  for (const d of demandes) {
    for (let t = d.t; t < d.fen[1] + 30; t += 0.5) {
      if (!libre(d.id, t, t + d.duree, 3)) continue;
      const c = [0, 1, 2, 3].sort((x, y) => hash01(`${d.id}|${jour}|${t}|${x}`) - hash01(`${d.id}|${jour}|${t}|${y}`))
        .find(i => cabines[i].every(([a, b]) => t >= b + 0.2 || t + d.duree <= a - 0.2));
      if (c === undefined) continue;
      cabines[c].push([t, t + d.duree]);
      ajoute({ id: d.id, debut: t, fin: t + d.duree, act: { type: 'toilettes', cabine: c } });
      break;
    }
  }

  creneaux.sort((a, b) => a.debut - b.debut);
  const parAgent = new Map<string, Creneau[]>();
  for (const c of creneaux) parAgent.set(c.id, [...(parAgent.get(c.id) ?? []), c]);
  return { jour, type, presence, creneaux, parAgent, matchs };
}

/** Le créneau de cet agent à cette minute (ou rien). */
export function creneauA(plan: PlanJour, id: string, minutes: number): Creneau | null {
  return plan.parAgent.get(id)?.find(c => minutes >= c.debut && minutes < c.fin) ?? null;
}

// ── Ce qu'on entend (court, naturel, sans excès)

export const BULLES_VIE = {
  toilettes: ['je reviens', 'deux minutes'],
  matchFoot: ['on se fait un five ?', 'foot ce soir ?', 'qui vient au foot ?'],
  matchBasket: ['un petit basket ?', 'basket ce soir ?', 'on joue au basket ?'],
  jeu: ['passe !', 'à moi !', 'joli !', 'vas-y !', 'seul !'],
  but: ['but !', 'goaaal !', 'lucarne !'],
  panier: ['panier !', 'swish !', 'trois points !'],
  paniers: ['quelques paniers ?', 'un petit shoot avant de reprendre ?'],
  hamac: ['petite sieste au hamac', 'zzz…'],
  arrosage: ['j\'arrose le potager', 'les tomates ont soif'],
  cafeADeux: ['un café en salle à manger ?', 'on se pose deux minutes ?'],
};

/** Les échanges du café à deux et du point avec Kuroro : du bavardage d'ambiance, jamais un vrai travail. */
export const ECHANGES_RDV: Record<'salle' | 'direction', string[][]> = {
  salle: [
    ['un café ?', 'avec plaisir'],
    ['ça va depuis ce matin ?', 'tranquille', 'tant mieux'],
    ['t\'as vu le match d\'hier ?', 'trop bien', 'quel but !'],
    ['il est bon, ce café', 'c\'est le nouveau'],
    ['tu fais quoi ce week-end ?', 'repos', 'pareil'],
  ],
  direction: [
    ['on fait un petit point ?', 'vas-y'],
    ['ça va de ton côté ?', 'ça roule', 'super'],
    ['comment tu te sens cette semaine ?', 'bien, merci'],
    ['un café pendant qu\'on parle ?', 'oui, merci'],
  ],
};
