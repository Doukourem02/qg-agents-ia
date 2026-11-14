import type { KV } from '../memoire';
import { commentaireLinkedIn, ErreurPublication, jetonRefuse, LIMITE_COMMENTAIRE } from '../linkedin/api';
import { oublierConnexion, type Connexion } from '../linkedin/connexion';
import type { Rendu } from './api';
import { noterPublie } from './memoire';
import { ecrireEtat } from '../qg';
import { ecrirePost, lirePost, type Post } from './posts';
import type { Visuel } from './visuels';

// La publication d'un post validé sur LinkedIn, au bouton du patron. Jamais deux fois le même post :
// un verrou contre les clics simultanés, et une `tentative` notée juste avant l'envoi. Si l'envoi finit dans le
// doute (le post est peut-être parti), la tentative reste et seul « Republier » (forcer) relance.
// Ne lève jamais pour un échec attendu : chaque issue est un résultat.

export type ResultatPublication =
  | { etat: 'publie' | 'deja'; url: string }
  | { etat: 'non-connecte' | 'en-cours' | 'incertain' | 'inconnu' }
  | { etat: 'pas-pret'; statut: Post['statut'] }
  | { etat: 'echec'; raison: string };

export type DepsPublication = {
  connexion: () => Promise<Connexion | null>;
  rendre?: (v: Visuel) => Promise<Rendu>;
  televerser: (jeton: string, auteur: string, genre: 'image' | 'document', contenu: Uint8Array) => Promise<string>;
  creerPost: (jeton: string, p: { auteur: string; commentaire: string; media?: { id: string; titre?: string } }) => Promise<string>;
};

const VERROU_S = 300;
const cleVerrou = (id: string) => `linkedin:verrou:${id}`;
export const urlPost = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;

/** Ce qu'on peut dire d'un post sans rien tenter ; null s'il est prêt à partir. */
function constat(post: Post | null): ResultatPublication | null {
  if (!post) return { etat: 'inconnu' };
  if (post.statut === 'publie') return { etat: 'deja', url: post.linkedin?.url ?? '' };
  if (post.statut !== 'pret') return { etat: 'pas-pret', statut: post.statut };
  return null;
}

/** Le post sans `tentative` (et sans `linkedin` s'il ne reste rien dedans). */
function sansTentative(post: Post): Post {
  const { linkedin, ...reste } = post;
  if (!linkedin) return reste;
  const l = { ...linkedin };
  delete l.tentative;
  return Object.keys(l).length ? { ...reste, linkedin: l } : reste;
}

/** Retire `tentative` du post tel qu'il est MAINTENANT (relu) : un « Déjà publié » touché entre-temps reste. */
async function retirerTentative(kv: KV, postId: string) {
  const courant = await lirePost(kv, postId);
  if (courant) await ecrirePost(kv, sansTentative(courant));
}

/** LinkedIn ne reconnaît plus le jeton (révoqué avant son expiration) : on l'oublie, les rappels apparaissent. */
async function jetonPerdu(kv: KV): Promise<ResultatPublication> {
  await oublierConnexion(kv).catch(e => console.error(e));
  return { etat: 'non-connecte' };
}

export const ECHEC_ENREGISTREMENT: ResultatPublication = { etat: 'echec', raison: "le QG n'a pas pu enregistrer l'envoi, réessaie" };

export async function publierPost(kv: KV, postId: string, deps: DepsPublication, forcer = false, now = Date.now()): Promise<ResultatPublication> {
  let verrou = false;
  try {
    const avant = constat(await lirePost(kv, postId));
    if (avant) return avant;
    verrou = await kv.setnx(cleVerrou(postId), '1', VERROU_S);
    if (!verrou) return { etat: 'en-cours' };
    return await sousVerrou(kv, postId, deps, forcer, now);
  } catch (e) {
    // seul ce qui précède l'envoi à LinkedIn peut lever jusqu'ici (lectures, verrou, `tentative`) : rien n'est parti
    console.error(e);
    return ECHEC_ENREGISTREMENT;
  } finally {
    if (verrou) await kv.del(cleVerrou(postId)).catch(e => console.error(e));
  }
}

/** La publication proprement dite, verrou pris. Après l'appel à `creerPost`, plus rien ne lève. */
async function sousVerrou(kv: KV, postId: string, deps: DepsPublication, forcer: boolean, now: number): Promise<ResultatPublication> {
  // relu sous le verrou : un autre clic a pu le publier entre-temps
  const post = await lirePost(kv, postId);
  const sous = constat(post);
  if (sous || !post) return sous ?? { etat: 'inconnu' };
  if (post.linkedin?.tentative !== undefined && !forcer) return { etat: 'incertain' };

  const connexion = await deps.connexion();
  if (!connexion) return { etat: 'non-connecte' };
  const commentaire = commentaireLinkedIn(post.texte, post.hashtags);
  if (commentaire.length > LIMITE_COMMENTAIRE) return { etat: 'echec', raison: 'texte trop long pour LinkedIn' };

  let media: { id: string; titre?: string } | undefined;
  if (post.visuel) {
    try {
      if (!deps.rendre) throw new Error('rendu non branché');
      const { png, pdf } = await deps.rendre(post.visuel);
      if (post.visuel.modele === 'carrousel') {
        if (!pdf) throw new Error('PDF du carrousel manquant');
        media = { id: await deps.televerser(connexion.jeton, connexion.auteur, 'document', pdf), titre: post.sujet };
      } else {
        media = { id: await deps.televerser(connexion.jeton, connexion.auteur, 'image', png) };
      }
    } catch (e) {
      console.error(e);
      if (jetonRefuse(e)) return jetonPerdu(kv);
      return { etat: 'echec', raison: "le visuel n'a pas pu partir" };
    }
  }

  // noté juste avant l'envoi : si la réponse se perd, on saura qu'un post a peut-être été créé
  await ecrirePost(kv, { ...post, linkedin: { ...post.linkedin, tentative: now } });
  let urn: string;
  try {
    urn = await deps.creerPost(connexion.jeton, { auteur: connexion.auteur, commentaire, ...(media ? { media } : {}) });
  } catch (e) {
    console.error(e);
    // une erreur imprévue compte comme incertaine : mieux vaut faire vérifier que publier deux fois
    if (e instanceof ErreurPublication && !e.incertain) {
      await retirerTentative(kv, post.id).catch(err => console.error(err));
      if (e.nonConnecte) return jetonPerdu(kv);
      return { etat: 'echec', raison: 'LinkedIn a refusé le post' };
    }
    return { etat: 'incertain' };
  }

  const url = urlPost(urn);
  try {
    // relu : on part de l'état actuel du post, pas de celui lu avant les appels à LinkedIn
    const courant = (await lirePost(kv, post.id)) ?? post;
    await ecrirePost(kv, { ...sansTentative(courant), statut: 'publie', linkedin: { urn, url, quand: now } });
    // la page allume l'icône LinkedIn sur L (sans jamais bloquer la publication)
    await ecrireEtat(kv, { agent: 'L', statut: 'termine', tache: 'publie sur LinkedIn', outil: 'in' }, now).catch(() => undefined);
  } catch (e) {
    // le post est parti mais n'est pas noté : la tentative reste, le prochain clic demandera de vérifier
    console.error(e);
    return { etat: 'incertain' };
  }
  await noterPublie(kv, { id: post.id, sujet: post.sujet, quand: now }).catch(e => console.error(e));
  return { etat: 'publie', url };
}
