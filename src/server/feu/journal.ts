// Le journal de Feu, à partir des vrais ordres exécutés lus par le Mac (jamais d'estimation quand le vrai chiffre
// existe) : opérations clôturées, gagnantes et perdantes, résultat net, frais, % de plans respectés, positions ouvertes,
// et les règles de discipline qui en découlent (pauses, limite de la semaine, l'heure après un stop). Code pur.
import { nomPaire, pct, prixFr, usdt } from './indicateurs';
import { PLANCHER } from './moteur';
import type { Compte, Execution, Journal, Operation, Pause, Position, Regime } from './types';

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Le début du copilote (prompt collé le samedi 7 novembre 2026, 13:06) : les achats d'avant ne sont pas des opérations de Feu. */
export const DEBUT_JOURNAL = Date.UTC(2026, 10, 7, 13, 0);
/** Un reste de moins de 1 USDT après une vente : la position est clôturée (la poussière d'arrondi ne compte pas). */
const POUSSIERE_USDT = 1;
/** Une sortie à 0,3 % d'un prix du plan : c'est l'OCO qui l'a faite. */
const TOLERANCE = 0.003;

/** Un plan donné au Signal, gardé pour juger après coup si l'opération l'a suivi. */
export type PlanEmis = { quand: number; paire: string; entree: number; objectif: number; stop: number; stopLimite: number };

const base = (paire: string) => paire.replace(/USDT$/, '');
/** Les frais d'une exécution en USDT (en crypto : au prix de l'exécution ; en BNB : inconnus, comptés 0). */
const fraisUsdt = (e: Execution) => (e.fraisActif === 'USDT' ? e.frais : e.fraisActif === base(e.paire) ? e.frais * e.prix : 0);

/** Lundi 00:00 UTC de la semaine de `t`. */
export const lundiDe = (t: number) => { const d = new Date(t); const minuit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return minuit - ((d.getUTCDay() + 6) % 7) * JOUR; };

/**
 * Les opérations : par paire, dans l'ordre, un achat ouvre (ou renforce) une position, les ventes la referment ; elle
 * est clôturée quand ce qui reste vaut moins de 1 USDT. Seules les exécutions depuis le début du copilote comptent.
 */
export function reconstituer(executes: readonly Execution[], plans: readonly PlanEmis[] = []): { operations: Operation[]; positions: Position[] } {
  const operations: Operation[] = [], positions: Position[] = [];
  const paires = [...new Set(executes.map(e => e.paire))].sort();
  for (const paire of paires) {
    const liste = executes.filter(e => e.paire === paire && e.quand >= DEBUT_JOURNAL).sort((a, b) => a.quand - b.quand || a.id - b.id);
    let ouverte: { ouverture: number; qte: number; achete: number; achat: number; vendu: number; vente: number; frais: number; dernier: number; prixDernier: number } | null = null;
    for (const e of liste) {
      if (e.cote === 'BUY') {
        const recue = e.quantite - (e.fraisActif === base(paire) ? e.frais : 0);
        ouverte ??= { ouverture: e.quand, qte: 0, achete: 0, achat: 0, vendu: 0, vente: 0, frais: 0, dernier: e.quand, prixDernier: e.prix };
        ouverte.qte += recue; ouverte.achete += e.quantite; ouverte.achat += e.montant; ouverte.frais += fraisUsdt(e);
      } else {
        if (!ouverte) continue; // une vente sans achat suivi (avoir d'avant le copilote) : pas une opération de Feu
        ouverte.qte -= e.quantite; ouverte.vendu += e.quantite; ouverte.vente += e.montant; ouverte.frais += fraisUsdt(e);
        ouverte.dernier = e.quand; ouverte.prixDernier = e.prix;
        if (ouverte.qte * e.prix < POUSSIERE_USDT) {
          const prixEntree = ouverte.achat / ouverte.achete, prixSortie = ouverte.vente / ouverte.vendu;
          const fraisQuote = liste.filter(x => x.quand >= ouverte!.ouverture && x.quand <= e.quand && x.fraisActif === 'USDT').reduce((s, x) => s + x.frais, 0);
          const net = ouverte.vente - ouverte.achat - fraisQuote;
          const plan = plans.filter(p => p.paire === paire && p.quand <= ouverte!.ouverture && ouverte!.ouverture - p.quand <= JOUR)
            .find(p => Math.abs(prixEntree - p.entree) / p.entree <= 0.005);
          const proche = (a: number, b: number) => Math.abs(a - b) / b <= TOLERANCE;
          const sortie: Operation['sortie'] = plan && proche(prixSortie, plan.objectif) ? 'objectif' : plan && (proche(prixSortie, plan.stopLimite) || proche(prixSortie, plan.stop)) ? 'stop' : 'main';
          operations.push({
            paire, ouverture: ouverte.ouverture, cloture: e.quand, quantite: ouverte.achete, prixEntree, prixSortie,
            achat: ouverte.achat, vente: ouverte.vente, frais: ouverte.frais, net, gagnante: net > 0, avecPlan: !!plan,
            planRespecte: plan ? sortie !== 'main' : false, sortie,
          });
          ouverte = null;
        }
      }
    }
    if (ouverte && ouverte.qte * ouverte.prixDernier >= POUSSIERE_USDT) {
      positions.push({ paire, ouverture: ouverte.ouverture, quantite: ouverte.qte, prixEntree: ouverte.achat / ouverte.achete, objectif: null, stop: null });
    }
  }
  return { operations: operations.sort((a, b) => a.cloture - b.cloture), positions };
}

/** Les ordres ouverts de vente posés pour une position : l'objectif (limite) et le stop (déclenchement du stop-limit). */
export function completerPositions(positions: readonly Position[], compte: Pick<Compte, 'ouverts'> | null): Position[] {
  return positions.map(p => {
    const ventes = (compte?.ouverts ?? []).filter(o => o.paire === p.paire && o.cote === 'SELL');
    const objectif = ventes.find(o => o.type === 'LIMIT_MAKER' || o.type === 'LIMIT' || o.type === 'TAKE_PROFIT_LIMIT')?.prix ?? null;
    const stop = ventes.find(o => o.type === 'STOP_LOSS_LIMIT' || o.type === 'STOP_LOSS')?.declenchement ?? null;
    return { ...p, objectif, stop };
  });
}

/** Le journal cumulé (section 8 du prompt). `capital` : pour le résultat en % du capital. */
export function journalDe(ops: readonly Operation[], positions: readonly Position[], capital: number, now: number): Journal {
  const lundi = lundiDe(now);
  let pertesDeSuite = 0;
  for (const o of [...ops].reverse()) { if (o.gagnante) break; pertesDeSuite++; }
  const net = ops.reduce((s, o) => s + o.net, 0);
  const avecPlan = ops.filter(o => o.planRespecte !== null);
  return {
    operations: ops.length,
    gagnantes: ops.filter(o => o.gagnante).length,
    perdantes: ops.filter(o => !o.gagnante).length,
    net, netPct: capital > 0 && ops.length ? net / capital : null,
    frais: ops.reduce((s, o) => s + o.frais, 0),
    plansRespectes: avecPlan.length ? avecPlan.filter(o => o.planRespecte).length / avecPlan.length : null,
    semaine: ops.filter(o => o.ouverture >= lundi).length + positions.filter(p => p.ouverture >= lundi).length,
    pertesDeSuite,
  };
}

/**
 * La pause en cours, d'après les opérations (section 5) : un dépôt ne la remet jamais à zéro.
 * Apprentissage : 3 pertes d'affilée → 7 jours. Standard : 3 pertes d'affilée → 24 h ; −3 % sur la journée → jusqu'au
 * lendemain ; −6 % sur 7 jours glissants → 7 jours.
 */
export function pauseDe(ops: readonly Operation[], regime: Regime, capital: number, now: number): Pause {
  const fins: { jusqua: number; raison: string }[] = [];
  let suite = 0;
  for (const o of ops) {
    suite = o.gagnante ? 0 : suite + 1;
    if (suite >= 3) fins.push(regime === 'apprentissage'
      ? { jusqua: o.cloture + 7 * JOUR, raison: '3 pertes d\'affilée : pause de 7 jours et débrief' }
      : { jusqua: o.cloture + JOUR, raison: '3 pertes d\'affilée : pause de 24 h' });
  }
  if (regime === 'standard' && capital > 0) {
    for (const o of ops.filter(x => !x.gagnante)) {
      const minuit = o.cloture - (o.cloture % JOUR);
      const jour = ops.filter(x => x.cloture >= minuit && x.cloture <= o.cloture).reduce((s, x) => s + x.net, 0);
      if (jour <= -0.03 * capital) fins.push({ jusqua: minuit + JOUR, raison: 'perte de 3 % sur la journée : plus d\'entrée jusqu\'à demain' });
      const sept = ops.filter(x => x.cloture > o.cloture - 7 * JOUR && x.cloture <= o.cloture).reduce((s, x) => s + x.net, 0);
      if (sept <= -0.06 * capital) fins.push({ jusqua: o.cloture + 7 * JOUR, raison: 'perte de 6 % sur 7 jours : pause de 7 jours et débrief' });
    }
  }
  const enCours = fins.filter(f => f.jusqua > now).sort((a, b) => b.jusqua - a.jusqua);
  return enCours[0] ?? null;
}

/**
 * Ce qui interdit toute entrée maintenant (section 5 et 10), en mots simples, ou null. L'annonce macro est vérifiée à part.
 */
export function interditDe(ops: readonly Operation[], journal: Journal, pause: Pause, regime: Regime, capital: number, now: number): string | null {
  if (capital < PLANCHER) return `solde sous ${PLANCHER} USDT : on ne trade plus, on attend un dépôt`;
  if (pause) return `pause jusqu'au ${new Date(pause.jusqua).toISOString().slice(0, 16).replace('T', ' ')} UTC (${pause.raison})`;
  const dernier = ops.at(-1);
  if (dernier && dernier.sortie === 'stop' && now - dernier.cloture < H) return 'stop touché il y a moins d\'une heure : aucune entrée pendant une heure';
  if (regime === 'apprentissage' && journal.semaine >= 3) return '3 opérations cette semaine (le maximum en apprentissage) : on attend lundi';
  return null;
}

/** Le débrief en cinq lignes après une clôture (section 8) : plan, ce qui s'est passé, règles, résultat, une leçon. */
export function debrief(o: Operation, capital: number): string[] {
  const p = nomPaire(o.paire);
  const plan = !o.avecPlan ? 'aucun Signal de Feu pour cette entrée' : o.sortie === 'main' ? 'le plan de Feu, mais la sortie s\'est faite à la main' : 'le plan de Feu (entrée limite, OCO objectif + stop)';
  return [
    `Plan prévu : ${plan}.`,
    `Ce qui s'est passé : achat ${p} à ${prixFr(o.prixEntree)}, sortie à ${prixFr(o.prixSortie)} (${o.sortie === 'objectif' ? 'objectif touché' : o.sortie === 'stop' ? 'stop touché' : 'vendu à la main'}).`,
    `Règles respectées : ${o.planRespecte ? 'oui (entrée au Signal, sortie par l\'OCO)' : 'non (entrée sans Signal ou sortie hors plan)'}.`,
    `Résultat net : ${o.net >= 0 ? '+' : ''}${usdt(o.net)}${capital > 0 ? ` (${o.net >= 0 ? '+' : ''}${pct(o.net / capital)} du capital)` : ''}, frais ${usdt(o.frais)}.`,
    `Leçon : ${o.planRespecte ? (o.gagnante ? 'le plan a tenu sans toi : c\'est ça, le progrès.' : 'un stop touché dans le plan, c\'est une perte prévue et bornée, pas une erreur.') : 'sans Signal et sans OCO, on n\'entre pas : c\'est la règle qui protège le capital.'}`,
  ];
}
