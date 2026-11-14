import type { Echec, Passage, Proposition, RefusQG } from './types';

// Ce que la page et le serveur partagent pour Paul : aucun import de valeur (la page n'embarque aucun code serveur).
// Seulement des types, des constantes et des fonctions pures.

/**
 * Mise en service de la routine « Paul · Archiviste » (jeudi 18:00 UTC) : un passage prévu avant n'est jamais « raté ».
 * TODO : fixé à la mise en service — valeur provisoire (premier jeudi possible), à remplacer par l'heure du premier
 * passage réel quand la routine est activée (comme ACTIVATION_ZORO) ; connaissances.json dira alors la date.
 */
export const ACTIVATION_PAUL = Date.UTC(2026, 10, 12, 0, 31); // mis en service le 12 novembre 2026 à 00:31 (routine activée après l'essai)

/** Ce que la page reçoit d'une proposition : sans le README complet (seulement ce qui change) ; le bloc de CLAUDE.md, court, est gardé tel quel. */
export type PropositionVue = Omit<Proposition, 'contenu'>;

/**
 * Ce que la page affiche pour Paul. `rate` : le créneau du jeudi (ms) passé sans passage complet, ou null.
 * `attente` : les propositions à valider ; `recentes` : celles qui ont reçu une réponse (ou expiré) depuis 30 jours.
 */
export type VuePaul = { passage: Passage | null; rate: number | null; attente: PropositionVue[]; refusQG: RefusQG[]; recentes: PropositionVue[]; /** le dernier passage raté, s'il est plus récent que le dernier passage */ echec?: Echec | null };

/** Un identifiant de proposition tel que le serveur le fabrique (10 caractères hexadécimaux). */
export const ID_PROPOSITION = /^[0-9a-f]{10}$/;

const H = 3_600_000, JOUR = 24 * H;
/** Le passage du jeudi est compté raté s'il n'a rien rendu 2 h après 18:00. */
export const RETARD_PASSAGE = 2 * H;

/** Le dernier créneau du jeudi 18:00 (UTC) passé depuis plus de 2 h, s'il n'a pas eu de passage complet ; sinon null. */
export function creneauManque(passage: Pick<Passage, 'quand'> | null, now: number, activation = ACTIVATION_PAUL): number | null {
  const t = now - RETARD_PASSAGE;
  const d = new Date(t);
  const minuit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let jeudi = minuit - ((d.getUTCDay() - 4 + 7) % 7) * JOUR + 18 * H;
  if (jeudi > t) jeudi -= 7 * JOUR;
  if (jeudi < activation) return null;
  return passage && passage.quand >= jeudi ? null : jeudi;
}

/** Le nom court d'un dépôt (« compte/nom » → « nom »). */
export const nomCourt = (depot: string) => depot.slice(depot.lastIndexOf('/') + 1);

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const jourHeure = (ms: number) => {
  const d = new Date(ms);
  const jour = d.toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  return `${jour} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** « dernier passage jeu. 12 nov. 18:02 · 4 projets relus · 3 propositions » (et les refus du QG s'il y en a). */
export function lignePassage(p: Passage): string {
  return [
    `dernier passage ${jourHeure(p.quand)}`, pl(p.relus, 'projet') + (p.relus > 1 ? ' relus' : ' relu'), pl(p.propositions, 'proposition'),
    ...(p.refusees ? [`${p.refusees} ${p.refusees > 1 ? 'refusées' : 'refusée'} par le QG`] : []),
  ].join(' · ');
}

/** Ce que veut dire chaque statut, en clair. */
export const NOM_STATUT: Record<Proposition['statut'], string> = {
  attente: 'en attente', appliquee: 'écrit sur GitHub', refusee: 'refusé par toi', bougee: 'le fichier avait bougé : rien écrit',
  remplacee: 'remplacé par une proposition plus récente', expiree: 'expiré sans réponse', bloquee: 'bloqué par le QG : rien écrit',
};

/**
 * La carte de Paul dans le Cerveau : jamais « à jour » quand le passage du jeudi a été raté ou que rien n'a encore
 * été relu.
 */
export function phraseCerveau(v: VuePaul | null): string {
  if (!v) return 'Pas encore de passage.';
  const morceaux: string[] = [];
  if (v.echec) morceaux.push(`Dernier passage raté : aucun projet lu (GitHub n'a pas répondu pour ${v.echec.illisibles.slice(0, 3).join(', ')}${v.echec.illisibles.length > 3 ? '…' : ''}).`);
  if (v.rate !== null && !v.echec) morceaux.push(`Le passage du ${jourHeure(v.rate).replace(/ \d\d:\d\d$/, '')} n'a pas eu lieu.`);
  if (v.attente.length) morceaux.push(`${pl(v.attente.length, 'proposition')} ${v.attente.length > 1 ? 'attendent' : 'attend'} ton Valider.`);
  const nonRelus = v.passage?.illisibles ?? [];
  if (nonRelus.length) morceaux.push(`Dernier passage incomplet : ${pl(nonRelus.length, 'projet')} pas ${nonRelus.length > 1 ? 'relus' : 'relu'} (${nonRelus.slice(0, 3).join(', ')}${nonRelus.length > 3 ? '…' : ''}).`);
  if (morceaux.length) return morceaux.join(' ');
  if (!v.passage) return 'Pas encore de passage.';
  return v.passage.propositions ? 'Rien à valider pour l\'instant.' : 'Rien à proposer au dernier passage.';
}
