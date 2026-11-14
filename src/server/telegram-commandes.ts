import { norme } from '@/data/silence';

// Les commandes que le patron écrit au QG sur Telegram, reconnues par le code (jamais par le modèle) : « ignore Livreo »,
// « reprends Livreo », « pas d'alertes pendant 2 h », « reprends les alertes ». Tout le reste est une conversation avec
// Kuroro. Fonctions pures, sans réseau. Heure d'Abidjan = UTC.

export type Commande =
  | { type: 'ignorer'; texte: string }
  | { type: 'reprendre'; texte: string }
  /** `jusqua` null : la durée manque, Kuroro la demande avec des boutons. */
  | { type: 'pause'; jusqua: number | null }
  | { type: 'fin-pause' }
  /** Une pause trop longue (plus de 48 h) : refusée, jamais de silence infini caché. */
  | { type: 'pause-trop-longue' };

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Une pause dure au plus 48 h. */
export const PAUSE_MAX = 48 * H;

/** « ignore », et ses fautes courantes ; « ne t'inquiète pas », « tais-toi », « laisse tomber », « c'est normal ». */
const IGNORER = new RegExp([
  /\b(ignore[rsz]?|ignor|ingore[rsz]?|igonre[rsz]?|ignoe|ignorre[rsz]?)\b/,
  /\b(ne )?t ?inquiete?[sz]? (pas|plus)\b/, /\bpas d inquietude\b/,
  /\b(tais|tait|taie|tai) toi\b/, /\bte taire\b/, /\blaisse tomber\b/,
  /\b(c est|cest|c|ces) (normal|connu)\b/,
  /\bne me (parle|dis) plus\b/, /\barrete de (me parler|m alerter|me prevenir)\b/,
].map(r => r.source).join('|'));

const REPRENDRE = /\b(reprends?|reprendre|reprenez|repren|reactive[rsz]?|remets?|remettre|reparle moi)\b/;
/** « pas d'alertes », « silence », « pause », « ne me dérange pas » : une pause générale (avec une durée). */
const PAUSE = /\b(pas d alertes?|plus d alertes?|aucune alerte|pause|silence|silencieux|ne me derange pas|coupe les alertes)\b/;
const FIN_PAUSE = /\bfin (de la |du )?(pause|silence)\b|\b(reprends?|reprendre|reactive[rsz]?|remets?|relance)\b.*\b(alertes?|notifications?)\b|\btu peux (re)?parler\b/;
/** Une question (« Livreo est revenu ? », « pourquoi tu ignores Livreo ») n'est jamais une commande. */
const QUESTION_DEBUT = /^(pourquoi|comment|quand|combien|qui|quoi|ou|est ce que|qu est ce|c est quoi|quel|quelle|quels|quelles)\b/;
const DEMANDE_POLIE = /^(tu peux|peux tu|tu veux bien|pourrais tu|tu pourrais|est ce que tu peux|stp|svp)\b/;

const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, douze: 12 };
const nombre = (m: string) => (m in NOMBRES ? NOMBRES[m] : Number(m));
const minuit = (t: number) => t - (((t % JOUR) + JOUR) % JOUR);

/**
 * La fin d'une pause écrite en français : « pendant 2 h », « 30 min », « 1 h 30 », « une heure », « jusqu'à 18 h »,
 * « jusqu'à demain 8 h », « jusqu'à demain matin » (8 h), « jusqu'à ce soir » (20 h), « jusqu'à midi ». null : pas de durée.
 */
export function finDePause(t: string, now: number): number | null {
  const jusqu = t.match(/\bjusqu ?(?:a|au) (demain )?(?:(\d{1,2}) ?h(?:eures?)? ?(\d{2})?|(matin)|(ce soir|soir)|(midi))\b/);
  if (jusqu) {
    const [, demain, h, m, matin, soir, midi] = jusqu;
    const heure = h !== undefined ? Number(h) : matin ? 8 : soir ? 20 : midi ? 12 : 8;
    if (heure > 23 || Number(m ?? 0) > 59) return null;
    let fin = minuit(now) + heure * H + Number(m ?? 0) * MIN + (demain ? JOUR : 0);
    if (fin <= now) fin += JOUR; // « jusqu'à 8 h » dit à 22 h : demain
    return fin;
  }
  if (/\bjusqu ?a demain\b/.test(t)) return minuit(now) + JOUR + 8 * H;
  const nb = '(\\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|douze)';
  const hm = t.match(new RegExp(`\\b${nb} ?(?:h|heures?)(?: ?(\\d{1,2}))?(?: ?min(?:utes?)?)?\\b`));
  if (hm) return now + nombre(hm[1]) * H + Number(hm[2] ?? 0) * MIN;
  const mn = t.match(new RegExp(`\\b${nb} ?(?:min|minutes?|mn)\\b`));
  if (mn) return now + nombre(mn[1]) * MIN;
  if (/\b(demi heure)\b/.test(t)) return now + 30 * MIN;
  return null;
}

/** La commande que contient le message, ou null (une conversation pour Kuroro). */
export function lireCommande(texte: string, now: number): Commande | null {
  const brut = texte.trim();
  if (!brut || brut.length > 300) return null;
  const t = norme(brut);
  const question = QUESTION_DEBUT.test(t) || (/\?\s*$/.test(t) && !DEMANDE_POLIE.test(t));
  if (question) return null;
  const sansPoint = t.replace(/\?/g, ' ').replace(/\s+/g, ' ').trim();

  if (FIN_PAUSE.test(sansPoint)) return { type: 'fin-pause' };
  const fin = finDePause(sansPoint, now);
  // une durée avec un mot de silence : la pause générale (« ignore tout pendant 2 h » aussi)
  if (fin !== null && (PAUSE.test(sansPoint) || IGNORER.test(sansPoint))) {
    return fin - now > PAUSE_MAX ? { type: 'pause-trop-longue' } : { type: 'pause', jusqua: fin };
  }
  if (REPRENDRE.test(sansPoint)) return { type: 'reprendre', texte: sansPoint };
  if (IGNORER.test(sansPoint)) {
    // « tais-toi » seul : une pause dont la durée manque ; avec une cible, un « ignore »
    const seul = /^(stp |svp )?(tais toi|tait toi|silence|chut)( stp| svp)?$/.test(sansPoint);
    return seul ? { type: 'pause', jusqua: null } : { type: 'ignorer', texte: sansPoint };
  }
  if (/^(pause|silence|mode silence|pas d alertes?|plus d alertes?|coupe les alertes|ne me derange pas)\b/.test(sansPoint) && sansPoint.split(' ').length <= 6) {
    return { type: 'pause', jusqua: null };
  }
  return null;
}
