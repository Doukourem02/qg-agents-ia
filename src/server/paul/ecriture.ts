// Paul : « Valider » et « Refuser » (Telegram ou la page). Valider = le QG écrit le fichier sur GitHub (API contents,
// clé GITHUB_ECRITURE_PERSO, jamais journalisée) sur la branche par défaut, avec le sha du blob lu par Paul : si le
// fichier a bougé depuis (409/422), rien n'est écrasé. Pour CLAUDE.md, le serveur relit le fichier exact lu par Paul
// (blob de ce sha) et n'y remplace que le bloc « Où on s'est arrêté ». Réseau injecté.
import type { KV } from '../memoire';
import { ecrireEtat } from '../qg';
import { encoderChemin, type Recup } from '../light/sources';
import { nomCourt } from '../lea/etiquette';
import { reconstruire } from './bloc';
import { MASQUE } from './secrets';
import { CLES_PAUL, ecrireProposition, expiree, lireProposition } from './stockage';
import type { Proposition } from './types';

export type DepsEcriture = { fetch: Recup; /** La clé GITHUB_ECRITURE_PERSO. */ jeton: string | undefined };

const HOTE = 'https://api.github.com';
const DELAI_MS = 15_000;
const VERROU_S = 120;

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const entetes = (jeton: string): Record<string, string> => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${jeton}`, 'X-GitHub-Api-Version': '2022-11-28' });

export const messageCommit = (fichier: string) => `Paul (Archiviste) : ${fichier} à jour — validé par le patron`;

/** Le texte exact d'un blob (le fichier lu par Paul). Null si GitHub ne répond pas ou répond de travers. */
export async function lireBlob(f: Recup, jeton: string, depot: string, sha: string): Promise<string | null> {
  try {
    const r = await f(`${HOTE}/repos/${depot}/git/blobs/${encodeURIComponent(sha)}`, { headers: entetes(jeton), signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) return null;
    const b = obj(await r.json());
    if (!b || b.encoding !== 'base64' || typeof b.content !== 'string') return null;
    return Buffer.from(b.content.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** `inconnu` : la demande est partie mais la réponse manque (délai, coupure, panne de GitHub) — le commit a pu se faire. */
export type Ecrit = { etat: 'ok'; sha: string; url: string } | { etat: 'conflit' } | { etat: 'erreur' } | { etat: 'inconnu' };

/**
 * PUT /repos/{dépôt}/contents/{fichier} : avec `sha` = le blob lu (absent pour un fichier nouveau), sur la branche
 * donnée. 409 ou 422 → « conflit » : le fichier a changé (ou est apparu) depuis la lecture ; GitHub n'écrit rien.
 */
export async function ecrireFichier(
  f: Recup, jeton: string, depot: string, fichier: string, contenu: string, base: string | null, branche: string,
): Promise<Ecrit> {
  try {
    const r = await f(`${HOTE}/repos/${depot}/contents/${encoderChemin(fichier)}`, {
      method: 'PUT',
      headers: { ...entetes(jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ message: messageCommit(fichier), content: Buffer.from(contenu, 'utf8').toString('base64'), branch: branche, ...(base ? { sha: base } : {}) }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (r.status === 409 || r.status === 422) return { etat: 'conflit' };
    if (r.status >= 500) return { etat: 'inconnu' };
    if (!r.ok) return { etat: 'erreur' };
    // GitHub a accepté : le fichier est écrit, même si la réponse ne se lit pas
    const c = obj(obj(await r.json().catch(() => null))?.commit);
    const sha = typeof c?.sha === 'string' ? c.sha : '';
    const url = typeof c?.html_url === 'string' && c.html_url.startsWith('https://github.com/') ? c.html_url : '';
    return { etat: 'ok', sha, url };
  } catch {
    // délai ou coupure après l'envoi : GitHub a pu écrire
    return { etat: 'inconnu' };
  }
}

const quoi = (p: Proposition) => `${p.fichier} de ${nomCourt(p.depot)}`;

/** La réponse à un second clic (ou à un clic sur une proposition qui n'attend plus) : « déjà noté ». */
const DEJA: Record<Exclude<Proposition['statut'], 'attente'>, (p: Proposition) => string> = {
  appliquee: p => `Déjà noté : ${quoi(p)} est déjà écrit.`,
  refusee: p => `Déjà noté : tu as refusé ${quoi(p)}.`,
  bougee: p => `Déjà noté : ${quoi(p)} avait bougé, Paul reproposera jeudi.`,
  remplacee: p => `Déjà noté : cette proposition pour ${quoi(p)} a été remplacée par une plus récente.`,
  expiree: p => `Déjà noté : la proposition pour ${quoi(p)} a expiré, Paul reproposera jeudi.`,
  bloquee: p => `Déjà noté : la proposition pour ${quoi(p)} a été bloquée par le QG, rien n'est écrit.`,
};

/**
 * Le clic Valider (`valider`) ou Refuser sur une proposition. Rend la réponse en une ligne (Telegram ou la page).
 * Valider écrit au plus une fois (verrou court contre le double clic) ; seule une écriture réussie marque « appliquée ».
 * GitHub injoignable ou clé absente : rien n'est écrit et la proposition reste en attente.
 */
export async function deciderPaul(kv: KV, id: string, valider: boolean, deps: DepsEcriture, now: number = Date.now()): Promise<string> {
  const vu = await lireProposition(kv, id);
  if (!vu) return 'Cette proposition de Paul est inconnue.';
  if (vu.statut !== 'attente') return DEJA[vu.statut](vu);
  // Un clic à la fois par proposition : le second (double clic, Telegram et la page en même temps) attend son tour.
  if (!(await kv.setnx(CLES_PAUL.ecriture(id), '1', VERROU_S))) return `Paul s'occupe déjà de ${quoi(vu)} : patiente un instant.`;
  try {
    // relue sous le verrou : un clic qui vient de finir a pu la traiter
    const p = await lireProposition(kv, id);
    if (!p) return 'Cette proposition de Paul est inconnue.';
    if (p.statut !== 'attente') return DEJA[p.statut](p);
    if (expiree(p, now)) {
      await ecrireProposition(kv, { ...p, statut: 'expiree' });
      return `Cette proposition pour ${quoi(p)} a plus de 8 jours : rien n'est écrit, Paul reproposera jeudi.`;
    }
    if (!valider) {
      await ecrireProposition(kv, { ...p, statut: 'refusee', decide: now });
      await ecrireEtat(kv, { agent: 'paul', statut: 'termine', tache: `laisse ${quoi(p)} tel quel`.slice(0, 140) }, now);
      return `Noté : je laisse ${quoi(p)} tel quel.`;
    }
    const jeton = deps.jeton;
    if (!jeton) return 'La clé d\'écriture GitHub manque sur le serveur : rien n\'est écrit.';
    let contenu: string;
    if (p.fichier === 'README.md') {
      contenu = p.contenu ?? '';
      // Défense en profondeur : un masque du QG (« [clé … masquée] ») qui n'est pas dans le vrai fichier écraserait
      // une vraie valeur. Le vrai fichier est relu (le blob exact lu par Paul) avant d'écrire.
      const masques = contenu.match(MASQUE) ?? [];
      if (masques.length) {
        const actuel = p.base ? await lireBlob(deps.fetch, jeton, p.depot, p.base) : '';
        if (actuel === null) return 'GitHub ne répond pas : rien n\'est écrit, réessaie dans un moment.';
        if (masques.some(m => !actuel.includes(m))) {
          await ecrireProposition(kv, { ...p, statut: 'bloquee', decide: now });
          return `${quoi(p)} contient un masque de clé à la place d'une vraie valeur : rien n'est écrit.`;
        }
      }
    } else {
      const actuel = p.base ? await lireBlob(deps.fetch, jeton, p.depot, p.base) : '';
      if (actuel === null) return 'GitHub ne répond pas : rien n\'est écrit, réessaie dans un moment.';
      try { contenu = reconstruire(actuel, p.bloc ?? ''); } catch {
        await ecrireProposition(kv, { ...p, statut: 'bougee', decide: now });
        return `Les marqueurs de Paul sont abîmés dans ${quoi(p)} : rien n'est écrit.`;
      }
    }
    if (!contenu.trim()) return 'Cette proposition est vide : rien n\'est écrit.';
    const r = await ecrireFichier(deps.fetch, jeton, p.depot, p.fichier, contenu, p.base, p.branche);
    if (r.etat === 'erreur') return 'GitHub n\'a pas accepté l\'écriture : rien n\'est écrit, réessaie dans un moment.';
    // résultat inconnu : la proposition reste en attente ; un nouveau Valider réécrit avec le même sha, donc si le
    // premier envoi a abouti, GitHub répond 409 et rien n'est écrasé
    if (r.etat === 'inconnu') return `Résultat inconnu pour ${quoi(p)} : GitHub n'a pas répondu à temps, regarde sur GitHub avant de revalider.`;
    if (r.etat === 'conflit') {
      await ecrireProposition(kv, { ...p, statut: 'bougee', decide: now });
      await ecrireEtat(kv, { agent: 'paul', statut: 'termine', tache: `n'a rien écrit : ${quoi(p)} a bougé`.slice(0, 140), outil: 'GH' }, now);
      return 'Le fichier a bougé depuis : rien n\'est écrasé, Paul reproposera jeudi.';
    }
    const court = r.sha.slice(0, 7);
    await ecrireProposition(kv, { ...p, statut: 'appliquee', decide: now, ...(r.sha ? { commit: { sha: r.sha, url: r.url } } : {}) });
    await ecrireEtat(kv, { agent: 'paul', statut: 'termine', tache: `a mis à jour ${quoi(p)}`.slice(0, 140), outil: 'GH', ...(court ? { resultat: `commit ${court}` } : {}) }, now);
    return `C'est écrit : ${quoi(p)} est à jour${court ? ` (commit ${court})` : ''}.`;
  } finally {
    await kv.del(CLES_PAUL.ecriture(id)).catch(() => undefined);
  }
}
