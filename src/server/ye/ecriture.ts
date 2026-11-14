// Ye : « Valider » / « Refuser » une proposition, « Oui » / « Non » à une question (Telegram ou la page).
// Valider = l'unique écriture : un patch sur la fiche publiée avec ifRevisionID = la révision lue par Ye. Fiche changée
// (409) ou brouillon en cours dans le Studio : rien n'est écrit. Une compétence n'est jamais créée par le QG.
import type { KV } from '../memoire';
import { ecrireEtat } from '../qg';
import { brouillonEnCours, patcherFiche, STUDIO } from './sanity';
import { CLES_YE, ecrireProposition, ecrireQuestion, expiree, lireProposition, lireQuestion, sousVerrou } from './stockage';
import type { PropositionYe, QuestionYe } from './types';

export type DepsPublication = { fetch: typeof fetch; /** SANITY_ECRITURE_PORTFOLIO. */ jeton: string | undefined };

const quoi = (p: PropositionYe) => `la fiche « ${p.titre} »`;
const DEJA: Record<Exclude<PropositionYe['statut'], 'attente'>, (p: PropositionYe) => string> = {
  publiee: p => `Déjà noté : ${quoi(p)} est déjà publiée.`,
  refusee: p => `Déjà noté : tu as refusé la proposition pour ${quoi(p)}.`,
  bougee: p => `Déjà noté : ${quoi(p)} avait bougé, Ye reproposera vendredi.`,
  remplacee: p => `Déjà noté : cette proposition pour ${quoi(p)} a été remplacée par une plus récente.`,
  expiree: p => `Déjà noté : la proposition pour ${quoi(p)} a expiré, Ye reproposera vendredi.`,
};

/** Le clic Valider ou Refuser. Rend la réponse en une ligne. Un clic à la fois ; seul un patch réussi marque « publiée ». */
export async function deciderYe(kv: KV, id: string, valider: boolean, deps: DepsPublication, now: number = Date.now()): Promise<string> {
  const vu = await lireProposition(kv, id);
  if (!vu) return 'Cette proposition de Ye est inconnue.';
  if (vu.statut !== 'attente') return DEJA[vu.statut](vu);
  const r = await sousVerrou(kv, id, async () => {
    const p = await lireProposition(kv, id);
    if (!p) return 'Cette proposition de Ye est inconnue.';
    if (p.statut !== 'attente') return DEJA[p.statut](p);
    if (expiree(p, now)) {
      await ecrireProposition(kv, { ...p, statut: 'expiree' });
      return `Cette proposition pour ${quoi(p)} a plus de 8 jours : rien n'est publié, Ye reproposera vendredi.`;
    }
    if (!valider) {
      await ecrireProposition(kv, { ...p, statut: 'refusee', decide: now });
      await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: `laisse ${quoi(p)} telle quelle`.slice(0, 140) }, now);
      return `Noté : je laisse ${quoi(p)} telle quelle.`;
    }
    const jeton = deps.jeton;
    if (!jeton) return 'La clé d\'écriture Sanity manque sur le serveur : rien n\'est publié.';
    // Le brouillon est vérifié juste avant le patch (aucun autre appel entre les deux). Il reste une fenêtre d'une
    // requête : un brouillon ouvert à cet instant précis ne serait pas vu ; le patch ne toucherait alors que la fiche
    // publiée (avec la révision lue), jamais le brouillon, et le Studio montrerait l'écart au patron.
    const brouillon = await brouillonEnCours(deps.fetch, jeton, p.ficheId);
    if (brouillon === null) return 'Sanity ne répond pas : rien n\'est publié, réessaie dans un moment.';
    if (brouillon) {
      await ecrireProposition(kv, { ...p, statut: 'bougee', decide: now });
      return `Tu as un brouillon en cours de ${quoi(p)} dans le Studio : rien n'est publié, Ye reproposera vendredi.`;
    }
    const e = await patcherFiche(deps.fetch, jeton, p.ficheId, p.rev, p.set);
    if (e.etat === 'erreur') return 'Sanity a refusé la publication : rien n\'est publié, réessaie dans un moment.';
    // résultat inconnu : en attente ; un nouveau Valider porte la même révision, donc si le premier patch a abouti,
    // Sanity répond 409 et rien n'est écrasé
    if (e.etat === 'inconnu') return `Résultat inconnu pour ${quoi(p)} : Sanity n'a pas répondu à temps, regarde le Studio avant de revalider.`;
    if (e.etat === 'conflit') {
      await ecrireProposition(kv, { ...p, statut: 'bougee', decide: now });
      await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: `n'a rien publié : ${quoi(p)} a bougé`.slice(0, 140), outil: 'Sa' }, now);
      return 'La fiche a bougé depuis : rien n\'est écrasé, Ye reproposera vendredi.';
    }
    await ecrireProposition(kv, { ...p, statut: 'publiee', decide: now });
    await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: `a publié ${quoi(p)}`.slice(0, 140), outil: 'Sa' }, now);
    return `C'est publié : ${quoi(p)} est à jour.`;
  });
  return r ?? `Ye s'occupe déjà de ${quoi(vu)} : patiente un instant.`;
}

const DEJA_Q: Record<Exclude<QuestionYe['statut'], 'attente'>, (q: QuestionYe) => string> = {
  oui: q => `Déjà noté : tu maîtrises ${q.techno}.`,
  non: q => `Déjà noté : je ne te demanderai plus pour ${q.techno}.`,
  expiree: q => `Déjà noté : la question sur ${q.techno} a expiré.`,
};

/**
 * « Oui, je l'ajoute » : la réponse est notée et le lien du Studio donné — c'est le patron qui crée la compétence ;
 * « Non » : plus jamais demandé pour cette techno. Le QG ne crée jamais de compétence.
 */
export async function repondreQuestion(kv: KV, id: string, oui: boolean, now: number = Date.now()): Promise<string> {
  const vu = await lireQuestion(kv, id);
  if (!vu) return 'Cette question de Ye est inconnue.';
  if (vu.statut !== 'attente') return DEJA_Q[vu.statut](vu);
  const r = await sousVerrou(kv, id, async () => {
    const q = await lireQuestion(kv, id);
    if (!q) return 'Cette question de Ye est inconnue.';
    if (q.statut !== 'attente') return DEJA_Q[q.statut](q);
    await kv.hset(CLES_YE.reponses, q.cle, oui ? 'oui' : 'non');
    await ecrireQuestion(kv, { ...q, statut: oui ? 'oui' : 'non', decide: now });
    return oui
      ? `Noté : crée la compétence « ${q.techno} » dans le Studio (${STUDIO}) ; Ye pourra l'utiliser au prochain passage.`
      : `Noté : je ne te demanderai plus pour ${q.techno}.`;
  });
  return r ?? 'Ye note déjà ta réponse : patiente un instant.';
}
