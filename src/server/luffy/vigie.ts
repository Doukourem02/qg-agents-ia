import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { SITES, type Site } from './sites';
import { duree } from '@/data/duree';

// La vigie de Luffy : un passage vérifie tous les sites, compte les échecs de suite, prévient sur Telegram.
// Une action = une fonction, testable sans réseau (fetch et envoi sont injectés).

export const CLES_LUFFY = { etat: 'luffy:etat', pannes: 'luffy:pannes', dernier: 'luffy:dernier', verrou: 'luffy:verrou' } as const;

/** `luffy:etat` : table site → JSON. `depuis` = début de la panne (1er échec de la série). */
export type EtatSite = { echecs: number; depuis?: number; annoncee?: boolean; raison?: string; vu: number };
/** `luffy:pannes` : liste JSON, la plus récente en tête, gardée 30 jours. */
export type Panne = { site: string; nom: string; debut: number; fin?: number };
/** `envoyer` : avec un bouton « Ignorer » par site tombé (la route passe par la pause générale, src/server/silence.ts). */
export type DepsLuffy = { fetch: typeof fetch; envoyer: (texte: string, boutons?: { texte: string; donnee: string }[][]) => Promise<unknown> };

const DELAI_MS = 15_000;
const VERROU_S = 240;
const ECHECS_POUR_ALERTE = 2;
const GARDE_PANNES_MS = 30 * 86_400_000;

/** « 25 min », « 2 h 10 », « 3 j 4 h » : partagée avec la page (src/data/duree.ts). */
export { duree };

type Resultat = { ok: true } | { ok: false; raison: string };

async function sonder(site: Site, deps: DepsLuffy): Promise<Resultat> {
  try {
    const r = await deps.fetch(site.url, {
      method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'QG-Vigie/1.0' }, signal: AbortSignal.timeout(DELAI_MS),
    });
    await r.body?.cancel().catch(() => {}); // libère la connexion
    return site.normal(r.status) ? { ok: true } : { ok: false, raison: `erreur ${r.status}` };
  } catch (e) {
    const nom = e instanceof Error || e instanceof DOMException ? e.name : '';
    return { ok: false, raison: nom === 'TimeoutError' || nom === 'AbortError' ? 'délai dépassé' : 'site introuvable' };
  }
}

function lire<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined;
  try { return JSON.parse(brut) as T; } catch { return undefined; }
}

async function lirePannes(kv: KV): Promise<Panne[]> {
  return (await kv.lrange(CLES_LUFFY.pannes, 0, -1)).flatMap(v => lire<Panne>(v) ?? []);
}
async function ecrirePannes(kv: KV, liste: Panne[]) {
  await kv.del(CLES_LUFFY.pannes);
  for (const p of [...liste].reverse()) await kv.lpush(CLES_LUFFY.pannes, JSON.stringify(p)); // la plus récente reste en tête
}

type Alerte = { site: Site; etat: EtatSite; ligne: string };
type Retour = { site: Site; etat: EtatSite; debut: number; ligne: string };

async function passage(kv: KV, deps: DepsLuffy, now: number) {
  const resultats = await Promise.all(SITES.map(async s => [s, await sonder(s, deps)] as const));
  // Tous en échec : c'est le QG qui a un souci réseau, pas les sites. Le passage ne compte pas.
  if (resultats.every(([, r]) => !r.ok)) return { ignore: true as const, alertes: [], retours: [] };

  const bruts = await kv.hgetall(CLES_LUFFY.etat);
  const ecrire: [string, EtatSite][] = [];
  const alertes: Alerte[] = [];
  const retours: Retour[] = [];
  for (const [site, r] of resultats) {
    const avant = lire<EtatSite>(bruts[site.id]);
    if (r.ok) {
      if (avant?.annoncee) {
        const etat: EtatSite = { ...avant, vu: now };
        const debut = avant.depuis ?? now;
        retours.push({ site, etat, debut, ligne: `✅ ${site.nom} est revenu, panne de ${duree(now - debut)}.` });
      } else ecrire.push([site.id, { echecs: 0, vu: now }]);
    } else {
      const etat: EtatSite = {
        echecs: (avant?.echecs ?? 0) + 1, depuis: avant?.depuis ?? now, annoncee: avant?.annoncee, raison: r.raison, vu: now,
      };
      if (!etat.annoncee) delete etat.annoncee;
      if (etat.echecs >= ECHECS_POUR_ALERTE && !etat.annoncee) {
        alertes.push({ site, etat, ligne: `⚠️ ${site.nom} ne répond plus (${r.raison}).` });
      } else ecrire.push([site.id, etat]);
    }
  }

  // Un seul message pour tout le passage. S'il ne part pas, rien n'est marqué : tout repart au passage suivant.
  const lignes = [...alertes, ...retours].map(x => x.ligne);
  let parti = false;
  if (lignes.length) {
    // un bouton « Ignorer » par site tombé (« c'est connu ») ; un retour n'en a pas
    const boutons = alertes.map(a => [{ texte: `Ignorer ${a.site.nom}`, donnee: `ign:site:${a.site.id}` }]);
    try { await deps.envoyer(lignes.join('\n'), boutons.length ? boutons : undefined); parti = true; } catch { parti = false; console.error('luffy : envoi Telegram échoué'); }
  }

  let pannes = await lirePannes(kv);
  if (parti) {
    for (const a of alertes) {
      ecrire.push([a.site.id, { ...a.etat, annoncee: true }]);
      pannes = [{ site: a.site.id, nom: a.site.nom, debut: a.etat.depuis ?? now }, ...pannes];
    }
    for (const r of retours) {
      ecrire.push([r.site.id, { echecs: 0, vu: now }]);
      const i = pannes.findIndex(p => p.site === r.site.id && p.fin === undefined);
      if (i >= 0) pannes[i] = { ...pannes[i], fin: now };
      else pannes = [{ site: r.site.id, nom: r.site.nom, debut: r.debut, fin: now }, ...pannes];
    }
  } else {
    for (const a of alertes) ecrire.push([a.site.id, a.etat]); // échecs comptés, `annoncee` reste faux
    for (const r of retours) ecrire.push([r.site.id, r.etat]); // `annoncee` reste vrai : le « revenu » repart
  }
  pannes = pannes.filter(p => (p.fin ?? p.debut) >= now - GARDE_PANNES_MS);

  for (const [id, e] of ecrire) await kv.hset(CLES_LUFFY.etat, id, JSON.stringify(e));
  await ecrirePannes(kv, pannes);
  await kv.hset(CLES_LUFFY.dernier, 'quand', String(now));
  // Le journal global (300 entrées) ne garde que ce qui se passe : un passage tranquille ne met à jour que l'état en direct.
  if (parti) {
    const morceaux = [
      ...(alertes.length ? [`${alertes.map(a => a.site.nom).join(', ')} en panne`] : []),
      ...(retours.length ? [`${retours.map(r => r.site.nom).join(', ')} ${retours.length > 1 ? 'revenus' : 'revenu'}`] : []),
    ];
    await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: `prévient : ${morceaux.join(' ; ')}`.slice(0, 140), outil: 'Tg' }, now);
  } else {
    await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: 'vérifie les sites' }, now, { journal: false });
  }
  return {
    alertes: parti ? alertes.map(a => a.ligne) : [],
    retours: parti ? retours.map(r => r.ligne) : [],
  };
}

export async function verifier(kv: KV, deps: DepsLuffy, now: number): Promise<{ ignore?: true; alertes: string[]; retours: string[] } | { occupe: true }> {
  // Un passage à la fois : un passage en double ne double ni les compteurs ni les messages.
  if (!(await kv.setnx(CLES_LUFFY.verrou, '1', VERROU_S))) return { occupe: true };
  try {
    return await passage(kv, deps, now);
  } finally {
    await kv.del(CLES_LUFFY.verrou).catch(() => undefined);
  }
}

export async function traiterActionLuffy(kv: KV, action: string, deps: DepsLuffy, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'verifier': return verifier(kv, deps, now);
    default: throw new Refus('action inconnue', 404);
  }
}
