import { describe, expect, it } from 'vitest';
import { auPas, auPasHaut, pivots, prixFr, rsi, structure } from './indicateurs';
import {
  annonceEnCours, calculerPlan, lireDeclencheur, lireZone, regimeDe, rendements, statutPaire, type ContexteCompte, type EntreeMoteur,
} from './moteur';
import { debrief, interditDe, journalDe, pauseDe, reconstituer, DEBUT_JOURNAL, type PlanEmis } from './journal';
import { bougies, DUREES, H, MIN, plat, vagues } from './aide-test';
import type { Execution, NiveauxPaire, ReglesPaire, Zone } from './types';

const NOW = Date.UTC(2026, 10, 16, 10, 5); // lundi 10:05
const debut = (pas: number, n: number) => Math.floor(NOW / pas) * pas - (n - 1) * pas;
const REGLES: ReglesPaire = { tick: 0.01, pas: 0.001, minimum: 5 };
const APPRENTISSAGE: ContexteCompte = { capital: 8.5, regime: 'apprentissage', operationsStandard: 0, positions: 0, engage: 0 };

/** Le marché d'un Signal : contexte repris, prix dans le support 100–101, rejet 15m, résistance à 104. */
function marcheSignal(rejet = true) {
  const s15: [number, number, number, number, number?][] = [
    ...Array.from({ length: 27 }, (_, i): [number, number, number, number, number] => [101.4, 101.8, 101.2, i % 2 ? 101.5 : 101.3, 10]),
    [101.3, 101.4, 101.1, 101.2, 10],
    rejet ? [100.9, 101.1, 100.0, 101.05, 12] : [101.2, 101.3, 100.9, 100.95, 9],
    [101.05, 101.1, 100.7, 100.8, 3],
  ];
  const s1 = [[99, 99.5, 96.5, 97] as [number, number, number, number], ...plat(102.5, 58), [102.5, 102.6, 100.5, 100.8] as [number, number, number, number]];
  return {
    b15m: bougies(s15, DUREES['15m'], debut(DUREES['15m'], s15.length)),
    b1h: bougies(s1, H, debut(H, s1.length)),
    b4h: bougies(plat(100, 40), DUREES['4h'], debut(DUREES['4h'], 40)),
  };
}
const NIVEAUX: NiveauxPaire = {
  supports: [{ bas: 100, haut: 101, nom: 'support' }],
  resistances: [{ bas: 104, haut: 105, nom: 'résistance' }],
  surveilles: [], contexte: { prix: 98 },
};
const entree = (o: Partial<EntreeMoteur> = {}): EntreeMoteur => ({
  paire: 'BTCUSDT', ...marcheSignal(), now: NOW, niveaux: NIVEAUX, regles: REGLES, compte: APPRENTISSAGE, interdit: null, ...o,
});

describe('Feu · les indicateurs', () => {
  it('RSI 14 de Wilder : 100 sans baisse, 0 sans hausse, null sans assez de bougies', () => {
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 + i))).toBe(100);
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 - i))).toBe(0);
    expect(rsi([1, 2, 3])).toBeNull();
    const r = rsi(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 1 : -1)))!;
    expect(r).toBeGreaterThan(40); expect(r).toBeLessThan(60);
  });
  it('pivots et structure : hauts et bas plus hauts → haussière ; plus bas → baissière ; trop peu → indéterminée', () => {
    expect(structure(bougies(vagues(100, 60, 1), H, 0))).toBe('haussiere');
    expect(structure(bougies(vagues(100, 60, -1), H, 0))).toBe('baissiere');
    expect(structure(bougies(plat(100, 30), H, 0))).toBe('indeterminee');
    const p = pivots(bougies(vagues(100, 60, 1), H, 0));
    expect(p.hauts.length).toBeGreaterThan(2); expect(p.bas.length).toBeGreaterThan(2);
  });
  it('arrondis au pas sans erreur de virgule : quantité vers le bas, objectif vers le haut', () => {
    expect(auPas(8.5 / 71500, 0.00001)).toBe(0.00011);
    expect(auPas(0.3, 0.1)).toBe(0.3);
    expect(auPas(71499.999, 0.01)).toBe(71499.99);
    expect(auPasHaut(104.001, 0.01)).toBe(104.01);
  });
  it('un prix se lit à la française', () => {
    expect(prixFr(71717.34)).toBe('71 717,3');
    expect(prixFr(2005)).toBe('2 005');
  });
});

describe('Feu · les trois conditions', () => {
  const zones: Zone[] = [{ bas: 100, haut: 101, nom: 'support' }];
  it('zone : dedans, ou au plus 1 % au-dessus ; touchée puis dépassée de plus de 1 % : raté', () => {
    const b = marcheSignal().b15m;
    expect(lireZone(zones, 100.5, b, NOW).condition.ok).toBe(true);
    expect(lireZone(zones, 101.9, b, NOW).condition.ok).toBe(true);
    const rate = lireZone(zones, 102.5, b, NOW);
    expect(rate.condition.ok).toBe(false);
    expect(rate.rate).toBe(true);
    expect(rate.condition.detail).toContain('c\'est raté');
    expect(lireZone(zones, 99, b, NOW).zone).toBeNull();
  });
  it('déclencheur : un rejet (mèche basse, clôture au-dessus) ; rien sans lui ; jamais en surachat', () => {
    expect(lireDeclencheur(marcheSignal(true).b15m, zones[0], NOW).condition.ok).toBe(true);
    expect(lireDeclencheur(marcheSignal(false).b15m, zones[0], NOW).condition.ok).toBe(false);
    // une montée continue : RSI au-dessus de 70, même avec une clôture au-dessus du niveau et du volume
    const monte = bougies([...Array.from({ length: 25 }, (_, i): [number, number, number, number, number] => [95 + i * 0.2, 95.3 + i * 0.2, 94.9 + i * 0.2, 95.2 + i * 0.2, 10]), [100, 101.6, 99.9, 101.5, 50], [101.5, 101.6, 101.4, 101.5, 1]], DUREES['15m'], debut(DUREES['15m'], 27));
    const d = lireDeclencheur(monte, zones[0], NOW);
    expect(d.condition.ok).toBe(false);
    expect(d.condition.detail).toContain('surachat');
  });
  it('la bougie en cours ne compte jamais (seulement les bougies terminées)', () => {
    const b = marcheSignal(false).b15m;
    const enCours = [...b.slice(0, -1), { ...b.at(-1)!, o: 100.9, h: 101.1, l: 100.0, c: 101.05 }];
    expect(lireDeclencheur(enCours, zones[0], NOW).condition.ok).toBe(false);
  });
});

describe('Feu · le plan chiffré', () => {
  it('apprentissage, 8,50 USDT : capital entier, quantité arrondie au pas, OCO unique, ratio net de frais, 5 USDT vérifiés', () => {
    const r = calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 'support' }, 100.8, 104, REGLES, APPRENTISSAGE);
    if (!('plan' in r)) throw new Error(r.refus);
    const p = r.plan;
    expect(p.entree).toBe(100.8);
    expect(p.stop).toBe(99.8);
    expect(p.stopLimite).toBe(99.7);
    expect(p.quantite).toBe(0.084);
    expect(p.ocos).toHaveLength(1);
    expect(p.ocos[0].quantite).toBe(0.083); // les frais d'achat sont pris sur la crypto reçue
    expect(p.ratio).toBeGreaterThanOrEqual(2);
    expect(p.ratio).toBeCloseTo(rendements(100.8, 104, 99.7).ratio, 10);
    expect(p.minimums.venteStop).toBeGreaterThanOrEqual(5);
    expect(p.valable).toContain('valable tant que le prix reste dans la zone');
  });
  it('refuse un stop à plus de 3 % en apprentissage, un ratio sous 2, un ordre sous 5 USDT, une deuxième position', () => {
    expect(calculerPlan('BTCUSDT', { bas: 95, haut: 101, nom: 'large' }, 100.8, 120, REGLES, APPRENTISSAGE)).toMatchObject({ refus: expect.stringContaining('plus de 3 %') });
    expect(calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 's' }, 100.8, 102, REGLES, APPRENTISSAGE)).toMatchObject({ refus: expect.stringContaining('ratio') });
    expect(calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 's' }, 100.8, 104, REGLES, { ...APPRENTISSAGE, capital: 5.2 })).toMatchObject({ refus: expect.stringContaining('sous 5 USDT') });
    expect(calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 's' }, 100.8, 104, REGLES, { ...APPRENTISSAGE, positions: 1 })).toMatchObject({ refus: expect.stringContaining('une seule à la fois') });
  });
  it('régime standard : l\'exemple du prompt (200 USDT, 1 %, stop 2 %) plafonné à 25 % du capital, deux OCO', () => {
    const compte: ContexteCompte = { capital: 200, regime: 'standard', operationsStandard: 10, positions: 0, engage: 0 };
    const r = calculerPlan('BTCUSDT', { bas: 100, haut: 102, nom: 'z' }, 102, 120, REGLES, compte);
    if (!('plan' in r)) throw new Error(r.refus);
    expect(r.plan.montant).toBeLessThanOrEqual(50);
    expect(r.plan.montant).toBeGreaterThan(49);
    expect(r.plan.ocos).toHaveLength(2);
    expect(r.plan.ocos[0].objectif).toBeLessThan(r.plan.ocos[1].objectif); // TP1 à 1R, TP2 à l'objectif
    // les 10 premières opérations du régime : 0,5 % de risque
    const prudent = calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 'z' }, 101, 120, REGLES, { ...compte, operationsStandard: 0 });
    if (!('plan' in prudent)) throw new Error(prudent.refus);
    expect(prudent.plan.risque).toBeLessThanOrEqual(1.05);
  });
  it('sans résistance connue, l\'objectif est celui du 2 pour 1 net exactement', () => {
    const r = calculerPlan('BTCUSDT', { bas: 100, haut: 101, nom: 's' }, 100.8, null, REGLES, APPRENTISSAGE);
    if (!('plan' in r)) throw new Error(r.refus);
    expect(r.plan.ratio).toBeGreaterThanOrEqual(2);
    expect(r.plan.ratio).toBeLessThan(2.05);
  });
  it('régime : apprentissage sous 100 USDT, standard au-delà', () => {
    expect(regimeDe(8.5)).toBe('apprentissage');
    expect(regimeDe(100)).toBe('standard');
  });
});

describe('Feu · le statut (seul le code dit « Signal »)', () => {
  it('Signal : les 3 conditions et le ratio, avec le plan', () => {
    const s = statutPaire(entree());
    expect(s.statut).toBe('Signal');
    expect(s.manque).toBeNull();
    expect(s.plan?.objectif).toBe(104);
    expect(s.conditions.contexte.detail).toContain('sortie confirmée');
  });
  it('Surveillance : 2 conditions, la condition qui manque nommée', () => {
    const s = statutPaire(entree(marcheSignal(false)));
    expect(s.statut).toBe('Surveillance');
    expect(s.manque).toContain('déclencheur');
    expect(s.plan).toBeNull();
  });
  it('Surveillance : 3 conditions mais une règle l\'interdit (fenêtre macro) — jamais de plan', () => {
    const s = statutPaire(entree({ interdit: 'fenêtre macro : PPI américain' }));
    expect(s.statut).toBe('Surveillance');
    expect(s.manque).toContain('fenêtre macro');
    expect(s.plan).toBeNull();
  });
  it('Surveillance : 3 conditions sans le ratio (résistance trop proche)', () => {
    const s = statutPaire(entree({ niveaux: { ...NIVEAUX, resistances: [{ bas: 102, haut: 103, nom: 'r' }] } }));
    expect(s.statut).toBe('Surveillance');
    expect(s.manque).toContain('ratio');
  });
  it('Hypothèse : tendance baissière, aucun sommet repris, prix loin de toute zone', () => {
    const b4h = bougies(vagues(100, 60, -1), DUREES['4h'], debut(DUREES['4h'], 60));
    const b1h = bougies(vagues(100, 80, -1), H, debut(H, 80));
    const s = statutPaire(entree({ b4h, b1h, niveaux: { ...NIVEAUX, contexte: { prix: 200 }, supports: [{ bas: 50, haut: 51, nom: 'loin' }] } }));
    expect(s.statut).toBe('Hypothèse');
    expect(s.structure4h).toBe('baissiere');
    expect(s.plan).toBeNull();
  });
  it('fenêtre macro : une heure avant et une heure après ; une date sans heure ne bloque rien', () => {
    const a = [{ quand: NOW + 50 * MIN, nom: 'CPI' }, { quand: NOW, nom: 'Nvidia', aConfirmer: true as const }];
    expect(annonceEnCours(a, NOW)?.nom).toBe('CPI');
    expect(annonceEnCours(a, NOW - 10 * MIN)).not.toBeNull();
    expect(annonceEnCours(a, NOW - 20 * MIN)).toBeNull();
    expect(annonceEnCours(a, NOW + 110 * MIN)?.nom).toBe('CPI');
    expect(annonceEnCours(a, NOW + 3 * H)).toBeNull();
  });
});

describe('Feu · le journal (les vrais ordres exécutés)', () => {
  const T = DEBUT_JOURNAL + 2 * 86_400_000;
  const ex = (id: number, cote: 'BUY' | 'SELL', prix: number, quantite: number, quand: number, fraisActif = cote === 'BUY' ? 'BTC' : 'USDT'): Execution => ({
    paire: 'BTCUSDT', id, ordre: id, cote, prix, quantite, montant: prix * quantite, frais: fraisActif === 'BTC' ? quantite * 0.001 : prix * quantite * 0.001, fraisActif, quand,
  });
  const plan: PlanEmis = { quand: T - H, paire: 'BTCUSDT', entree: 100000, objectif: 104000, stop: 99000, stopLimite: 98900 };
  it('un achat puis la vente à l\'objectif : une opération gagnante, plan respecté, frais comptés', () => {
    const { operations, positions } = reconstituer([ex(1, 'BUY', 100000, 0.0001, T), ex(2, 'SELL', 104000, 0.0000999, T + H)], [plan]);
    expect(positions).toHaveLength(0);
    expect(operations).toHaveLength(1);
    const o = operations[0];
    expect(o.gagnante).toBe(true);
    expect(o.sortie).toBe('objectif');
    expect(o.planRespecte).toBe(true);
    expect(o.frais).toBeGreaterThan(0);
    const j = journalDe(operations, positions, 8.5, T + 2 * H);
    expect(j).toMatchObject({ operations: 1, gagnantes: 1, perdantes: 0, plansRespectes: 1, pertesDeSuite: 0 });
    expect(debrief(o, 8.5)).toHaveLength(5);
  });
  it('un achat sans Signal : plan non respecté ; un achat non revendu : une position ouverte ; avant le copilote : ignoré', () => {
    const { operations, positions } = reconstituer([
      ex(1, 'BUY', 100000, 0.0001, T), ex(2, 'SELL', 99000, 0.0000999, T + H),
      ex(3, 'BUY', 100000, 0.0001, T + 3 * H),
      ex(4, 'BUY', 76983, 0.0001, DEBUT_JOURNAL - 86_400_000, 'BTC'),
    ], []);
    expect(operations).toHaveLength(1);
    expect(operations[0].planRespecte).toBe(false);
    expect(operations[0].gagnante).toBe(false);
    expect(positions).toHaveLength(1);
    expect(positions[0].ouverture).toBe(T + 3 * H);
    expect(debrief(operations[0], 8.5)[0]).toContain('aucun Signal');
  });
  it('3 pertes d\'affilée en apprentissage : pause de 7 jours ; un dépôt ne la remet pas à zéro', () => {
    const exs = [0, 1, 2].flatMap(i => [ex(10 + i * 2, 'BUY', 100000, 0.0001, T + i * 3 * H), ex(11 + i * 2, 'SELL', 98000, 0.0000999, T + i * 3 * H + H)]);
    const { operations } = reconstituer(exs, []);
    const p = pauseDe(operations, 'apprentissage', 8.5, T + 10 * H);
    expect(p?.raison).toContain('7 jours');
    expect(pauseDe(operations, 'apprentissage', 500, T + 10 * H)).not.toBeNull();
    expect(pauseDe(operations, 'apprentissage', 8.5, T + 9 * 86_400_000)).toBeNull();
    expect(pauseDe(operations, 'standard', 200, T + 10 * H)?.raison).toContain('24 h');
  });
  it('les interdits : solde sous 6 USDT, 3 opérations dans la semaine, l\'heure après un stop', () => {
    const j = journalDe([], [], 8.5, NOW);
    expect(interditDe([], j, null, 'apprentissage', 5.9, NOW)).toContain('sous 6 USDT');
    expect(interditDe([], { ...j, semaine: 3 }, null, 'apprentissage', 8.5, NOW)).toContain('3 opérations');
    expect(interditDe([], { ...j, semaine: 3 }, null, 'standard', 200, NOW)).toBeNull();
    const { operations } = reconstituer([ex(1, 'BUY', 100000, 0.0001, T), ex(2, 'SELL', 98900, 0.0000999, T + H)], [plan]);
    expect(operations[0].sortie).toBe('stop');
    expect(interditDe(operations, j, null, 'apprentissage', 8.5, T + H + 30 * MIN)).toContain('une heure');
    expect(interditDe(operations, j, null, 'apprentissage', 8.5, T + 3 * H)).toBeNull();
  });
});

describe('Feu · les interdits absolus', () => {
  it('aucun ordre possible : le QG n\'appelle que deux routes publiques de lecture, en GET, sans clé', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dossier = new URL('.', import.meta.url);
    const code = readdirSync(dossier).filter(f => f.endsWith('.ts') && !f.includes('test')).map(f => readFileSync(new URL(f, dossier), 'utf8')).join('\n');
    expect(code).not.toMatch(/\/api\/v3\/order|\/sapi\/|X-MBX-APIKEY|signature=|method:\s*'(POST|PUT|DELETE)'/);
    const { ROUTES_PUBLIQUES, MIROIR } = await import('./marche');
    expect(ROUTES_PUBLIQUES).toEqual(['/api/v3/klines', '/api/v3/exchangeInfo']);
    expect(MIROIR).toBe('https://data-api.binance.vision');
  });
});
