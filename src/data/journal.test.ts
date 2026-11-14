import { describe, expect, it } from 'vitest';
import { autresEtapes, detailAgent, estSecondaire, fusionner, quandCourt, regrouper, resumeAgent, titreJour, type Faite } from './journal';

// Mardi 10 novembre 2026 (UTC = Abidjan)
const H = 3600_000, MIN = 60_000;
const MARDI = Date.UTC(2026, 10, 10);
const NOW = MARDI + 15 * H;
const f = (agent: string, quand: number, texte: string, resultat?: string): Faite => ({ agent, quand, texte, ...(resultat ? { resultat } : {}) });

describe('titreJour et quandCourt', () => {
  it('Aujourd’hui, Hier, puis la date courte', () => {
    expect(titreJour('2026-11-10', '2026-11-10')).toBe('Aujourd’hui');
    expect(titreJour('2026-11-09', '2026-11-10')).toBe('Hier');
    expect(titreJour('2026-11-08', '2026-11-10')).toBe('dim. 8 nov.');
    expect(titreJour('2026-10-31', '2026-11-01')).toBe('Hier'); // changement de mois
  });
  it('aujourd’hui, demain, hier, ou le jour', () => {
    expect(quandCourt(MARDI + 19 * H, NOW)).toBe('aujourd’hui à 19:00');
    expect(quandCourt(MARDI + 30 * H, NOW)).toBe('demain à 06:00');
    expect(quandCourt(MARDI - 15 * H + 12 * MIN, NOW)).toBe('hier à 09:12');
    expect(quandCourt(MARDI + 2 * 24 * H + 6 * H, NOW)).toBe('jeu. 12 nov. à 06:00');
  });
});

describe('fusionner', () => {
  it('même agent, même début de texte, à la suite → une ligne ×n', () => {
    const l = fusionner([
      f('L', MARDI + 14 * H, 'traite la boîte'), f('L', MARDI + 13 * H, 'traite la boîte'), f('L', MARDI + 12 * H, 'traite la boîte'),
      f('L', MARDI + 11 * H, 'propose 3 sujets'), f('L', MARDI + 10 * H, 'traite la boîte'),
    ]);
    expect(l.map(x => [x.texte, x.n])).toEqual([['traite la boîte', 3], ['propose 3 sujets', 1], ['traite la boîte', 1]]);
    expect(l[0]).toMatchObject({ quand: MARDI + 14 * H, depuis: MARDI + 12 * H });
  });
  it('textes différents après « : » → le début commun', () => {
    const l = fusionner([f('L', 2, 'rédige : un post'), f('L', 1, 'rédige : un autre')]);
    expect(l).toEqual([{ agent: 'L', texte: 'rédige', n: 2, quand: 2, depuis: 1 }]);
  });
  it('les résultats chiffrés s’additionnent', () => {
    const l = fusionner([
      f('clara', 3, 'mails mis à la corbeille', '12 mails à la corbeille'),
      f('clara', 2, 'mails mis à la corbeille', '1 mail à la corbeille'),
      f('clara', 1, 'mails mis à la corbeille', '3 mails à la corbeille'),
    ]);
    expect(l).toEqual([{ agent: 'clara', texte: 'mails mis à la corbeille', n: 3, quand: 3, depuis: 1, resultat: '16 mails à la corbeille' }]);
    expect(fusionner([f('clara', 2, 'x', '1 mail à la corbeille'), f('clara', 1, 'x', '1 mail à la corbeille')])[0].resultat).toBe('2 mails à la corbeille');
  });
  it('résultats non chiffrés : le plus récent ; un autre agent coupe la suite', () => {
    expect(fusionner([f('light', 2, 'relevé', 'rien'), f('light', 1, 'relevé', 'vu')])[0].resultat).toBe('rien');
    expect(fusionner([f('L', 3, 'a'), f('clara', 2, 'a'), f('L', 1, 'a')]).map(x => x.n)).toEqual([1, 1, 1]);
  });
});

describe('regrouper', () => {
  const faites = [
    f('L', MARDI + 9 * H, 'traite la boîte'),
    f('clara', MARDI + 10 * H, 'mails mis à la corbeille', '2 mails à la corbeille'),
    f('L', MARDI + 11 * H, 'traite la boîte'),
    f('light', MARDI - 16 * H, 'relevé du matin'),
    f('L', MARDI - 30 * H, 'propose 3 sujets'),
  ];
  it('par jour (récent d’abord), puis par agent (le plus récemment actif d’abord), fusionné', () => {
    const g = regrouper(faites, '2026-11-10');
    expect(g.map(x => [x.jour, x.titre])).toEqual([['2026-11-10', 'Aujourd’hui'], ['2026-11-09', 'Hier'], ['2026-11-08', 'dim. 8 nov.']]);
    expect(g[0].agents.map(a => [a.agent, a.lignes.map(l => `${l.texte} ×${l.n}`)])).toEqual([
      ['L', ['traite la boîte ×2']],
      ['clara', ['mails mis à la corbeille ×1']],
    ]);
  });
  it('au plus `max` lignes en tout', () => {
    const g = regrouper(faites, '2026-11-10', 3);
    expect(g.flatMap(x => x.agents.flatMap(a => a.lignes))).toHaveLength(3);
    expect(g.map(x => x.jour)).toEqual(['2026-11-10', '2026-11-09']);
  });
  it('vide → aucun jour', () => {
    expect(regrouper([], '2026-11-10')).toEqual([]);
  });
});

describe('enCeMoment', () => {
  it('au travail, bloqué, au repos avec le prochain passage, Clara à la demande', async () => {
    const { enCeMoment, prochainEnMots } = await import('./journal');
    expect(enCeMoment({ statut: 'au travail', tache: 'traite la boîte', prochainPassage: null }, NOW)).toBe('au travail : traite la boîte');
    expect(enCeMoment({ statut: 'bloque', prochainPassage: { quand: MARDI + 30 * H } }, NOW)).toBe('bloqué · le dernier passage prévu n’a pas eu lieu');
    expect(enCeMoment({ statut: 'au repos', prochainPassage: { quand: MARDI + 30 * H } }, NOW)).toBe('au repos · prochain passage demain à 06:00');
    expect(enCeMoment({ statut: 'au repos', prochainPassage: null, surDemande: true }, NOW)).toBe('au repos · agit quand tu touches un bouton');
    expect(prochainEnMots({ statut: 'au repos', prochainPassage: null, surDemande: true }, NOW)).toBe('quand tu touches un bouton');
  });
});

describe('fusionner · fins et erreurs', () => {
  it('fins identiques additionnées ; une erreur coupe la suite et reste à part', () => {
    const l = fusionner([
      { agent: 'clara', quand: 5, texte: 'mails mis à la corbeille', resultat: '300 mails à la corbeille' },
      { agent: 'clara', quand: 4, texte: 'mails mis à la corbeille', resultat: '14 mails à la corbeille' },
      { agent: 'clara', quand: 3, texte: 'mails mis à la corbeille', resultat: '172 mails à la corbeille' },
      { agent: 'clara', quand: 2, texte: 'mise à la corbeille interrompue', erreur: true },
      { agent: 'clara', quand: 1, texte: 'mise à la corbeille interrompue', erreur: true },
    ]);
    expect(l).toEqual([
      { agent: 'clara', texte: 'mails mis à la corbeille', n: 3, quand: 5, depuis: 3, resultat: '486 mails à la corbeille' },
      { agent: 'clara', texte: 'mise à la corbeille interrompue', n: 2, quand: 2, depuis: 1, erreur: true },
    ]);
  });
  it('la ligne affichée : le résultat d’abord, court', async () => {
    const { resume } = await import('./journal');
    expect(resume({ agent: 'clara', texte: 'mails mis à la corbeille', n: 3, quand: 5, depuis: 3, resultat: '486 mails à la corbeille' })).toBe('3 envois · 486 mails à la corbeille');
    expect(resume({ agent: 'clara', texte: 'mails mis à la corbeille', n: 1, quand: 5, depuis: 5, resultat: '172 mails à la corbeille' })).toBe('172 mails à la corbeille');
    expect(resume({ agent: 'L', texte: 'traite la boîte', n: 5, quand: 5, depuis: 1 })).toBe('traite la boîte ×5');
    expect(resume({ agent: 'clara', texte: 'questions posées', n: 1, quand: 5, depuis: 5 })).toBe('questions posées');
  });
});

describe('résumé d’un agent (onglet Tâches)', () => {
  const erreur = (agent: string, quand: number, texte: string): Faite => ({ agent, quand, texte, erreur: true });
  // Clara, un mardi : des statistiques en série, des questions, deux mises à la corbeille séparées, une erreur
  const clara = [
    f('clara', MARDI + 9 * H, 'statistiques avancées'),
    f('clara', MARDI + 9 * H + 2 * MIN, 'questions posées'),
    f('clara', MARDI + 9 * H + 5 * MIN, 'statistiques avancées'),
    f('clara', MARDI + 10 * H, 'mails mis à la corbeille', '1 mail à la corbeille'),
    f('clara', MARDI + 11 * H, 'statistiques avancées'),
    f('clara', MARDI + 12 * H, 'bannissements appliqués', '2 mails à la corbeille'),
    erreur('clara', MARDI + 13 * H, 'mise à la corbeille interrompue'),
  ];
  const lignes = () => fusionner([...clara].sort((a, b) => b.quand - a.quand));

  it('les résultats d’abord, additionnés quand ils se comptent pareil ; les erreurs gardées ; le technique compté', () => {
    expect(resumeAgent(lignes())).toEqual({
      resultats: ['3 mails à la corbeille'],
      erreurs: ['mise à la corbeille interrompue'],
      actions: [],
      autres: 4, // 3 statistiques + 1 question
    });
    expect(autresEtapes(4)).toBe('4 autres étapes');
    expect(autresEtapes(1)).toBe('1 autre étape');
  });

  it('le détail : chaque étape technique du même genre en une ligne (×n), le plus récent d’abord', () => {
    const d = detailAgent(lignes());
    expect(d.map(l => [l.texte, l.n])).toEqual([
      ['mise à la corbeille interrompue', 1],
      ['bannissements appliqués', 1],
      ['statistiques avancées', 3],
      ['mails mis à la corbeille', 1],
      ['questions posées', 1],
    ]);
    expect(d[2]).toMatchObject({ depuis: MARDI + 9 * H, quand: MARDI + 11 * H });
  });

  it('sans résultat : les vraies actions mènent, deux au plus ; le reste est compté', () => {
    const l = fusionner([
      f('mafe', MARDI + 10 * H, 'envoie le point sur Telegram'),
      f('mafe', MARDI + 8 * H, 'relevé rafraîchi depuis le Mac'),
      f('mafe', MARDI + 7 * H + 30 * MIN, 'point du matin'),
      f('mafe', MARDI + 7 * H, 'fait le tri'),
    ]);
    expect(resumeAgent(l)).toEqual({ resultats: [], erreurs: [], actions: ['envoie le point sur Telegram', 'point du matin'], autres: 2 });
  });

  it('seulement du technique : la plus récente étape mène, le reste est compté', () => {
    const l = fusionner([f('clara', MARDI + 11 * H, 'statistiques avancées'), f('clara', MARDI + 10 * H, 'statistiques avancées'), f('clara', MARDI + 9 * H, 'questions posées')]);
    expect(resumeAgent(l)).toEqual({ resultats: [], erreurs: [], actions: ['statistiques avancées ×2'], autres: 1 });
  });

  it('une étape avec un résultat ou une erreur n’est jamais cachée', () => {
    expect(estSecondaire({ texte: 'statistiques avancées' })).toBe(true);
    expect(estSecondaire({ texte: 'Relevé rafraîchi depuis le Mac' })).toBe(true);
    expect(estSecondaire({ texte: 'statistiques avancées', resultat: '12 expéditeurs' })).toBe(false);
    expect(estSecondaire({ texte: 'statistiques interrompues', erreur: true })).toBe(false);
    expect(estSecondaire({ texte: 'propose 3 sujets' })).toBe(false);
  });
});
