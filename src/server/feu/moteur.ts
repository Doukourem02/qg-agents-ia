// Le moteur de Feu : les règles du prompt du patron (agents/Feu/CONSIGNES.md, sections 4 à 7 et 10), en code pur.
// Le code, et lui seul, dit « Signal » : les trois conditions (contexte 4h/1h, zone, déclencheur 15m) et le ratio de
// 2 pour 1 net de frais, sans règle de discipline qui l'interdise. Aucun réseau, aucune IA : tout est testé.
import { auPas, auPasHaut, closes, nomPaire, pct, pivots, prixFr, rsi, structure } from './indicateurs';
import type { Annonce, Bougie, Condition, NiveauxPaire, Oco, Paire, Plan, Regime, ReglesPaire, StatutPaire, Zone } from './types';

export const FRAIS = 0.001;
export const MINIMUM_ORDRE = 5;
export const SEUIL_STANDARD = 100;
export const PLANCHER = 6;
export const STOP_MAX_APPRENTISSAGE = 0.03;
export const RATIO_MIN = 2;
/** Une zone dépassée de plus de 1 % : c'est raté, on attend le prochain retour. */
export const DEPASSEMENT_RATE = 0.01;
export const RSI_SURACHAT = 70;
/** Le stop se pose un peu sous la zone ; la limite du stop-limit encore un peu en dessous. */
export const MARGE_STOP = 0.002;
export const MARGE_LIMITE = 0.001;
const H = 3_600_000;
/** Pas d'entrée dans l'heure avant ni l'heure après une annonce macro. */
export const FENETRE_MACRO = H;

export const regimeDe = (capital: number): Regime => (capital >= SEUIL_STANDARD ? 'standard' : 'apprentissage');

/** L'annonce macro dont la fenêtre (±1 h) contient `now`, sinon null. */
export const annonceEnCours = (annonces: readonly Annonce[], now: number) =>
  annonces.find(a => !a.aConfirmer && Math.abs(now - a.quand) <= FENETRE_MACRO) ?? null;

// ───────────── Les trois conditions ─────────────

/**
 * Condition 1 — le contexte (4h/1h) : tendance haussière (hauts et bas plus hauts en 4h, et pas baissière en 1h), ou
 * sortie confirmée : une bougie 1h a clôturé au-dessus du dernier sommet (niveau de contexte, ou dernier sommet 4h), et
 * aucune n'a recassé ce sommet de plus de 1 % depuis. Jamais d'achat contre la tendance supérieure.
 */
export function lireContexte(b4h: readonly Bougie[], b1h: readonly Bougie[], niveaux: NiveauxPaire, now: number): {
  condition: Condition; s4: ReturnType<typeof structure>; s1: ReturnType<typeof structure>; sommet: number | null; repris: number | null;
} {
  const c4 = closes(b4h, now), c1 = closes(b1h, now);
  const s4 = structure(c4), s1 = structure(c1);
  const hauts4 = pivots(c4).hauts;
  const sommet = niveaux.contexte?.prix ?? hauts4.at(-1)?.prix ?? null;
  let repris: number | null = null;
  if (sommet !== null) {
    // la première clôture 1h au-dessus du sommet, puis aucune clôture 1h sous le sommet de plus de 1 %
    for (const b of c1) {
      if (repris === null && b.c > sommet) repris = b.f;
      else if (repris !== null && b.c < sommet * (1 - DEPASSEMENT_RATE)) repris = null;
    }
    if (repris === null && niveaux.contexte?.repris && c1.length && c1.every(b => b.c >= sommet * (1 - DEPASSEMENT_RATE))) repris = niveaux.contexte.repris;
  }
  const tendance = s4 === 'haussiere' && s1 !== 'baissiere';
  const ok = tendance || repris !== null;
  const nomS = { haussiere: 'haussière', baissiere: 'baissière', range: 'en range', indeterminee: 'indéterminée' };
  const detail = ok
    ? (repris !== null ? `sortie confirmée : clôture 1h au-dessus du sommet ${prixFr(sommet!)}` : `tendance haussière (4h ${nomS[s4]}, 1h ${nomS[s1]})`)
    : `4h ${nomS[s4]}, 1h ${nomS[s1]}${sommet !== null ? ` ; il faut une clôture 1h au-dessus de ${prixFr(sommet)}` : ''}`;
  return { condition: { ok, detail }, s4, s1, sommet, repris };
}

/** Les zones d'achat connues : supports tenus par Feu, retest du sommet repris, dernier creux 1h d'une structure haussière. */
export function zonesAchat(niveaux: NiveauxPaire, b1h: readonly Bougie[], now: number, ctx: { sommet: number | null; repris: number | null; s1: string }): Zone[] {
  const zones: Zone[] = niveaux.supports.map(z => ({ ...z }));
  if (ctx.repris !== null && ctx.sommet !== null) zones.push({ bas: ctx.sommet * 0.997, haut: ctx.sommet, nom: `retest du sommet cassé ${prixFr(ctx.sommet)}` });
  if (ctx.s1 === 'haussiere') {
    const creux = pivots(closes(b1h, now)).bas.at(-1);
    if (creux) zones.push({ bas: creux.prix, haut: creux.prix * 1.003, nom: `dernier creux 1h ${prixFr(creux.prix)}` });
  }
  return zones;
}

/**
 * Condition 2 — la zone (1h/15m) : le prix est dans une zone identifiée avant qu'il y arrive, ou au plus 1 % au-dessus.
 * La zone retenue est la plus proche sous le prix. Touchée puis dépassée de plus de 1 % : c'est raté.
 */
export function lireZone(zones: readonly Zone[], prix: number, b15m: readonly Bougie[], now: number): { condition: Condition; zone: Zone | null; rate: boolean } {
  const sous = zones.filter(z => z.bas <= prix).sort((a, b) => b.haut - a.haut);
  const zone = sous[0] ?? null;
  if (!zone) return { condition: { ok: false, detail: 'aucune zone identifiée sous le prix' }, zone: null, rate: false };
  const z = `${prixFr(zone.bas)}–${prixFr(zone.haut)} (${zone.nom})`;
  if (prix <= zone.haut) return { condition: { ok: true, detail: `prix dans la zone ${z}` }, zone, rate: false };
  const ecart = (prix - zone.haut) / zone.haut;
  if (ecart <= DEPASSEMENT_RATE) return { condition: { ok: true, detail: `prix ${pct(ecart, 2)} au-dessus de la zone ${z}` }, zone, rate: false };
  // touchée dans les 2 dernières heures (8 bougies 15m) puis partie sans nous
  const touchee = closes(b15m, now).slice(-8).some(b => b.l <= zone.haut);
  return {
    condition: { ok: false, detail: touchee ? `zone ${z} touchée puis dépassée de ${pct(ecart)} : c'est raté, on attend le prochain retour` : `prix ${pct(ecart, 2)} au-dessus de la zone ${z}` },
    zone, rate: touchee,
  };
}

/**
 * Condition 3 — le déclencheur (15m), sur l'une des deux dernières bougies terminées : rejet de la zone (le bas entre
 * dans la zone, mèche basse d'au moins la moitié de la bougie, clôture au-dessus de la zone), ou clôture au-dessus du
 * haut de la zone avec un volume supérieur aux trois bougies précédentes. Et le RSI 14 (15m) hors surachat.
 */
export function lireDeclencheur(b15m: readonly Bougie[], zone: Zone | null, now: number): { condition: Condition; rsi15: number | null } {
  const c = closes(b15m, now);
  const r = rsi(c.map(b => b.c));
  if (!zone) return { condition: { ok: false, detail: 'pas de zone, pas de déclencheur' }, rsi15: r };
  let trouve: string | null = null;
  for (let i = Math.max(4, c.length - 2); i < c.length; i++) {
    const b = c[i], etendue = b.h - b.l;
    const meche = Math.min(b.o, b.c) - b.l;
    if (b.l <= zone.haut && b.c >= zone.haut && etendue > 0 && meche >= etendue / 2) trouve = `rejet de la zone (bougie 15m de ${new Date(b.t).toISOString().slice(11, 16)} : mèche basse, clôture au-dessus)`;
    const precedentes = c.slice(i - 3, i);
    if (b.c > zone.haut && c[i - 1].c <= zone.haut && b.v > Math.max(...precedentes.map(x => x.v))) trouve = `clôture 15m au-dessus de ${prixFr(zone.haut)} avec un volume plus fort que les 3 précédentes`;
  }
  if (!trouve) return { condition: { ok: false, detail: 'pas encore de rejet ni de clôture 15m au-dessus de la zone avec du volume' }, rsi15: r };
  if (r !== null && r >= RSI_SURACHAT) return { condition: { ok: false, detail: `${trouve}, mais RSI 15m en surachat (${Math.round(r)})` }, rsi15: r };
  return { condition: { ok: true, detail: trouve }, rsi15: r };
}

// ───────────── Le plan chiffré ─────────────

/** L'objectif : la première résistance au-dessus de l'entrée (niveaux tenus par Feu, sommets 1h et 4h) ; null sinon. */
export function objectifDe(niveaux: NiveauxPaire, b1h: readonly Bougie[], b4h: readonly Bougie[], entree: number, now: number): number | null {
  const candidats = [
    ...niveaux.resistances.map(z => z.bas),
    ...pivots(closes(b1h, now)).hauts.map(h => h.prix),
    ...pivots(closes(b4h, now)).hauts.map(h => h.prix),
  ].filter(p => p > entree * (1 + MARGE_STOP));
  return candidats.length ? Math.min(...candidats) : null;
}

/** Gain et perte nets de frais (achat et vente à 0,10 %), en part de la mise. */
export function rendements(entree: number, objectif: number, stopLimite: number, frais = FRAIS) {
  const cout = entree * (1 + frais);
  const gain = (objectif * (1 - frais)) / cout - 1;
  const perte = 1 - (stopLimite * (1 - frais)) / cout;
  return { gain, perte, ratio: perte > 0 ? gain / perte : 0 };
}

export type ContexteCompte = {
  capital: number; regime: Regime; frais?: number;
  /** Opérations déjà faites en régime standard (0,5 % de risque sur les 10 premières). */
  operationsStandard: number;
  /** Positions ouvertes et USDT déjà engagés (régime standard : 3 au plus, 50 % au plus). */
  positions: number; engage: number;
};

/**
 * Le plan d'ordres pour une zone : entrée limite dans la zone, stop sous la zone, objectif ; quantité arrondie au pas,
 * contrôles des 5 USDT. Rend `{ refus }` (en mots simples) quand une règle l'interdit : stop trop large, ratio trop
 * faible, ordre sous 5 USDT, plafond atteint.
 */
export function calculerPlan(paire: Paire, zone: Zone, prix: number, objectifBrut: number | null, regles: ReglesPaire, compte: ContexteCompte): { plan: Plan } | { refus: string; ratio: number | null; objectif: number | null } {
  const frais = compte.frais ?? FRAIS;
  const entree = auPas(Math.min(prix, zone.haut), regles.tick);
  const stop = auPas(zone.bas * (1 - MARGE_STOP), regles.tick);
  const stopLimite = auPas(stop * (1 - MARGE_LIMITE), regles.tick);
  const distanceStop = (entree - stopLimite) / entree;
  // sans résistance connue au-dessus : l'objectif est celui qui donne tout juste 2 pour 1 net
  let objectif = objectifBrut;
  if (objectif === null) {
    const { perte } = rendements(entree, entree, stopLimite, frais);
    objectif = auPasHaut((entree * (1 + frais) * (1 + RATIO_MIN * perte)) / (1 - frais), regles.tick);
  } else objectif = auPas(objectif, regles.tick);
  const { gain, perte, ratio } = rendements(entree, objectif, stopLimite, frais);
  if (compte.regime === 'apprentissage' && distanceStop > STOP_MAX_APPRENTISSAGE) return { refus: `stop à ${pct(distanceStop)} sous l'entrée : plus de 3 %, on attend`, ratio, objectif };
  if (ratio < RATIO_MIN) return { refus: `ratio ${ratio.toFixed(1).replace('.', ',')} pour 1 net de frais (2 au moins) : l'objectif ${prixFr(objectif)} est trop près`, ratio, objectif };

  let montantVise: number;
  if (compte.regime === 'apprentissage') {
    if (compte.positions > 0) return { refus: 'une position est déjà ouverte (une seule à la fois en apprentissage)', ratio, objectif };
    montantVise = compte.capital;
  } else {
    if (compte.positions >= 3) return { refus: '3 positions déjà ouvertes', ratio, objectif };
    const risque = compte.capital * (compte.operationsStandard < 10 ? 0.005 : 0.01);
    montantVise = Math.min(risque / perte, compte.capital * 0.25, compte.capital * 0.5 - compte.engage);
  }
  const quantite = auPas(montantVise / (entree * (1 + frais)), regles.pas);
  // les frais d'achat sont pris sur la crypto reçue : on revend ce qui reste, arrondi au pas
  const recue = auPas(quantite * (1 - frais), regles.pas);
  const montant = quantite * entree;
  const minimum = Math.max(MINIMUM_ORDRE, regles.minimum);
  // régime standard : deux OCO (TP1 à 1R, TP2 à l'objectif) si chaque moitié vaut 5 USDT ; sinon un seul
  const moitie = auPas(recue / 2, regles.pas);
  const tp1 = auPasHaut((entree * (1 + frais) * (1 + perte)) / (1 - frais), regles.tick);
  const deux = compte.regime === 'standard' && moitie * stopLimite >= minimum && (recue - moitie) * stopLimite >= minimum;
  const ocos: Oco[] = deux
    ? [{ quantite: moitie, objectif: tp1, declenchement: stop, limite: stopLimite }, { quantite: Number((recue - moitie).toFixed(10)), objectif, declenchement: stop, limite: stopLimite }]
    : [{ quantite: recue, objectif, declenchement: stop, limite: stopLimite }];
  const minimums = { achat: montant, venteObjectif: recue * objectif, venteStop: recue * stopLimite };
  if (minimums.achat < minimum || minimums.venteStop < minimum || minimums.venteObjectif < minimum) {
    return { refus: `un ordre passerait sous ${minimum} USDT (achat ${minimums.achat.toFixed(2)}, vente au stop ${minimums.venteStop.toFixed(2)})`, ratio, objectif };
  }
  const cout = montant * (1 + frais);
  return {
    plan: {
      paire, entree, quantite, montant, ocos, objectif, stop, stopLimite,
      risque: cout * perte, gainNet: cout * gain, ratio, distanceStop, zone, frais,
      valable: `valable tant que le prix reste dans la zone ${prixFr(zone.bas)}–${prixFr(zone.haut)}`,
      minimums,
    },
  };
}

// ───────────── Le statut ─────────────

export type EntreeMoteur = {
  paire: Paire; b4h: readonly Bougie[]; b1h: readonly Bougie[]; b15m: readonly Bougie[]; now: number;
  niveaux: NiveauxPaire; regles: ReglesPaire; compte: ContexteCompte;
  /** Une règle de discipline qui interdit toute entrée maintenant (pause, fenêtre macro, limite de la semaine…). */
  interdit: string | null;
};

/**
 * Le statut d'une paire : Hypothèse (0 ou 1 condition), Surveillance (2 conditions, ou 3 sans le ratio ou interdites
 * par une règle : on nomme ce qui manque), Signal (3 conditions + ratio, plan d'ordres chiffré).
 */
export function statutPaire(e: EntreeMoteur): StatutPaire {
  const { paire, b4h, b1h, b15m, now } = e;
  const derniere = b15m.at(-1);
  const prix = derniere?.c ?? NaN;
  const ctx = lireContexte(b4h, b1h, e.niveaux, now);
  const zones = zonesAchat(e.niveaux, b1h, now, ctx);
  const z = lireZone(zones, prix, b15m, now);
  const d = lireDeclencheur(b15m, z.zone, now);
  const conditions = { contexte: ctx.condition, zone: z.condition, declencheur: d.condition };
  const vraies = [conditions.contexte, conditions.zone, conditions.declencheur].filter(c => c.ok).length;
  const base = { paire, prix, lu: now, conditions, rsi15: d.rsi15, structure4h: ctx.s4, structure1h: ctx.s1, zone: z.zone, rate: z.rate };

  let ratio: number | null = null, objectif: number | null = null;
  let plan: Plan | null = null, refus: string | null = null;
  if (z.zone && Number.isFinite(prix)) {
    const entree = auPas(Math.min(prix, z.zone.haut), e.regles.tick);
    const r = calculerPlan(paire, z.zone, prix, objectifDe(e.niveaux, b1h, b4h, entree, now), e.regles, e.compte);
    if ('plan' in r) { plan = r.plan; ratio = r.plan.ratio; objectif = r.plan.objectif; } else { refus = r.refus; ratio = r.ratio; objectif = r.objectif; }
  }
  const nomManque = !conditions.contexte.ok ? `le contexte 4h/1h (${conditions.contexte.detail})`
    : !conditions.zone.ok ? `la zone (${conditions.zone.detail})` : `le déclencheur 15m (${conditions.declencheur.detail})`;
  if (vraies <= 1) return { ...base, statut: 'Hypothèse', manque: nomManque, ratio, objectif, plan: null };
  if (vraies === 2) return { ...base, statut: 'Surveillance', manque: nomManque, ratio, objectif, plan: null };
  if (!plan) return { ...base, statut: 'Surveillance', manque: refus ?? 'pas de plan possible', ratio, objectif, plan: null };
  if (e.interdit) return { ...base, statut: 'Surveillance', manque: e.interdit, ratio, objectif, plan: null };
  return { ...base, statut: 'Signal', manque: null, ratio, objectif, plan };
}

/** Une ligne de Lecture : « BTC/USDT · prix lu 71 717 à 14:05 · 4h baissière, 1h en range · RSI 15m 41 ». */
export function ligneLecture(s: StatutPaire): string {
  const nomS = { haussiere: 'haussière', baissiere: 'baissière', range: 'en range', indeterminee: 'indéterminée' };
  return `${nomPaire(s.paire)} · prix lu ${prixFr(s.prix)} à ${new Date(s.lu).toISOString().slice(11, 16)} UTC · 4h ${nomS[s.structure4h]}, 1h ${nomS[s.structure1h]}${s.rsi15 !== null ? ` · RSI 15m ${Math.round(s.rsi15)}` : ''}`;
}
