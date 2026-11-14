import type { KV } from '../memoire';
import { expiree, JOUR, lireEchec, lireNouvelles, lirePassage, lirePropositions, lireQuestions, lireRefus } from './stockage';
import { creneauManque, phraseCerveau, type VueYe } from './etiquette';

export type { VueYe } from './etiquette';

// Ce que la page affiche pour Ye : dernier passage (ou raté), propositions en attente (avant/après de chaque champ, en
// entier : c'est exactement ce qui sera publié), questions de compétences, refus du QG, publiées récemment.

const RECENT_MS = 30 * JOUR;

export async function vueYe(kv: KV, now: number = Date.now()): Promise<VueYe> {
  const [props, questions, refus, passage, echec, nouvelles] = await Promise.all([lirePropositions(kv), lireQuestions(kv), lireRefus(kv, 20), lirePassage(kv), lireEchec(kv), lireNouvelles(kv)]);
  const nv = nouvelles.map(n => (expiree(n, now) ? { ...n, statut: 'expiree' as const } : n));
  const vues = props.map(p => (expiree(p, now) ? { ...p, statut: 'expiree' as const } : p));
  return {
    passage,
    echec: echec && (!passage || echec.quand > passage.quand) ? echec : null,
    rate: creneauManque(passage, now),
    attente: vues.filter(p => p.statut === 'attente'),
    questions: questions.filter(q => q.statut === 'attente' && !expiree(q, now)),
    refusQG: refus.filter(r => now - r.quand < RECENT_MS),
    nouvelles: nv.filter(n => n.statut === 'attente'),
    nouvellesRecentes: nv.filter(n => n.statut !== 'attente' && now - (n.decide ?? n.quand) < RECENT_MS).slice(0, 20),
    recentes: vues.filter(p => p.statut !== 'attente' && now - (p.decide ?? p.quand) < RECENT_MS).sort((a, b) => (b.decide ?? b.quand) - (a.decide ?? a.quand)).slice(0, 20),
  };
}

export const phraseYe = (v: VueYe | null) => phraseCerveau(v);
