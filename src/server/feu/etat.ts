// Ce que Feu garde dans Upstash : sa mémoire (plus de bloc de reprise à recoller). Jamais une clé Binance : le Mac
// n'envoie que des montants et des ordres. Au premier passage, l'état est rangé à partir du bloc de reprise du
// 12 novembre 2026 (agents/Feu/CONSIGNES.md, partie 2) ; ensuite, Feu le tient à jour.
//   feu:etat        `json` : capital déclaré, niveaux par paire, calendrier macro, plans donnés au Signal
//   feu:passage     `json` : le dernier passage (statut de chaque paire, prix et heure de lecture) ; `regles` : exchangeInfo
//   feu:compte      `json` : le dernier compte lu par le Mac (solde Spot et Earn, ordres ouverts et exécutés)
//   feu:alertes     table : compteur du jour, annonces déjà faites, derniers statuts, niveaux déjà vus, pause
//   feu:messages    liste : les alertes (envoyées ou retenues), 60 au plus
//   feu:ignores     table sujet → { depuis, statut } : ce que le patron a dit d'ignorer (bouton « Ignorer »)
//   feu:verrou      un passage à la fois
import type { KV } from '../memoire';
import type { PlanEmis } from './journal';
import type { Annonce, Compte, NiveauxPaire, Paire, ReglesPaire, StatutPaire } from './types';

export const CLES_FEU = {
  etat: 'feu:etat', passage: 'feu:passage', compte: 'feu:compte', alertes: 'feu:alertes', messages: 'feu:messages',
  ignores: 'feu:ignores', verrou: 'feu:verrou', analyses: 'feu:analyses', lot: 'feu:lot',
} as const;
const J = 'json';

export type EtatFeu = {
  version: 1;
  cree: number;
  /** Le capital déclaré par le patron (avant que le Mac lise le vrai solde). */
  capitalDeclare: { montant: number; quand: number };
  frais: number;
  niveaux: Record<Paire, NiveauxPaire>;
  annonces: Annonce[];
  /** Ce qui reste à éclaircir (le capital introuvable dans le Spot…), dit dans la page tant que le Mac ne l'a pas réglé. */
  points: string[];
  /** Les plans donnés au Signal (30 jours) : pour juger si une opération a suivi le plan. */
  plans: PlanEmis[];
};

export type PassageFeu = { quand: number; statuts: StatutPaire[]; erreur?: string };

const H = 3_600_000;

/** L'état de départ : le bloc de reprise du jeudi 12 novembre 2026, 17 h 30 UTC (prix périmés : jamais présentés comme actuels). */
export function etatInitial(now: number): EtatFeu {
  return {
    version: 1, cree: now,
    capitalDeclare: { montant: 8.5, quand: Date.UTC(2026, 10, 7, 13, 18) },
    frais: 0.001,
    niveaux: {
      BTCUSDT: {
        supports: [{ bas: 71250, haut: 71500, nom: 'support du 12/11' }],
        resistances: [{ bas: 72200, haut: 72730, nom: 'première résistance' }, { bas: 73440, haut: 73440, nom: 'résistance' }, { bas: 74200, haut: 74810, nom: 'sommet du dernier rebond' }],
        surveilles: [
          { prix: 72730, sens: 'haut', nom: 'premier jalon' },
          { prix: 71250, sens: 'bas', nom: 'bas du support' },
          { prix: 74810, sens: 'haut', nom: 'sommet du dernier rebond (contexte haussier)' },
        ],
        contexte: { prix: 74810 },
      },
      ETHUSDT: {
        supports: [{ bas: 1984, haut: 2000, nom: 'support du 12/11' }],
        resistances: [{ bas: 2006, haut: 2028, nom: 'première résistance' }, { bas: 2047, haut: 2047, nom: 'résistance' }, { bas: 2085, haut: 2104, nom: 'sommet du dernier rebond' }],
        surveilles: [
          { prix: 2030, sens: 'haut', nom: 'premier jalon' },
          { prix: 1980, sens: 'bas', nom: 'sous le support' },
          { prix: 2104, sens: 'haut', nom: 'sommet du dernier rebond (contexte haussier)' },
        ],
        contexte: { prix: 2104 },
      },
    },
    annonces: [
      { quand: Date.UTC(2026, 10, 13, 13, 30), nom: 'PPI américain', source: 'bloc de reprise du 12/11' },
      { quand: Date.UTC(2026, 10, 17), nom: 'résultats de Nvidia (heure à confirmer)', source: 'presse du 12/11', aConfirmer: true },
      { quand: Date.UTC(2026, 11, 9), nom: 'décision de la Fed (heure à confirmer)', source: 'presse du 12/11', aConfirmer: true },
    ],
    points: [
      'Les 8,50 USDT déclarés ne sont pas visibles dans le Spot (0,0016 USDT) : à retrouver (Earn ?) et à transférer vers le Spot avant tout plan d\'ordres.',
      'Une ligne « Prix de revient 76 983,33 » sur BTC : du BTC détenu ailleurs que dans le Spot ? À confirmer.',
    ],
    plans: [],
  };
}

function lire<T>(brut: string | undefined | null): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

/** L'état de Feu ; rangé depuis le bloc de reprise s'il est vide (premier passage). */
export async function lireEtatFeu(kv: KV, now: number): Promise<EtatFeu> {
  const e = lire<EtatFeu>((await kv.hmget(CLES_FEU.etat, [J]))[J]);
  if (e && e.version === 1) return e;
  const initial = etatInitial(now);
  await kv.hset(CLES_FEU.etat, J, JSON.stringify(initial));
  return initial;
}
/** L'état sans le créer (la page, le compte rendu). */
export async function lireEtatSeul(kv: KV): Promise<EtatFeu | null> {
  return lire<EtatFeu>((await kv.hmget(CLES_FEU.etat, [J]))[J]);
}
export const ecrireEtatFeu = (kv: KV, e: EtatFeu) => kv.hset(CLES_FEU.etat, J, JSON.stringify(e));

export async function lirePassageFeu(kv: KV): Promise<PassageFeu | null> {
  return lire<PassageFeu>((await kv.hmget(CLES_FEU.passage, [J]))[J]);
}
export const ecrirePassageFeu = (kv: KV, p: PassageFeu) => kv.hset(CLES_FEU.passage, J, JSON.stringify(p));

/** Les règles des paires, relues une fois par jour au plus. */
export async function lireReglesGardees(kv: KV, now: number): Promise<Record<string, ReglesPaire> | null> {
  const r = lire<{ quand: number; regles: Record<string, ReglesPaire> }>((await kv.hmget(CLES_FEU.passage, ['regles'])).regles);
  return r && now - r.quand < 24 * H ? r.regles : null;
}
export const garderRegles = (kv: KV, regles: Record<string, ReglesPaire>, now: number) => kv.hset(CLES_FEU.passage, 'regles', JSON.stringify({ quand: now, regles }));

export async function lireCompte(kv: KV): Promise<Compte | null> {
  return lire<Compte>((await kv.hmget(CLES_FEU.compte, [J]))[J]);
}
export const ecrireCompte = (kv: KV, c: Compte) => kv.hset(CLES_FEU.compte, J, JSON.stringify(c));

export async function lireChamp<T>(kv: KV, cle: string, champ: string): Promise<T | null> {
  return lire<T>((await kv.hmget(cle, [champ]))[champ]);
}

/** Un passage à la fois (jeton : seul celui qui l'a posé l'enlève). */
export async function sousVerrouFeu<T>(kv: KV, faire: () => Promise<T>, secondes = 120): Promise<T | { occupe: true }> {
  const jeton = crypto.randomUUID();
  if (!(await kv.setnx(CLES_FEU.verrou, jeton, secondes))) return { occupe: true };
  try {
    return await faire();
  } finally {
    await (async () => { if ((await kv.get(CLES_FEU.verrou)) === jeton) await kv.del(CLES_FEU.verrou); })().catch(() => undefined);
  }
}
