import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { etatCles, JOURS_AVANT_ALERTE } from './cles';
import { dependancesDuDepot, depotsActifs, etatCI } from './github';
import { importants, MAC_VIEUX_JOURS, messageTelegram } from './importance';
import { lireIgnores } from '../silence';
import { CLES_ZORO, enregistrerRapportMac, lireRapportMac, rapportDemande } from './mac';
import { chercherFailles } from './osv';
import { NON_LU, partieNonLue, resumeNonLu } from './etiquette';
import type { Projet, Tour } from './types';

// Le tour de Zoro : lit GitHub, OSV, les clés et le dernier rapport du Mac, décide ce qui est important,
// prévient sur Telegram (action `tour` seulement) et se souvient de ce qui a déjà été signalé.
// Les règles d'importance et le message sont dans importance.ts. Réseau et envoi injectés : testable sans réseau.

export { importants, messageTelegram } from './importance';
export { NON_LU } from './etiquette';

export type DepsZoro = {
  fetch: typeof fetch;
  envoyer: (texte: string) => Promise<unknown>;
  jeton: string | undefined;
  linkedin: (kv: KV) => Promise<{ expire: number } | null>;
  /** Échéance commune du tour en ms (240 s par défaut) ; réglable pour les tests. */
  echeance?: number;
};

const JOUR = 86_400_000;
const ECHEANCE_MS = 240_000;
const VERROU_S = 280;
const PARALLELE = 3;
const HISTORIQUE_MAX = 8;
const HEURE_TOUR = 9 * 3_600_000;
const MARGE_MS = 10 * 60_000; // un réveil QStash quelques secondes avant 09:00 (horloges) reste dans son mardi
const MARQUE_S = 8 * 86_400;  // la marque d'envoi vit 8 jours : plus longtemps que son créneau
const CHAMP = 'json';
const CHAMP_EXPIRATION = 'expirationGitHub'; // dernière échéance de la clé GitHub lue en direct (ms), dans zoro:tour

export type EntreeHistorique = { quand: number; importants: number };

/**
 * Le créneau d'un tour : le dernier mardi 09:00 UTC atteint (à 10 minutes près). Un tour lancé le lundi appartient au
 * mardi d'avant : un tour de validation ne bloque donc jamais le message du mardi suivant.
 */
export function creneauDuTour(now: number): number {
  const t = now + MARGE_MS;
  const minuit = t - (((t % JOUR) + JOUR) % JOUR);
  const recul = (new Date(minuit).getUTCDay() - 2 + 7) % 7; // getUTCDay : mardi = 2
  let c = minuit - recul * JOUR + HEURE_TOUR;
  if (c > t) c -= 7 * JOUR;
  return c;
}

/** Une entrée d'historique par mardi : un nouvel essai ou un tour relancé remplace celle de son créneau. */
async function ajouterHistorique(kv: KV, entree: EntreeHistorique): Promise<void> {
  const creneau = creneauDuTour(entree.quand);
  const avant = await lireHistorique(kv);
  if (avant.some(h => creneauDuTour(h.quand) === creneau)) {
    const garde = [entree, ...avant.filter(h => creneauDuTour(h.quand) !== creneau)].slice(0, HISTORIQUE_MAX);
    await kv.del(CLES_ZORO.historique);
    for (const h of [...garde].reverse()) await kv.lpush(CLES_ZORO.historique, JSON.stringify(h));
    return;
  }
  await kv.lpush(CLES_ZORO.historique, JSON.stringify(entree));
  await kv.ltrim(CLES_ZORO.historique, 0, HISTORIQUE_MAX - 1);
}

function lire<T>(brut: string | undefined): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

export async function lireTour(kv: KV): Promise<Tour | null> {
  return lire<Tour>((await kv.hmget(CLES_ZORO.tour, [CHAMP]))[CHAMP]);
}

export async function lireSignales(kv: KV): Promise<string[]> {
  const l = lire<unknown>((await kv.hmget(CLES_ZORO.signales, [CHAMP]))[CHAMP]);
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
}

export async function lireHistorique(kv: KV): Promise<EntreeHistorique[]> {
  return (await kv.lrange(CLES_ZORO.historique, 0, -1)).flatMap(v => lire<EntreeHistorique>(v) ?? []);
}

/**
 * L'échéance de la clé GitHub à utiliser. Lue en direct : on la retient. Pas lue alors que la clé existe (GitHub ne
 * répond plus, souvent justement parce que la clé a expiré) : la dernière connue, seulement si elle est dans 14 jours
 * ou moins (ou passée) — c'est une alerte. Plus loin, ou jamais connue : la clé n'est pas listée (aucune fausse alerte).
 */
async function expirationGitHub(kv: KV, lue: number | null | undefined, jeton: string | undefined, now: number) {
  if (typeof lue === 'number') { await kv.hset(CLES_ZORO.tour, CHAMP_EXPIRATION, String(lue)); return lue; }
  if (lue === null) { await kv.hdel(CLES_ZORO.tour, CHAMP_EXPIRATION); return null; }
  if (!jeton) return undefined;
  const connue = Number((await kv.hmget(CLES_ZORO.tour, [CHAMP_EXPIRATION]))[CHAMP_EXPIRATION]);
  return Number.isFinite(connue) && connue - now <= JOURS_AVANT_ALERTE * JOUR ? connue : undefined;
}

/** Un dépôt lu en entier avant l'échéance, ou null (il ira dans `nonLus`). */
async function lireProjet(deps: DepsZoro, jeton: string, depot: string, pousse: number, fin: AbortSignal): Promise<Projet | null> {
  if (fin.aborted) return null;
  try {
    const [dependances, ci] = await Promise.all([
      dependancesDuDepot(deps.fetch, jeton, depot, fin),
      etatCI(deps.fetch, jeton, depot, fin),
    ]);
    const failles = dependances === null ? null : dependances.length === 0 ? [] : await chercherFailles(dependances, deps.fetch, fin);
    if (fin.aborted) return null;
    return { depot, pousse, failles, ...(dependances?.length === 0 ? { sansDependances: true as const } : {}), ci };
  } catch {
    return null;
  }
}

async function lireGitHub(deps: DepsZoro, now: number, fin: AbortSignal) {
  const jeton = deps.jeton;
  if (!jeton) return { projets: [], nonLus: [NON_LU.sansCle], expiration: undefined };
  let liste: Awaited<ReturnType<typeof depotsActifs>>;
  try { liste = await depotsActifs(deps.fetch, jeton, now, fin); } catch {
    return { projets: [], nonLus: [NON_LU.github], expiration: undefined };
  }
  // Trois dépôts à la fois ; l'ordre de la liste GitHub est gardé.
  const lus: (Projet | null)[] = liste.depots.map(() => null);
  let suivant = 0;
  const travailleur = async () => {
    for (let i = suivant++; i < liste.depots.length; i = suivant++) {
      lus[i] = await lireProjet(deps, jeton, liste.depots[i].depot, liste.depots[i].pousse, fin);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLELE, liste.depots.length) }, travailleur));
  const projets = lus.filter((p): p is Projet => p !== null);
  const nonLus: string[] = liste.depots.filter((_, i) => lus[i] === null).map(d => d.depot);
  if (liste.expiration === undefined) nonLus.push(NON_LU.cleGithub);
  return { projets, nonLus, expiration: liste.expiration };
}

/**
 * Une clé signalée dont la source n'a pas été lue ce tour-ci : on la garde en mémoire, sinon elle reviendrait
 * comme « nouvelle » la semaine où la lecture marche à nouveau.
 */
function nonRelue(cle: string, t: Tour): boolean {
  const [genre, ...reste] = cle.split(':');
  // Un dépôt absent n'est gardé que s'il n'a pas été lu (pas s'il est devenu dormant).
  const pasLu = (depot: string) => t.nonLus.includes(depot) || t.nonLus.includes(NON_LU.github) || t.nonLus.includes(NON_LU.sansCle);
  const projet = (depot: string) => t.projets.find(p => p.depot === depot);
  if (genre === 'faille') { const p = projet(reste[0]); return p ? p.failles === null : pasLu(reste[0]); }
  if (genre === 'ci') { const p = projet(reste.join(':')); return p ? p.ci.etat === 'illisible' : pasLu(reste.join(':')); }
  if (genre === 'cle') return !t.cles.some(c => c.nom === reste.join(':'));
  if (genre === 'mac') {
    if (!t.mac || t.macVieux) return true;
    const nom = reste.slice(0, -1).join(':');
    const d = t.mac.dossiers.find(x => x.nom === nom);
    return d?.illisible === true;
  }
  return false;
}

/**
 * Le résumé du journal : des nombres seulement, jamais un nom. « lus » = lus en entier (failles et tests) ;
 * tout ce qui manque (dépôt, GitHub, clé, failles ou tests illisibles, Mac pas vu, dossier non lu) → « une partie non lue ».
 */
function resumeEtat(prefixe: string, t: Tour, parti: boolean, dejaParti = false): string {
  const n = t.importants.length;
  const p = t.projets.filter(x => x.failles !== null && x.ci.etat !== 'illisible').length;
  const morceaux = [
    `${n} ${n > 1 ? 'points importants' : 'point important'}`,
    `${p} ${p > 1 ? 'projets lus' : 'projet lu'}`,
    ...(partieNonLue(t) ? ['une partie non lue'] : []),
    ...(parti ? ['prévenu sur Telegram'] : []),
    ...(dejaParti ? ['message de ce mardi déjà parti'] : []),
  ];
  return `${prefixe} : ${morceaux.join(', ')}`.slice(0, 140);
}

/**
 * `tour` : Telegram si important, au plus un message par mardi (marque `zoro:envoye:<créneau>` posée juste après l'envoi),
 * mémoire « déjà signalé » (seulement si le message est parti, ou s'il n'y avait rien à envoyer) et historique des 8 derniers.
 * Un tour déjà en cours ou un message qui n'est pas parti → Refus 503 : QStash réessaie (la marque évite tout doublon).
 * `verifier` : seulement le dernier résultat (zoro:tour) ; occupé → { occupe: true }, jamais d'envoi.
 */
export async function faireTour(kv: KV, deps: DepsZoro, now: number, type: 'tour' | 'verifier'): Promise<Tour | { occupe: true }> {
  if (!(await kv.setnx(CLES_ZORO.verrou, '1', VERROU_S))) {
    if (type === 'tour') throw new Refus('un tour est déjà en cours', 503);
    return { occupe: true };
  }
  const tache = type === 'tour' ? 'fait le tour de sécurité' : 'vérifie à la demande';
  let tour: Tour;
  let pasParti = false;
  try {
    await ecrireEtat(kv, { agent: 'zoro', statut: 'au travail', tache, outil: 'GH' }, now, { journal: false });
    const fin = AbortSignal.timeout(deps.echeance ?? ECHEANCE_MS);
    const [github, linkedin, mac] = await Promise.all([lireGitHub(deps, now, fin), deps.linkedin(kv), lireRapportMac(kv)]);
    const base: Omit<Tour, 'importants'> = {
      quand: now, type, projets: github.projets, nonLus: github.nonLus,
      cles: etatCles(await expirationGitHub(kv, github.expiration, deps.jeton, now), linkedin, now),
      mac, macVieux: mac === null || now - mac.quand > MAC_VIEUX_JOURS * JOUR,
    };
    tour = { ...base, importants: importants(base, now) };
    await kv.hset(CLES_ZORO.tour, CHAMP, JSON.stringify(tour));

    let parti = false;
    let dejaParti = false;
    if (type === 'tour') {
      const marque = CLES_ZORO.envoye(creneauDuTour(now));
      const deja = await lireSignales(kv);
      // ce que le patron a dit d'ignorer (« tais-toi pour les failles de Zoro ») n'est pas redit ; une nouvelle faille, si
      const ignores = new Set((await lireIgnores(kv).catch(() => [])).map(i => i.cle));
      const aDire = tour.importants.filter(i => !ignores.has(`zoro:${i.cle}`));
      const texte = messageTelegram(aDire, new Set(deja), resumeNonLu(tour));
      if (texte) {
        dejaParti = (await kv.get(marque)) !== null;
        if (!dejaParti) {
          try { await deps.envoyer(texte); parti = true; } catch { console.error('zoro : envoi Telegram échoué'); }
          if (parti) await kv.setnx(marque, String(now), MARQUE_S);
          else pasParti = true;
        }
      }
      // Déjà parti ce mardi : la mémoire reste celle du message envoyé (rien de nouveau n'a été dit).
      if (parti || !texte) {
        const actuelles = tour.importants.map(i => i.cle);
        const gardees = deja.filter(c => !actuelles.includes(c) && nonRelue(c, tour));
        await kv.hset(CLES_ZORO.signales, CHAMP, JSON.stringify([...actuelles, ...gardees]));
      }
      await ajouterHistorique(kv, { quand: now, importants: tour.importants.length });
    }
    // Message pas parti : le tour n'est pas compté comme fait (le calendrier attend le nouvel essai de QStash).
    const fini = pasParti
      ? { statut: 'erreur', tache: 'tour fait, mais le message Telegram n\'est pas parti' }
      : { statut: 'termine', tache: resumeEtat(tache, tour, parti, dejaParti) };
    await ecrireEtat(kv, { agent: 'zoro', ...fini, outil: 'GH' }, now);
  } catch (e) {
    // Jamais « fait le tour… » ici : un tour raté ne doit pas compter comme passé dans le calendrier.
    const echec = type === 'tour' ? 'le tour de sécurité a échoué' : 'la vérification a échoué';
    await ecrireEtat(kv, { agent: 'zoro', statut: 'erreur', tache: echec, outil: 'GH' }, now).catch(() => undefined);
    throw e;
  } finally {
    await kv.del(CLES_ZORO.verrou).catch(() => undefined);
  }
  if (pasParti) throw new Refus('le message Telegram n\'est pas parti, nouvel essai attendu', 503);
  return tour;
}

/** Les actions de la route d'agent. `corps` : le JSON reçu en POST (undefined en GET). */
export async function traiterActionZoro(kv: KV, action: string, corps: unknown, deps: DepsZoro, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'tour':
    case 'verifier':
      return faireTour(kv, deps, now, action);
    case 'mac':
      if (corps === undefined) throw new Refus('le rapport du Mac s\'envoie en POST', 405);
      return enregistrerRapportMac(kv, corps, now);
    case 'a-envoyer':
      return { demande: await rapportDemande(kv) };
    default:
      throw new Refus('action inconnue', 404);
  }
}
