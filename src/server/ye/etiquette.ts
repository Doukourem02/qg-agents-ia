import type { EchecYe, NouvelleYe, PassageYe, PropositionYe, QuestionYe, RefusQGYe } from './types';

// Ce que la page et le serveur partagent pour Ye : aucun import de valeur (la page n'embarque aucun code serveur).

/**
 * Mise en service de la routine « Ye · portfolio » (vendredi 17:30 UTC) : un passage prévu avant n'est jamais « raté ».
 */
export const ACTIVATION_YE = Date.UTC(2026, 10, 12, 5, 26); // mise en service le 12 novembre 2026 à 05:26 (routine activée après l'essai)

/**
 * Ce que la page affiche pour Ye. `rate` : le créneau du vendredi passé sans passage ; `echec` : le dernier passage
 * raté, s'il est plus récent que le dernier passage.
 */
export type VueYe = {
  passage: PassageYe | null; echec: EchecYe | null; rate: number | null;
  attente: PropositionYe[]; questions: QuestionYe[]; refusQG: RefusQGYe[]; recentes: PropositionYe[];
  /** Les projets absents du portfolio : en attente de ma réponse, et ceux décidés depuis 30 jours. */
  nouvelles: NouvelleYe[]; nouvellesRecentes: NouvelleYe[];
};

export const ID_YE = /^[0-9a-f]{10}$/;
/** Le portfolio en ligne (aussi suivi par Luffy). */
export const PORTFOLIO_EN_LIGNE = 'https://mon-portfolio.vercel.app';

export const NOMS_CHAMPS: Record<string, string> = {
  kind: 'Type de projet', kindEn: 'Type de projet (anglais)', status: 'Statut', description: 'Description',
  descriptionEn: 'Description (anglais)', liveUrl: 'Lien de la démo', technologies: 'Technologies',
};
const H = 3_600_000, JOUR = 24 * H;
export const RETARD_PASSAGE = 2 * H;

/** Le dernier créneau du vendredi 17:30 (UTC) passé depuis plus de 2 h sans passage ; sinon null. */
export function creneauManque(passage: Pick<PassageYe, 'quand'> | null, now: number, activation = ACTIVATION_YE): number | null {
  const t = now - RETARD_PASSAGE;
  const d = new Date(t);
  const minuit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let vendredi = minuit - ((d.getUTCDay() - 5 + 7) % 7) * JOUR + 17 * H + 30 * 60_000;
  if (vendredi > t) vendredi -= 7 * JOUR;
  if (vendredi < activation) return null;
  return passage && passage.quand >= vendredi ? null : vendredi;
}

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const jourHeure = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** « dernier passage ven. 13 nov. 17:32 · 3 fiches relues · 2 propositions · 1 question · 2 fiches sans lien GitHub ». */
export function lignePassage(p: PassageYe): string {
  return [
    `dernier passage ${jourHeure(p.quand)}`, `${pl(p.relus, 'fiche')} ${p.relus > 1 ? 'relues' : 'relue'}`, pl(p.propositions, 'proposition'),
    ...(p.questions ? [pl(p.questions, 'question')] : []),
    ...(p.refusees ? [`${p.refusees} ${p.refusees > 1 ? 'refusées' : 'refusée'} par le QG`] : []),
    ...(p.sansLien ? [`${pl(p.sansLien, 'fiche')} sans lien GitHub`] : []),
  ].join(' · ');
}

export const NOM_STATUT: Record<PropositionYe['statut'], string> = {
  attente: 'en attente', publiee: 'publiée', refusee: 'refusée par toi', bougee: 'la fiche avait bougé (ou un brouillon) : rien publié',
  remplacee: 'remplacée par une proposition plus récente', expiree: 'expirée sans réponse',
};
export const NOM_STATUT_NOUVELLE: Record<NouvelleYe['statut'], string> = {
  attente: 'en attente', ajoutee: 'ajoutée au portfolio', brouillon: 'créée en brouillon (une image à ajouter dans le Studio)',
  'plus-tard': 'pas maintenant (reproposée dans 4 semaines)', jamais: 'jamais', expiree: 'expirée sans réponse', remplacee: 'remplacée',
};

/** La carte de Ye dans le Cerveau : jamais « à jour » quand le passage du vendredi a été raté ou incomplet. */
export function phraseCerveau(v: VueYe | null): string {
  if (!v) return 'Pas encore de passage.';
  const morceaux: string[] = [];
  if (v.echec) morceaux.push(`Dernier passage raté : ${v.echec.raison}.`);
  else if (v.rate !== null) morceaux.push(`Le passage du ${jourHeure(v.rate).replace(/ \d\d:\d\d$/, '')} n'a pas eu lieu.`);
  if (v.attente.length) morceaux.push(`${pl(v.attente.length, 'fiche')} ${v.attente.length > 1 ? 'attendent' : 'attend'} ton Valider.`);
  if (v.questions.length) morceaux.push(`${pl(v.questions.length, 'question')} de compétence.`);
  const nonLus = v.passage?.illisibles ?? [];
  if (nonLus.length) morceaux.push(`Dernier passage incomplet : ${pl(nonLus.length, 'fiche')} pas ${nonLus.length > 1 ? 'lues' : 'lue'}.`);
  if (morceaux.length) return morceaux.join(' ');
  if (!v.passage) return 'Pas encore de passage.';
  return v.passage.propositions ? 'Rien à valider pour l\'instant.' : 'Rien à proposer au dernier passage.';
}
