import type { KV } from '../memoire';
import { expiree, JOUR, lireEchec, lirePassage, lirePropositions, lireRefus } from './stockage';
import { creneauManque, phraseCerveau, type PropositionVue, type VuePaul } from './etiquette';
import type { Proposition } from './types';

export type { VuePaul } from './etiquette';

// Ce que la page affiche pour Paul : le dernier passage (ou le passage raté), les propositions en attente avec ce qui
// change, les refus du QG et les réponses récentes. Page privée (vrais noms de projets) ; jamais le README complet (le bloc de CLAUDE.md, court, oui).

const RECENT_MS = 30 * JOUR;
const MAX_RECENTES = 20;

function sansFichier(p: Proposition): PropositionVue {
  const reste: Partial<Proposition> = { ...p };
  delete reste.contenu;
  return reste as PropositionVue;
}

export async function vuePaul(kv: KV, now: number = Date.now()): Promise<VuePaul> {
  const [props, refus, passage, echec] = await Promise.all([lirePropositions(kv), lireRefus(kv, 20), lirePassage(kv), lireEchec(kv)]);
  // une proposition de plus de 8 jours est montrée expirée, même avant le passage qui la range
  const vues = props.map(p => (expiree(p, now) ? { ...p, statut: 'expiree' as const } : p));
  return {
    passage,
    echec: echec && (!passage || echec.quand > passage.quand) ? echec : null,
    rate: creneauManque(passage, now),
    attente: vues.filter(p => p.statut === 'attente').map(sansFichier),
    refusQG: refus.filter(r => now - r.quand < RECENT_MS),
    recentes: vues.filter(p => p.statut !== 'attente' && now - (p.decide ?? p.quand) < RECENT_MS)
      .sort((a, b) => (b.decide ?? b.quand) - (a.decide ?? a.quand)).slice(0, MAX_RECENTES).map(sansFichier),
  };
}

/** La phrase de Paul dans le Cerveau, calculée sur ce qu'il a vraiment fait. */
export const phrasePaul = (v: VuePaul | null) => phraseCerveau(v);
