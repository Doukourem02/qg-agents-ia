import type { KV } from '../memoire';
import { Refus } from '../qg';
import type { DossierMac, RapportMac } from './types';

// Le rapport du Mac : une fois par jour, le relais envoie l'état git des dossiers de ~/Desktop/Code.
// Seulement des noms de dossiers de premier niveau et des nombres ; jamais un nom de fichier.

export const CLES_ZORO = {
  tour: 'zoro:tour', historique: 'zoro:historique', signales: 'zoro:signales',
  mac: 'zoro:mac', demandeMac: 'zoro:demande-mac', verrou: 'zoro:verrou',
  /** La marque « le message de ce mardi est parti » (créneau = le mardi 09:00 UTC du tour, en ms). */
  envoye: (creneau: number) => `zoro:envoye:${creneau}`,
} as const;

const MAX_DOSSIERS = 200;
const CHAMP = 'json';

const entier = (v: unknown, nom: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Refus(`« ${nom} » doit être un entier positif ou nul`);
  return v;
};
const entierOuNull = (v: unknown, nom: string): number | null => (v === null ? null : entier(v, nom));
const booleen = (v: unknown, nom: string): boolean => {
  if (typeof v !== 'boolean') throw new Refus(`« ${nom} » doit être vrai ou faux`);
  return v;
};

/** Un nom de dossier : un niveau, ou « parent/enfant » ; jamais vide, « .. », absolu, avec « \ » ou un segment vide.
 *  Même règle côté Mac (`nomAcceptable` dans mac/zoro.mjs) : à garder identique. */
function nomValide(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.length > 200) throw new Refus('nom de dossier invalide');
  if (v.includes('..') || v.startsWith('/') || v.includes('\\')) throw new Refus('nom de dossier invalide');
  const parties = v.split('/');
  if (parties.length > 2 || parties.some(p => p === '')) throw new Refus('nom de dossier invalide');
  return v;
}

function compteValide(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(v)) throw new Refus('« compte » invalide');
  return v;
}

function dossierValide(brut: unknown): DossierMac {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw new Refus('dossier invalide');
  const d = brut as Record<string, unknown>;
  if (d.illisible !== undefined && d.illisible !== true) throw new Refus('« illisible » ne peut être que vrai');
  return {
    nom: nomValide(d.nom),
    git: booleen(d.git, 'git'),
    compte: compteValide(d.compte),
    distant: booleen(d.distant, 'distant'),
    nonEnregistres: entier(d.nonEnregistres, 'nonEnregistres'),
    plusAncienNonEnregistre: entierOuNull(d.plusAncienNonEnregistre, 'plusAncienNonEnregistre'),
    nonPousses: entier(d.nonPousses, 'nonPousses'),
    plusAncienNonPousse: entierOuNull(d.plusAncienNonPousse, 'plusAncienNonPousse'),
    stashes: entier(d.stashes, 'stashes'),
    dernierCommit: entierOuNull(d.dernierCommit, 'dernierCommit'),
    modifie: entier(d.modifie, 'modifie'),
    ...(d.illisible === true ? { illisible: true as const } : {}),
  };
}

/** Valide et enregistre le rapport (200 dossiers au plus) ; efface la demande d'envoi. La date est celle du serveur. */
export async function enregistrerRapportMac(kv: KV, corps: unknown, now: number): Promise<{ ok: true }> {
  const dossiers = (corps as { dossiers?: unknown } | null)?.dossiers;
  if (!Array.isArray(dossiers)) throw new Refus('« dossiers » doit être une liste');
  const propres = dossiers.slice(0, MAX_DOSSIERS).map(dossierValide);
  const rapport: RapportMac = { quand: now, dossiers: propres };
  await kv.hset(CLES_ZORO.mac, CHAMP, JSON.stringify(rapport));
  await kv.del(CLES_ZORO.demandeMac);
  return { ok: true };
}

export async function lireRapportMac(kv: KV): Promise<RapportMac | null> {
  const brut = (await kv.hmget(CLES_ZORO.mac, [CHAMP]))[CHAMP];
  if (!brut) return null;
  try { return JSON.parse(brut) as RapportMac; } catch { return null; }
}

/** Demande au Mac d'envoyer son rapport au prochain passage (sans attendre le lendemain). */
export async function demanderRapportMac(kv: KV): Promise<void> {
  await kv.hset(CLES_ZORO.demandeMac, 'demande', '1');
}

export async function rapportDemande(kv: KV): Promise<boolean> {
  return (await kv.hmget(CLES_ZORO.demandeMac, ['demande'])).demande === '1';
}
