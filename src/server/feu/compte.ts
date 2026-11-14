// Le compte du patron, lu en lecture seule par le Mac (mac/feu.mjs) et envoyé au QG (`POST /api/agents/feu/compte`) :
// seulement des montants et des ordres, jamais la clé. Le QG vérifie chaque champ (forme, taille, nombres) et ne garde
// rien d'autre. Le capital de Feu en découle : le vrai solde quand il est lu, sinon le montant déclaré.
import { Refus } from '../qg';
import { contientSecret } from '../paul/secrets';
import type { Compte, Execution, OrdreOuvert } from './types';
import type { EtatFeu } from './etat';

const MAX_ORDRES = 50, MAX_EXECUTIONS = 500, MAX_ACTIFS = 40;
const ACTIF = /^[A-Z0-9]{2,12}$/;
const PAIRE = /^[A-Z0-9]{5,20}$/;
const TYPES = /^[A-Z_]{3,30}$/;
/** Les droits qu'une clé de Feu ne doit jamais avoir (le Mac refuse déjà ; le QG le redit). */
const DROITS = /^[a-zA-Z]{3,40}$/;

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const num = (v: unknown, nom: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Refus(`compte : « ${nom} » doit être un nombre positif`, 422);
  return v;
};
const date = (v: unknown, nom: string): number => {
  const n = num(v, nom);
  if (n < Date.UTC(2017, 0, 1) || n > Date.UTC(2100, 0, 1)) throw new Refus(`compte : « ${nom} » n'est pas une date`, 422);
  return Math.round(n);
};
const motif = (v: unknown, re: RegExp, nom: string): string => {
  if (typeof v !== 'string' || !re.test(v)) throw new Refus(`compte : « ${nom} » illisible`, 422);
  return v;
};
const cote = (v: unknown): 'BUY' | 'SELL' => { if (v !== 'BUY' && v !== 'SELL') throw new Refus('compte : « cote » BUY ou SELL', 422); return v; };

/** Le compte reçu du Mac, vérifié champ par champ. Tout champ inconnu est refusé (jamais rien d'autre que des montants). */
export function validerCompte(corps: unknown, now: number): Compte {
  const o = obj(corps);
  if (!o) throw new Refus('compte : un objet JSON est attendu', 400);
  const permis = ['quand', 'cle', 'droits', 'raison', 'spot', 'earn', 'ouverts', 'executes'];
  for (const k of Object.keys(o)) if (!permis.includes(k)) throw new Refus(`compte : champ non autorisé (seulement ${permis.join(', ')})`, 400);
  if (JSON.stringify(o).length > 400_000) throw new Refus('compte : trop long', 413);
  if (contientSecret(JSON.stringify(o))) throw new Refus('compte : un secret a été reconnu, rien n\'est gardé', 422);
  const quand = date(o.quand, 'quand');
  if (quand > now + 5 * 60_000) throw new Refus('compte : « quand » est dans le futur', 422);
  if (!['ok', 'absente', 'droits', 'erreur'].includes(o.cle as string)) throw new Refus('compte : « cle » ok, absente, droits ou erreur', 400);
  const cle = o.cle as Compte['cle'];
  const droits = o.droits === undefined ? undefined : (Array.isArray(o.droits) ? o.droits.slice(0, 20).map(d => motif(d, DROITS, 'droits')) : (() => { throw new Refus('compte : « droits » liste', 422); })());
  const raison = o.raison === undefined ? undefined : typeof o.raison === 'string' && o.raison.length <= 200 ? o.raison.replace(/[^\p{L}\p{N} .,:;'’()%/-]/gu, '').trim() : (() => { throw new Refus('compte : « raison » 200 caractères au plus', 422); })();
  const vide: Compte = { quand, cle, ...(droits ? { droits } : {}), ...(raison ? { raison } : {}), spot: {}, earn: {}, ouverts: [], executes: [] };
  if (cle !== 'ok') return vide;

  const spot: Compte['spot'] = {};
  const s = obj(o.spot) ?? {};
  if (Object.keys(s).length > MAX_ACTIFS) throw new Refus('compte : trop d\'actifs', 422);
  for (const [a, v] of Object.entries(s)) {
    const x = obj(v);
    if (!x) throw new Refus('compte : solde Spot illisible', 422);
    spot[motif(a, ACTIF, 'actif')] = { libre: num(x.libre, 'libre'), bloque: num(x.bloque, 'bloque') };
  }
  const earn: Compte['earn'] = {};
  const e = obj(o.earn) ?? {};
  if (Object.keys(e).length > MAX_ACTIFS) throw new Refus('compte : trop d\'actifs', 422);
  for (const [a, v] of Object.entries(e)) earn[motif(a, ACTIF, 'actif')] = num(v, 'earn');

  const ouvertsBruts = Array.isArray(o.ouverts) ? o.ouverts : [];
  if (ouvertsBruts.length > MAX_ORDRES) throw new Refus('compte : trop d\'ordres ouverts', 422);
  const ouverts: OrdreOuvert[] = ouvertsBruts.map(v => {
    const x = obj(v) ?? {};
    return {
      paire: motif(x.paire, PAIRE, 'paire'), id: num(x.id, 'id'), cote: cote(x.cote), type: motif(x.type, TYPES, 'type'),
      prix: num(x.prix, 'prix'), declenchement: num(x.declenchement ?? 0, 'declenchement'), quantite: num(x.quantite, 'quantite'),
      executee: num(x.executee ?? 0, 'executee'), quand: date(x.quand, 'quand'), liste: Number.isInteger(x.liste) ? (x.liste as number) : -1,
    };
  });
  const execBrutes = Array.isArray(o.executes) ? o.executes : [];
  if (execBrutes.length > MAX_EXECUTIONS) throw new Refus('compte : trop d\'ordres exécutés', 422);
  const executes: Execution[] = execBrutes.map(v => {
    const x = obj(v) ?? {};
    return {
      paire: motif(x.paire, PAIRE, 'paire'), id: num(x.id, 'id'), ordre: num(x.ordre, 'ordre'), cote: cote(x.cote),
      prix: num(x.prix, 'prix'), quantite: num(x.quantite, 'quantite'), montant: num(x.montant, 'montant'),
      frais: num(x.frais, 'frais'), fraisActif: motif(x.fraisActif, ACTIF, 'fraisActif'), quand: date(x.quand, 'quand'),
    };
  });
  return { ...vide, spot, earn, ouverts, executes };
}

/** Les USDT disponibles (Spot libre), ceux qui dorment en Simple Earn, et la valeur des cryptos aux prix donnés. */
export function soldes(c: Compte, prix: Record<string, number>) {
  const spotUsdt = (c.spot.USDT?.libre ?? 0) + (c.spot.USDT?.bloque ?? 0);
  const earnUsdt = c.earn.USDT ?? 0;
  let crypto = 0;
  for (const actif of ['BTC', 'ETH']) {
    const q = (c.spot[actif]?.libre ?? 0) + (c.spot[actif]?.bloque ?? 0) + (c.earn[actif] ?? 0);
    const p = prix[`${actif}USDT`];
    if (q > 0 && p) crypto += q * p;
  }
  return { spotUsdt, earnUsdt, crypto, total: spotUsdt + earnUsdt + crypto };
}

/** Le capital de tous les calculs : le vrai solde (Spot + Earn + BTC/ETH) quand le Mac l'a lu, sinon le montant déclaré. */
export function capitalDe(etat: EtatFeu, compte: Compte | null, prix: Record<string, number>): { montant: number; source: 'compte' | 'declare'; quand: number } {
  if (compte?.cle === 'ok') return { montant: soldes(compte, prix).total, source: 'compte', quand: compte.quand };
  return { montant: etat.capitalDeclare.montant, source: 'declare', quand: etat.capitalDeclare.quand };
}
