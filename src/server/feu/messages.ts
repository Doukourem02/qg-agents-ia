// Les messages Telegram de Feu, écrits par le code : français simple, tutoiement, « On attend. » permis. Un prix n'est
// jamais donné sans son heure de lecture ; jamais une prédiction certaine ; jamais pousser à agir, à déposer ou à se
// refaire. Chaque alerte a une ou deux phrases « pour comprendre », jamais un cours.
import { hhmm, jourHeure, nomPaire, pct, prixFr, usdt } from './indicateurs';
import type { Annonce, NiveauSurveille, Plan, Position, StatutPaire } from './types';

export const TETE = '🔥 Feu';
const actif = (paire: string) => paire.replace(/USDT$/, '');
const qte = (q: number) => q.toLocaleString('fr-FR', { maximumFractionDigits: 8 });

/** « Statut : Surveillance — il manque le déclencheur 15m (…). » */
export function ligneStatut(s: StatutPaire): string {
  if (s.statut === 'Signal') return 'Statut : Signal (les 3 conditions et le ratio).';
  return `Statut : ${s.statut}${s.manque ? ` — il manque ${s.manque}` : ''}. On attend.`;
}

/** Les lignes du plan d'ordres chiffré (au Signal seulement), avec les chiffres du code. */
export function lignesPlan(p: Plan): string[] {
  const a = actif(p.paire);
  return [
    `Plan d'ordres (${p.valable}) :`,
    `• Entrée : ordre limite à ${prixFr(p.entree)}, ${qte(p.quantite)} ${a} (${usdt(p.montant)}).`,
    ...p.ocos.map((o, i) => `• ${p.ocos.length > 1 ? `OCO ${i + 1}` : 'Dès l\'exécution, un OCO'} sur ${qte(o.quantite)} ${a} : objectif ${prixFr(o.objectif)} ; stop-limit déclenché à ${prixFr(o.declenchement)}, limite ${prixFr(o.limite)}.`),
    `• Risque : ${usdt(p.risque)} (stop à ${pct(p.distanceStop)} sous l'entrée) ; gain net visé : ${usdt(p.gainNet)} ; ratio ${p.ratio.toFixed(1).replace('.', ',')} pour 1 net de frais (${pct(p.frais, 2)} par ordre).`,
    `• Minimum de 5 USDT vérifié : achat ${usdt(p.minimums.achat)}, vente à l'objectif ${usdt(p.minimums.venteObjectif)}, vente au stop ${usdt(p.minimums.venteStop)}.`,
  ];
}

/** Le Signal : les trois conditions, le plan, et ce qu'il faut savoir avant de poser les ordres. La décision reste au patron. */
export function messageSignal(s: StatutPaire, notes: string[] = []): string {
  return [
    `${TETE} · Signal ${nomPaire(s.paire)} (prix lu ${prixFr(s.prix)} à ${hhmm(s.lu)} UTC)`,
    `Contexte : ${s.conditions.contexte.detail}.`,
    `Zone : ${s.conditions.zone.detail}.`,
    `Déclencheur : ${s.conditions.declencheur.detail}.`,
    ...lignesPlan(s.plan!),
    ...notes,
    'La décision est la tienne. Limite non exécutée et prix parti sans toi : on ne court pas après.',
  ].join('\n');
}

/** Une clôture 1h au-delà d'un niveau surveillé. */
export function messageNiveau(s: StatutPaire, n: NiveauSurveille, cloture: { t: number; c: number }): string {
  return [
    `${TETE} · ${nomPaire(s.paire)} : une bougie 1h a clôturé ${n.sens === 'haut' ? 'au-dessus' : 'en dessous'} de ${prixFr(n.prix)} (${n.nom}).`,
    `Clôture ${prixFr(cloture.c)} à ${hhmm(cloture.t + 3_600_000)} UTC ; prix lu ${prixFr(s.prix)} à ${hhmm(s.lu)} UTC.`,
    ligneStatut(s),
    'Pour comprendre : seule la clôture d\'une bougie 1h au-delà du niveau compte, pas un simple passage.',
  ].join('\n');
}

/** Le passage en Surveillance : ce qui manque encore. */
export function messageSurveillance(s: StatutPaire): string {
  return [
    `${TETE} · ${nomPaire(s.paire)} passe en Surveillance (prix lu ${prixFr(s.prix)} à ${hhmm(s.lu)} UTC).`,
    `Il manque ${s.manque}.`,
    'Pour comprendre : deux conditions sur trois, ce n\'est pas un achat. On attend la troisième et le ratio.',
  ].join('\n');
}

export function messagePositionStop(p: Position, prix: number, lu: number): string {
  return [
    `${TETE} · ${nomPaire(p.paire)} : le prix (${prixFr(prix)} à ${hhmm(lu)} UTC) est à moins de 0,5 % de ton stop (${prixFr(p.stop!)}).`,
    'Le stop est là pour ça : on ne l\'élargit jamais. Ton OCO tient le plan sans toi.',
  ].join('\n');
}

export function messagePositionObjectif(p: Position, prix: number, lu: number): string {
  return [
    `${TETE} · ${nomPaire(p.paire)} : objectif touché (${prixFr(p.objectif!)}) ; prix lu ${prixFr(prix)} à ${hhmm(lu)} UTC.`,
    'Si l\'OCO s\'est exécuté, le débrief arrive dès que le Mac voit l\'ordre.',
  ].join('\n');
}

export function messageMacro(a: Annonce, quand: 'veille' | 'heure'): string {
  const debut = hhmm(a.quand - 3_600_000), fin = hhmm(a.quand + 3_600_000);
  return quand === 'veille'
    ? `${TETE} · demain ${jourHeure(a.quand)} UTC : ${a.nom}. Pas d'entrée de ${debut} à ${fin}.\nPour comprendre : ces chiffres font bouger le dollar et les taux, et le Bitcoin avec ; le prix peut sauter dans les deux sens.`
    : `${TETE} · dans une heure (${hhmm(a.quand)} UTC) : ${a.nom}. Pas d'entrée de ${debut} à ${fin}, même si un signal apparaît.`;
}

export function messagePause(debut: boolean, raison: string, jusqua: number | null): string {
  return debut
    ? `${TETE} · pause : ${raison}. Plus d'entrée${jusqua ? ` jusqu'au ${jourHeure(jusqua)} UTC` : ''}. On relit le journal à froid ; pas de « revanche ».`
    : `${TETE} · fin de la pause. Les règles reprennent normalement ; les limites de perte ne repartent pas à zéro pour autant.`;
}

export function messageDebrief(paire: string, lignes: string[], resume: string): string {
  return [`${TETE} · débrief ${nomPaire(paire)}`, ...lignes, resume].join('\n');
}
