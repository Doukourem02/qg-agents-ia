// Ce que la page (« Le bureau de Feu ») et la routine des missions voient de Feu : le dernier passage (statuts avec leur
// heure de lecture), le solde (et quand il a été vu), le régime, les niveaux, le plan en cours, les positions, le
// journal, les prochaines annonces, la dernière analyse et ses sources, les dernières alertes. Jamais une clé.
// Seulement dans la page privée : /demo ne lit jamais ce bureau (aucun chiffre réel en public).
import type { KV } from '../memoire';
import { lireAnalyses, type Analyse } from './analyse';
import { soldes } from './compte';
import { lireCompte, lireEtatSeul, lirePassageFeu } from './etat';
import { debrief } from './journal';
import { lireIgnoresFeu, lireMessages, situation, type MessageFeu } from './passage';
import type { Annonce, Journal, NiveauxPaire, Operation, Pause, Position, Regime, StatutPaire } from './types';

export { phraseFeu } from './etiquette';

export type VueFeu = {
  passage: { quand: number; erreur?: string; statuts: StatutPaire[] } | null;
  compte: { cle: 'ok' | 'absente' | 'droits' | 'erreur' | 'jamais'; quand: number | null; spotUsdt?: number; earnUsdt?: number; crypto?: number; total?: number; ordresOuverts?: number; droits?: string[] };
  capital: { montant: number; source: 'compte' | 'declare'; quand: number } | null;
  regime: Regime | null;
  niveaux: Record<string, NiveauxPaire> | null;
  annonces: Annonce[];
  points: string[];
  journal: Journal | null;
  positions: Position[];
  pause: Pause;
  interdit: string | null;
  operations: (Operation & { debrief: string[] })[];
  analyse: Analyse | null;
  messages: MessageFeu[];
  ignores: string[];
};

export async function vueFeu(kv: KV, now: number = Date.now()): Promise<VueFeu> {
  const [etat, passage, compte, analyses, messages, ignores] = await Promise.all([
    lireEtatSeul(kv), lirePassageFeu(kv), lireCompte(kv), lireAnalyses(kv), lireMessages(kv, 15), lireIgnoresFeu(kv),
  ]);
  const prix = Object.fromEntries((passage?.statuts ?? []).map(s => [s.paire, s.prix]));
  const sit = etat ? situation(etat, compte, prix, now) : null;
  const s = compte?.cle === 'ok' ? soldes(compte, prix) : null;
  return {
    passage: passage ? { quand: passage.quand, ...(passage.erreur ? { erreur: passage.erreur } : {}), statuts: passage.statuts } : null,
    compte: {
      cle: compte?.cle ?? 'jamais', quand: compte?.quand ?? null,
      ...(s ? { ...s, ordresOuverts: compte!.ouverts.length } : {}),
      ...(compte?.droits ? { droits: compte.droits } : {}),
    },
    capital: sit?.capital ?? null,
    regime: sit?.regime ?? null,
    niveaux: etat?.niveaux ?? null,
    annonces: (etat?.annonces ?? []).filter(a => a.quand >= now - 3_600_000).slice(0, 6),
    points: compte?.cle === 'ok' ? [] : etat?.points ?? [],
    journal: sit?.journal ?? null,
    positions: sit?.positions ?? [],
    pause: sit?.pause ?? null,
    interdit: sit?.interdit ?? null,
    operations: (sit?.operations ?? []).slice(-10).reverse().map(o => ({ ...o, debrief: debrief(o, sit!.capital.montant) })),
    analyse: analyses[0] ?? null,
    messages,
    ignores: Object.keys(ignores),
  };
}

