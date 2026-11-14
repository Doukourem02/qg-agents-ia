import { createHash } from 'node:crypto';
import type { KV } from '../memoire';
import { Refus } from '../qg';
import type { Boite, Entete } from './imap';

// Les statistiques par expéditeur de Clara : calculées par morceaux (curseur dans Upstash), en-têtes seulement.

export const CLES_CLARA = {
  stats: 'clara:stats', curseur: 'clara:curseur', vip: 'clara:vip', bannis: 'clara:bannis', gardes: 'clara:gardes',
  questions: 'clara:questions', journal: 'clara:journal', jour: 'clara:propose:<AAAA-MM-JJ>',
  /** Petits compteurs courants : `lus` (mails comptés dans le passage en cours), `mailsNettoyes` (total mis à la corbeille). */
  compteurs: 'clara:compteurs',
  /** Index des plus gros expéditeurs (id → total) : la table complète n'est jamais relue à chaque appel. */
  index: 'clara:stats:index',
} as const;

export const CATEGORIES = ['promotions', 'social', 'updates', 'forums'] as const;
export type Categorie = (typeof CATEGORIES)[number];

export type StatExpediteur = {
  id: string /* court, stable : 8 caractères base36 d'un hash */; adresse: string; nom?: string; total: number; nonLus: number;
  categorie?: Categorie; desabo?: { url: string; unClic: boolean }; dernier: number; exempleObjet?: string;
  /** Date (ms) de la dernière mise à la corbeille complète : total et nonLus repartent alors de 0. */
  nettoye?: number;
};
/**
 * Ce qui est rangé dans `clara:stats` : la fiche, plus le décompte par catégorie (pour la catégorie majoritaire)
 * et le plus grand UID déjà compté (un morceau rejoué n'ajoute rien).
 */
type StatRangee = StatExpediteur & { parCategorie?: Partial<Record<Categorie, number>>; uidMax?: number };

const PAR_APPEL = 2000;
const OBJET_MAX = 120;
const URL_MAX = 500;
const VERROU = 'clara:stats:verrou';
/** Taille de l'index des plus gros expéditeurs. */
const INDEX_MAX = 1000;

/** Adresse en minuscules, sans nom affiché (« Marque X <News@X.com> » → news@x.com). */
export function normaliser(adresse: string): { adresse: string; domaine: string } {
  const m = /<([^<>]*)>\s*$/.exec(adresse);
  const a = (m ? m[1] : adresse).trim().toLowerCase();
  const i = a.lastIndexOf('@');
  return { adresse: a, domaine: i >= 0 ? a.slice(i + 1) : '' };
}

/** Identifiant court et stable d'une adresse normalisée : 8 caractères base36 d'un SHA-1. */
export function idExpediteur(adresse: string): string {
  const h = createHash('sha1').update(adresse).digest('hex');
  return BigInt(`0x${h.slice(0, 16)}`).toString(36).padStart(13, '0').slice(0, 8);
}

/** Le désabonnement d'un mail : lien https de préférence ; « un clic » (RFC 8058) seulement avec https + POST. */
function desabo(m: Entete): StatExpediteur['desabo'] {
  if (!m.listUnsubscribe) return undefined;
  const liens = [...m.listUnsubscribe.matchAll(/<([^<>]+)>/g)].map(x => x[1].trim());
  const https = liens.find(l => /^https:\/\//i.test(l));
  const url = https ?? liens[0];
  if (!url) return undefined;
  return { url: url.slice(0, URL_MAX), unClic: !!https && /List-Unsubscribe\s*=\s*One-Click/i.test(m.listUnsubscribePost ?? '') };
}

function majoritaire(s: StatRangee): Categorie | undefined {
  // en cas de doute, rien : la catégorie doit couvrir plus de la moitié des mails de l'expéditeur
  return CATEGORIES.find(c => (s.parCategorie?.[c] ?? 0) * 2 > s.total);
}

const analyser = (brut: Record<string, string>) => {
  const o: Record<string, StatRangee> = {};
  for (const [id, v] of Object.entries(brut)) {
    try { o[id] = JSON.parse(v) as StatRangee; } catch { /* champ abîmé : ignoré, recalculé au prochain passage */ }
  }
  return o;
};
const lireTout = async (kv: KV) => analyser(await kv.hgetall(CLES_CLARA.stats));

const fiche = (s: StatRangee): StatExpediteur => { const f: StatRangee = { ...s }; delete f.parCategorie; delete f.uidMax; return f; };
const parTotal = (x: StatExpediteur, y: StatExpediteur) => y.total - x.total || x.adresse.localeCompare(y.adresse);

/** Les fiches des expéditeurs (sans le décompte interne), les plus fournis d'abord. Lit toute la table : outils et tests seulement. */
export async function lireStats(kv: KV): Promise<StatExpediteur[]> {
  return Object.values(await lireTout(kv)).map(fiche).sort(parTotal);
}

/**
 * Les plus gros expéditeurs encore à juger (total > 0, `garder` vrai), au plus `max`, d'après l'index :
 * seules leurs fiches sont lues (HMGET). Index absent (données d'avant l'index) : reconstruit une fois.
 */
export async function meilleursExpediteurs(kv: KV, garder: (s: StatExpediteur) => boolean, max: number): Promise<StatExpediteur[]> {
  let index = await kv.hgetall(CLES_CLARA.index);
  if (!Object.keys(index).length) {
    const tout = Object.values(await lireTout(kv)).filter(s => s.total > 0).sort(parTotal).slice(0, INDEX_MAX);
    index = Object.fromEntries(tout.map(s => [s.id, String(s.total)]));
    for (let i = 0; i < tout.length; i += 50) await Promise.all(tout.slice(i, i + 50).map(s => kv.hset(CLES_CLARA.index, s.id, String(s.total))));
  }
  const ids = Object.entries(index).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).map(([id]) => id);
  const out: StatExpediteur[] = [];
  for (let i = 0; i < ids.length && out.length < max; i += 100) {
    const lus = analyser(await kv.hmget(CLES_CLARA.stats, ids.slice(i, i + 100)));
    out.push(...Object.values(lus).map(fiche).filter(s => s.total > 0 && garder(s)));
  }
  return out.sort(parTotal).slice(0, max);
}

/**
 * Après une mise à la corbeille complète : la fiche repart de 0 (« nettoyée », hors de l'index), mais garde
 * `uidMax` (pas de recompte) et le désabonnement (proposé juste après).
 */
export async function marquerNettoye(kv: KV, id: string, now: number): Promise<void> {
  const s = analyser(await kv.hmget(CLES_CLARA.stats, [id]))[id];
  if (s) {
    s.total = 0; s.nonLus = 0; s.nettoye = now;
    delete s.parCategorie; delete s.categorie;
    await kv.hset(CLES_CLARA.stats, id, JSON.stringify(s));
  }
  await kv.hdel(CLES_CLARA.index, id);
}

/** Un passage complet plus vieux que `ms` : tout est recalculé depuis le début (une fois par jour). */
const RECALCUL_MS = 24 * 3600_000;

/**
 * Lit au plus 2 000 mails de « Tous les messages » à partir du curseur, cumule dans `clara:stats`.
 * `fini` : le bout de la boîte est atteint. Un nouvel appel lit ensuite seulement les mails arrivés depuis.
 * Le curseur garde aussi `maj` (date du dernier passage, en ms) pour décider d'un recalcul quotidien.
 */
export async function avancerStats(
  kv: KV, boite: Boite, now: number, options: { recalculQuotidien?: boolean } = {},
): Promise<{ fini: boolean; lus: number }> {
  // deux passages en même temps compteraient le même morceau : un seul à la fois (5 min au plus si l'appel meurt)
  if (!(await kv.setnx(VERROU, String(now), 300))) throw new Refus('statistiques déjà en cours', 409);
  try {
    if (options.recalculQuotidien) {
      // `debut` : début du passage complet en cours (`maj` change à chaque appel, il ne dit pas l'âge du passage)
      const c = await kv.hgetall(CLES_CLARA.curseur);
      if (c.fini === '1' && Number(c.debut) > 0 && now - Number(c.debut) >= RECALCUL_MS) await recommencerStats(kv);
    }
    return await avancer(kv, boite, now);
  } finally {
    await kv.del(VERROU).catch(() => undefined);
  }
}

async function avancer(kv: KV, boite: Boite, now: number): Promise<{ fini: boolean; lus: number }> {
  const { tous } = await boite.dossiers();
  const curseur = await kv.hgetall(CLES_CLARA.curseur);
  const depuis = Number(curseur.uid) || 0;
  // début du passage complet (pour le recalcul quotidien), écrit avec le reste du curseur
  const debut = async () => { if (!curseur.debut) await kv.hset(CLES_CLARA.curseur, 'debut', String(now)); };
  const mails = await boite.lireEntetes(tous, depuis, PAR_APPEL);
  const fini = mails.length < PAR_APPEL;
  if (!mails.length) {
    await kv.hset(CLES_CLARA.curseur, 'fini', '1');
    await kv.hset(CLES_CLARA.curseur, 'maj', String(now));
    await debut();
    return { fini: true, lus: 0 };
  }

  // une recherche Gmail par catégorie, bornée aux UID du morceau
  const plage = { de: mails[0].uid, a: mails[mails.length - 1].uid };
  const categorieDe = new Map<number, Categorie>();
  for (const c of CATEGORIES) {
    for (const uid of await boite.chercherGmail(tous, `category:${c}`, plage)) if (!categorieDe.has(uid)) categorieDe.set(uid, c);
  }

  // seulement les fiches des expéditeurs de ce morceau
  const idDe = new Map(mails.map(m => { const a = normaliser(m.de.adresse).adresse; return [m.uid, a ? idExpediteur(a) : ''] as const; }));
  const stats = analyser(await kv.hmget(CLES_CLARA.stats, [...new Set(idDe.values())].filter(Boolean)));
  const touches = new Set<string>();
  let nouveaux = 0;
  for (const m of mails) {
    const id = idDe.get(m.uid);
    if (!id) continue;
    const s: StatRangee = stats[id] ?? { id, adresse: normaliser(m.de.adresse).adresse, total: 0, nonLus: 0, dernier: 0 };
    // déjà compté (morceau rejoué après une écriture du curseur ratée) : rien à ajouter
    if (m.uid <= (s.uidMax ?? 0)) continue;
    s.uidMax = m.uid;
    s.total++;
    nouveaux++;
    if (!m.vu) s.nonLus++;
    const c = categorieDe.get(m.uid);
    if (c) s.parCategorie = { ...s.parCategorie, [c]: (s.parCategorie?.[c] ?? 0) + 1 };
    // nom, objet et désabonnement : ceux du mail le plus récent qui en a un
    if (m.date >= s.dernier) {
      s.dernier = m.date;
      if (m.de.nom) s.nom = m.de.nom;
      if (m.objet) s.exempleObjet = m.objet.slice(0, OBJET_MAX);
      const d = desabo(m);
      if (d) s.desabo = d;
    } else {
      if (!s.nom && m.de.nom) s.nom = m.de.nom;
      if (!s.exempleObjet && m.objet) s.exempleObjet = m.objet.slice(0, OBJET_MAX);
      if (!s.desabo) { const d = desabo(m); if (d) s.desabo = d; }
    }
    const maj = majoritaire(s);
    if (maj) s.categorie = maj; else delete s.categorie;
    stats[id] = s;
    touches.add(id);
  }

  // stats d'abord, curseur ensuite : un appel coupé entre les deux rejoue le morceau, `uidMax` évite le double compte
  const ids = [...touches];
  for (let i = 0; i < ids.length; i += 50) {
    await Promise.all(ids.slice(i, i + 50).map(id => kv.hset(CLES_CLARA.stats, id, JSON.stringify(stats[id]))));
  }
  await majIndex(kv, ids.map(id => stats[id]));
  // seulement les mails comptés pour la première fois : un morceau rejoué n'ajoute rien
  if (nouveaux) await kv.hincrby(CLES_CLARA.compteurs, 'lus', nouveaux);
  await kv.hset(CLES_CLARA.curseur, 'uid', String(plage.a));
  // le nombre total de mails, pour la barre d'avancement de la page (au mieux, après les statistiques)
  const total = await boite.total(tous).catch(() => 0);
  if (total > 0) await kv.hset(CLES_CLARA.curseur, 'total', String(total));
  await kv.hset(CLES_CLARA.curseur, 'fini', fini ? '1' : '0');
  await kv.hset(CLES_CLARA.curseur, 'maj', String(now));
  await debut();
  return { fini, lus: mails.length };
}

/** Range dans l'index les totaux des fiches touchées ; garde les INDEX_MAX plus gros. */
async function majIndex(kv: KV, touchees: StatRangee[]) {
  const avant = await kv.hgetall(CLES_CLARA.index);
  const index: Record<string, string> = { ...avant };
  for (const s of touchees) index[s.id] = String(s.total);
  const tries = Object.entries(index).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  const dedans = new Set(tries.slice(0, INDEX_MAX).map(([id]) => id));
  const ecrire = touchees.filter(s => dedans.has(s.id) && avant[s.id] !== String(s.total));
  const sortis = Object.keys(avant).filter(id => !dedans.has(id));
  for (let i = 0; i < ecrire.length; i += 50) await Promise.all(ecrire.slice(i, i + 50).map(s => kv.hset(CLES_CLARA.index, s.id, String(s.total))));
  for (const id of sortis) await kv.hdel(CLES_CLARA.index, id);
}

/** Efface le curseur, les statistiques, leur index et le compteur `lus` : le prochain `avancerStats` repart du début. */
export async function recommencerStats(kv: KV): Promise<void> {
  await kv.del(CLES_CLARA.curseur);
  await kv.del(CLES_CLARA.stats);
  await kv.del(CLES_CLARA.index);
  await kv.hdel(CLES_CLARA.compteurs, 'lus');
}

/**
 * La liste VIP de départ : les destinataires (To/Cc) de mes mails envoyés, normalisés, triés par fréquence,
 * sans ma propre adresse. Seuls les 2 000 envoyés les plus récents sont lus (un seul appel, borné).
 */
export async function candidatsVip(boite: Boite, max = 40, moi = process.env.GMAIL_ADRESSE ?? ''): Promise<string[]> {
  const { envoyes } = await boite.dossiers();
  const moiN = normaliser(moi).adresse;
  const freq = new Map<string, number>();
  for (const m of await boite.lireEntetes(envoyes, 0, PAR_APPEL, { derniers: true })) {
    for (const a of new Set([...m.a, ...m.cc].map(x => normaliser(x).adresse))) {
      if (a && a !== moiN && a.includes('@')) freq.set(a, (freq.get(a) ?? 0) + 1);
    }
  }
  return [...freq].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, max).map(([a]) => a);
}
