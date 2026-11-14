import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '@/data/agents.json';
import { AGENTS_REELS } from '@/data/reels';
import { enColonnes, marque, ordreEquipe, ordrePoles, organigramme, roleCourt, type Membre } from './organigramme';

describe('organigramme', () => {
  const o = organigramme(data.agents, data.poles, AGENTS_REELS);

  it('Kuroro au sommet : c\'est lui le boss', () => {
    expect(o.ceo?.id).toBe('kuroro');
  });

  it('Feu, à la Direction sans diriger de pôle, est rattaché au CEO', () => {
    expect(o.aupres.map(m => m.id)).toEqual(['feu']);
  });

  it('les chefs de pôle : Stalker, Obito au centre, Isaac', () => {
    expect(o.branches.map(b => b.chef.id)).toEqual(['stalker', 'obito', 'isaac']);
    expect(o.branches.map(b => b.pole)).toEqual(['code', 'communication', 'mac']);
  });

  it('la Communication va au centre quel que soit l\'ordre de agents.json', () => {
    const poles = [{ id: 'communication', chef: 'o' }, { id: 'direction', chef: 'k' }, { id: 'a', chef: 'x' }, { id: 'b', chef: 'y' }];
    expect(ordrePoles(poles).map(p => p.id)).toEqual(['a', 'communication', 'b']);
  });

  it('une équipe : réels, puis prévus, puis « plus tard »', () => {
    const rang = { reel: 0, prevu: 1, plusTard: 2 } as const;
    for (const b of o.branches) {
      const r = b.equipe.filter(m => !m.n1).map(m => rang[m.marque]);
      expect(r).toEqual([...r].sort((x, y) => x - y));
    }
    const code = o.branches.find(b => b.pole === 'code')!;
    expect(code.equipe.map(m => m.id)).toEqual(['light', 'mafe', 'luffy', 'zoro', 'lea', 'paul', 'sam']);
    expect(code.equipe.at(-1)?.marque).toBe('plusTard');
  });

  it('L en tête de la Communication, n°1 du QG', () => {
    const com = o.branches.find(b => b.pole === 'communication')!;
    expect(com.equipe[0]).toEqual({ id: 'L', marque: 'reel', n1: true });
    expect(com.equipe.map(m => m.id)).toEqual(['L', 'ye', 'tom']);
    // même si L n'était pas encore réel, il resterait premier
    const sansL: Membre[] = [{ id: 'a', marque: 'reel', n1: false }, { id: 'L', marque: 'prevu', n1: true }];
    expect(ordreEquipe(sansL)[0].id).toBe('L');
  });

  it('marque : réel d\'après AGENTS_REELS, sinon prévu ou plus tard', () => {
    expect(marque({ id: 'isaac', plusTard: false }, AGENTS_REELS)).toBe('reel');
    expect(marque({ id: 'paul', plusTard: false }, AGENTS_REELS)).toBe('reel');
    expect(marque({ id: 'ye', plusTard: false }, AGENTS_REELS)).toBe('reel');
    expect(marque({ id: 'obito', plusTard: false }, AGENTS_REELS)).toBe('prevu');
    expect(marque({ id: 'tom', plusTard: true }, AGENTS_REELS)).toBe('plusTard');
  });

  it('chaque agent de agents.json apparaît une seule fois', () => {
    const ids = [o.ceo!.id, ...o.aupres.map(m => m.id), ...o.branches.flatMap(b => [b.chef.id, ...b.equipe.map(m => m.id)])];
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(data.agents.map(a => a.id).sort());
  });

  it('rôle court et colonnes', () => {
    expect(roleCourt('CMO, chef direct de L')).toBe('CMO');
    expect(roleCourt('Testeur (plus tard)')).toBe('Testeur');
    expect(enColonnes([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(enColonnes([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3, 4], [5, 6, 7]]);
  });
});

describe('onglet Équipe', () => {
  const panels = readFileSync('src/ui/Panels.tsx', 'utf8');
  it('le vrai état des agents seulement hors /demo, et seulement pour les agents réels', () => {
    expect(panels).toContain("demo || m.marque !== 'reel' ? undefined : s.vues?.agents.find(x => x.agent === m.id)?.statut");
  });
  it('un clic ouvre la fiche comme avant, et l\'animation respecte prefers-reduced-motion', () => {
    expect(panels).toContain('onClick={() => voirAgent(m.id)}');
    expect(panels).toContain('useReducedMotion()');
  });
});
