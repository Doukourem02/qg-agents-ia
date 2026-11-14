import { describe, expect, it } from 'vitest';
import { allumesVague, compteur, outilsEnService, outilsEnTache, texteCompteur } from './compteur';

const agent = (agent: string, statut: 'au travail' | 'au repos' | 'bloque') => ({ agent, statut });

describe('le compteur en haut à droite', () => {
  it('7 h 52 : six vrais agents au repos entre deux tâches → 6 en service, 0 en tâche', () => {
    const vues = { agents: ['L', 'light', 'clara', 'mafe', 'luffy', 'isaac'].map(id => agent(id, 'au repos')), presences: [] };
    expect(compteur(vues)).toEqual({ service: 6, tache: 0 });
    expect(texteCompteur(compteur(vues))).toBe('6 en service · 0 en tâche');
  });

  it('un agent bloqué (passage raté, Mac éteint, Luffy qui ne vérifie plus) n’est pas en service', () => {
    const vues = { agents: [agent('light', 'au travail'), agent('isaac', 'bloque'), agent('clara', 'au repos')], presences: [] };
    expect(compteur(vues)).toEqual({ service: 2, tache: 1 });
  });

  it('Stalker (Claude Code avec moi) compte dans les deux, une seule fois', () => {
    const vues = { agents: [agent('mafe', 'au repos')], presences: ['stalker', 'mafe'] };
    expect(compteur(vues)).toEqual({ service: 2, tache: 1 });
  });

  it('avant la première lecture : rien d’affirmé', () => {
    expect(compteur(null)).toBeNull();
    expect(texteCompteur(null)).toBe('…');
  });
});

describe('la barre d’outils, en phase avec le compteur', () => {
  it('allume l’outil de chaque agent en tâche, et Claude quand Stalker travaille avec moi ; rien quand 0 en tâche', () => {
    expect(outilsEnTache({ agents: [{ agent: 'clara', statut: 'au repos' }], presences: [] })).toEqual([]);
    expect(outilsEnTache({ agents: [{ agent: 'isaac', statut: 'au travail', outil: 'Mac' }, { agent: 'L', statut: 'au travail', outil: 'C' }], presences: ['stalker'] })).toEqual(['Mac', 'C']);
    expect(outilsEnTache(null)).toEqual([]);
  });
  it('autant d’agents en tâche que le compteur, et chacun avec son outil allumé quand il en a un', () => {
    const vues = { agents: [{ agent: 'light', statut: 'au travail' as const, outil: 'GH' }, { agent: 'mafe', statut: 'au repos' as const }], presences: ['stalker'] };
    expect(compteur(vues)!.tache).toBe(2);
    expect(outilsEnTache(vues)).toEqual(['GH', 'C']);
  });
});

describe('la barre d’outils : les outils des agents en service clignotent', () => {
  const outils: Record<string, string[]> = { L: ['in', 'C'], light: ['GH'], zoro: ['GH'], isaac: ['Mac', 'Tg'], clara: ['C', 'Gm'] };
  const outilsDe = (id: string) => outils[id] ?? [];
  it('autant d’agents en service que dans le compteur : leurs outils, sans doublon ; un agent bloqué ne compte pas', () => {
    const vues = { agents: [{ agent: 'L', statut: 'au repos' as const }, { agent: 'light', statut: 'au repos' as const }, { agent: 'zoro', statut: 'au travail' as const }, { agent: 'isaac', statut: 'bloque' as const }], presences: [] };
    expect(outilsEnService(vues, outilsDe)).toEqual(['in', 'C', 'GH']);
  });
  it('Stalker (Claude Code avec moi) en service : Claude', () => {
    expect(outilsEnService({ agents: [], presences: ['stalker'] }, outilsDe)).toEqual(['C']);
  });
  it('avant la première lecture : rien', () => {
    expect(outilsEnService(null, outilsDe)).toEqual([]);
  });
});

describe('la vague des outils en service (aller-retour, 11 novembre 2026)', () => {
  // 3 outils en service : gauche → droite en se remplissant, tout s'éteint, droite → gauche, tout s'éteint, et ainsi de suite
  const trace = (n: number, etapes: number) => Array.from({ length: etapes }, (_, e) => allumesVague(n, e).map(b => (b ? 'x' : '.')).join(''));
  it('se remplit de gauche à droite, s’éteint, se remplit de droite à gauche, s’éteint, recommence', () => {
    expect(trace(3, 9)).toEqual(['x..', 'xx.', 'xxx', '...', '..x', '.xx', 'xxx', '...', 'x..']);
  });
  it('un seul outil : allumé, éteint ; aucun outil : rien', () => {
    expect(trace(1, 4)).toEqual(['x', '.', 'x', '.']);
    expect(allumesVague(0, 5)).toEqual([]);
  });
});
