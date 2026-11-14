import type { KV } from '../memoire';
import { Refus } from '../qg';
import { ajouterVip, CLES_ACTIONS, lienHttps, lireVip, retirerVip, type Banni, type Garde, type Nettoyage, type Question } from './actions';
import { CLES_CLARA } from './stats';

// Ce que la page affiche pour Clara : un seul document, sans mot de passe ni adresse de connexion.

/** Les contacts proposés comme VIP, rangés par l'action `vip-candidats` : la page ne lit que ce cache (jamais la boîte). */
export const CLE_CANDIDATS = 'clara:vip-candidats';
const DERNIERS = 10;

export type VueClara = {
  connecte: boolean;
  vip: string[];
  candidatsVip: { adresse: string; coche: boolean }[];
  /** `desabo` : le lien de désabonnement (https seulement), pour le faire soi-même. */
  bannis: { id: string; adresse: string; depuis: number; deplaces: number; desabo?: string }[];
  gardes: string[];
  questions: { id: string; adresse: string; etape: 1 | 2 }[];
  nettoye: { mails: number; derniers: { quand: number; adresse: string; n: number }[] };
  statsAvancement: { lus: number; total?: number };
};

function lire<T>(brut: string): T | null {
  try { return JSON.parse(brut) as T; } catch { return null; }
}
const valeurs = <T>(h: Record<string, string>) =>
  Object.entries(h).flatMap(([id, v]) => { const o = lire<T>(v); return o ? [[id, o] as const] : []; });

/** Lue toutes les 20 s : de petites tables seulement, jamais `clara:stats` (des milliers d'expéditeurs). */
export async function vueClara(kv: KV): Promise<VueClara> {
  const [vip, cache, bannis, gardes, questions, journal, compteurs, curseur] = await Promise.all([
    lireVip(kv), kv.hmget(CLE_CANDIDATS, ['liste']), kv.hgetall(CLES_CLARA.bannis), kv.hgetall(CLES_CLARA.gardes),
    kv.hgetall(CLES_CLARA.questions), kv.lrange(CLES_CLARA.journal, 0, DERNIERS - 1), kv.hgetall(CLES_CLARA.compteurs),
    kv.hmget(CLES_CLARA.curseur, ['total']),
  ]);
  const liste = lire<unknown>(cache.liste ?? '');
  const candidats = Array.isArray(liste) ? liste.filter((x): x is string => typeof x === 'string') : [];
  const entrees = journal.flatMap(j => { const o = lire<Nettoyage>(j); return o ? [o] : []; });
  const total = Number(curseur.total);
  // une boîte vidée par Clara peut compter moins de mails que ceux déjà lus
  const lus = Math.min(Number(compteurs.lus) || 0, total > 0 ? total : Infinity);
  // le total courant ; à défaut (données d'avant le compteur), la somme du journal
  const nettoyes = compteurs.mailsNettoyes !== undefined ? Number(compteurs.mailsNettoyes) || 0
    : (await kv.lrange(CLES_CLARA.journal, 0, -1)).reduce((n, j) => n + (lire<Nettoyage>(j)?.n ?? 0), 0);
  return {
    connecte: !!process.env.GMAIL_ADRESSE && !!process.env.GMAIL_MOT_DE_PASSE_APPLI,
    vip,
    candidatsVip: candidats.map(adresse => ({ adresse, coche: vip.includes(adresse) })),
    bannis: valeurs<Banni>(bannis).map(([id, b]) => {
      const lien = b.desabonne ? null : lienHttps(b.desabo);
      return { id, adresse: b.adresse, depuis: b.depuis, deplaces: b.deplaces, ...(lien ? { desabo: lien } : {}) };
    }).sort((a, b) => b.depuis - a.depuis),
    gardes: valeurs<Garde>(gardes).map(([, g]) => g.adresse).sort(),
    questions: valeurs<Question>(questions).map(([id, q]) => ({ id, adresse: q.adresse, etape: q.etape })),
    nettoye: {
      mails: nettoyes,
      derniers: entrees.slice(0, DERNIERS).map(e => ({ quand: e.quand, adresse: e.adresse, n: e.n })),
    },
    statsAvancement: { lus, ...(total > 0 ? { total } : {}) },
  };
}

/** Ajoute (cochée / saisie) ou retire une adresse ou un domaine VIP ; même validation que « VIP : x ». */
export async function majVip(kv: KV, entree: string, ajout: boolean, now = Date.now()): Promise<void> {
  if (ajout) await ajouterVip(kv, entree, now); else await retirerVip(kv, entree);
}

/** Retire un banni. Prend le verrou de l'expéditeur d'abord : pas de retrait pendant une mise à la corbeille. */
export async function debannir(kv: KV, id: string): Promise<void> {
  const verrou = CLES_ACTIONS.verrou(id);
  if (!(await kv.setnx(verrou, 'debannir', 60))) throw new Refus('mise à la corbeille en cours, réessaie dans un instant', 409);
  try {
    await kv.hdel(CLES_CLARA.bannis, id);
  } finally {
    await kv.del(verrou).catch(() => undefined);
  }
}
