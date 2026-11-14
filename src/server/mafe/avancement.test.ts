import { describe, expect, it } from 'vitest';
import {
  choisirPriorite, derniereCochee, estUrgent, lireCases, lireListe, lireSeance, ouOnSArrete, suiteApres,
  type Avancement, type PointProjet,
} from './avancement';

describe('lireCases', () => {
  it('lit les cases, imbriquées et en majuscule', () => {
    const c = lireCases('- [ ] a\n- [x] b\n  - [X] c');
    expect(c.map((x) => [x.texte, x.fait])).toEqual([['a', false], ['b', true], ['c', true]]);
  });
  it('prend la section du dernier titre au-dessus', () => {
    const c = lireCases('# Un\n- [ ] a\n### Deux **gras**\n- [ ] b');
    expect(c.map((x) => x.section)).toEqual(['Un', 'Deux gras']);
  });
  it('ignore les lignes dans un bloc de code', () => {
    const md = '- [ ] avant\n```md\n- [ ] faux\n# faux titre\n```\n- [x] après';
    const c = lireCases(md);
    expect(c.map((x) => x.texte)).toEqual(['avant', 'après']);
    expect(c[1].section).toBe('');
  });
  it('repère le facultatif sans tenir compte de la casse', () => {
    const c = lireCases('- [ ] Facultatif : a\n- [ ] b (Optionnel)\n- [ ] c optionnel\n- [ ] d');
    expect(c.map((x) => x.facultatif)).toEqual([true, true, true, false]);
  });
  it('retire le gras et les espaces doublés', () => {
    expect(lireCases('- [ ] **Faire**   ça  bien')[0].texte).toBe('Faire ça bien');
  });
  it('marque les cases urgentes', () => {
    const c = lireCases('## Débloquer (urgent)\n- [ ] a\n## Plus tard\n- [ ] b ⚠️');
    expect(c.map((x) => x.urgent)).toEqual([true, true]);
  });
});

describe('estUrgent', () => {
  it('reconnaît urgent, prioritaire et ⚠️', () => {
    expect(estUrgent('Passer à Node 24', '1. Débloquer le développement (urgent)')).toBe(true);
    expect(estUrgent('Retrouver ⚠️ prioritaire', '')).toBe(true);
    expect(estUrgent('Tâche prioritaire', '')).toBe(true);
  });
  it('refuse les négations', () => {
    expect(estUrgent('x', 'Non urgent')).toBe(false);
    expect(estUrgent('pas urgent du tout', '')).toBe(false);
    expect(estUrgent('x', '')).toBe(false);
  });
});

describe('corrections de relecture', () => {
  it('⚠ sans sélecteur de variante compte', () => {
    expect(estUrgent('Retrouver \u26A0 ça', '')).toBe(true);
    expect(estUrgent('Retrouver \u26A0\uFE0F ça', '')).toBe(true);
  });
  it('les négations non-urgent, non urgent, pas encore urgent', () => {
    for (const s of ['non-urgent', 'Non urgent', 'pas urgent', 'pas encore urgent', 'non-prioritaire']) {
      expect(estUrgent(s, '')).toBe(false);
    }
    expect(estUrgent('non-urgent mais prioritaire', '')).toBe(true);
  });
  it('un # final collé au titre reste (C#), un # de fermeture précédé d\'un espace part', () => {
    expect(lireCases('## Migrer vers C#\n- [ ] a')[0].section).toBe('Migrer vers C#');
    expect(lireCases('## Titre ##\n- [ ] a')[0].section).toBe('Titre');
  });
});

describe('lireListe', () => {
  it('ne compte que les puces de premier niveau qui ne sont pas des cases', () => {
    const md = [
      '# Tâches', '',
      '- **Désactiver les clés Supabase legacy** (après migration)',
      '  - détail imbriqué',
      '- [ ] une case',
      '```', '- dans un bloc', '```',
      '## Urgent', '- Corriger le paiement',
    ].join('\n');
    const l = lireListe(md);
    expect(l.map((x) => x.texte)).toEqual(['Désactiver les clés Supabase legacy (après migration)', 'Corriger le paiement']);
    expect(l.map((x) => x.urgent)).toEqual([false, true]);
    expect(l[0].section).toBe('Tâches');
  });
});

describe('derniereCochee', () => {
  const v3 = { quand: '2026-11-08T10:00:00Z', contenu: '- [x] a\n- [x] b\n- [ ] c' };
  const v2 = { quand: '2026-11-05T10:00:00Z', contenu: '- [x] a\n- [ ] b\n- [ ] c' };
  const v1 = { quand: '2026-11-01T10:00:00Z', contenu: '- [ ] a\n- [ ] b\n- [ ] c' };
  it('donne la case cochée dans la version la plus récente qui en coche une', () => {
    expect(derniereCochee([v3, v2, v1])).toEqual({ texte: 'b', quand: v3.quand });
  });
  it('remonte aux versions plus anciennes', () => {
    expect(derniereCochee([{ ...v3, contenu: v2.contenu }, v2, v1])).toEqual({ texte: 'a', quand: v2.quand });
  });
  it('ignore une case dont le texte a changé', () => {
    const nouveau = { quand: 'q', contenu: '- [x] b changé\n- [ ] a' };
    const ancien = { quand: 'p', contenu: '- [ ] b\n- [ ] a' };
    expect(derniereCochee([nouveau, ancien])).toBeNull();
  });
  it('rend null sans transition', () => {
    expect(derniereCochee([v1, v1])).toBeNull();
    expect(derniereCochee([v1])).toBeNull();
    expect(derniereCochee([])).toBeNull();
  });
});

describe('suiteApres', () => {
  const cases = lireCases('- [x] a\n- [x] b\n- [ ] c\n- [ ] d');
  it('donne la première non cochée après la dernière cochée', () => {
    expect(suiteApres(cases, 'b')).toBe('c');
  });
  it('sans dernière cochée, saute le facultatif', () => {
    const c = lireCases('- [ ] Facultatif : x\n- [ ] y');
    expect(suiteApres(c, null)).toBe('y');
  });
  it('préfère la même section', () => {
    const c = lireCases('# A\n- [x] a\n# B\n- [ ] b\n# A bis\n- [ ] c');
    expect(suiteApres(c, 'a')).toBe('b');
    const d = lireCases('# A\n- [x] a\n- [ ] a2\n# B\n- [ ] b');
    expect(suiteApres(d, 'a')).toBe('a2');
  });
  it('rend null quand tout est coché', () => {
    expect(suiteApres(lireCases('- [x] a'), 'a')).toBeNull();
    expect(suiteApres(lireCases('- [x] a'), null)).toBeNull();
  });
});

describe('lireSeance', () => {
  const md = '# Séance\n\n## Fait\n- truc\n\n## La suite\n- premier **point**\n- second point\n\n## Autre\n- non';
  it('lit les puces sous « La suite » et la date du nom', () => {
    expect(lireSeance('docs/seances/2026-11-10.md', md)).toEqual({
      fichier: 'docs/seances/2026-11-10.md', date: '2026-11-10', suite: ['premier point', 'second point'],
    });
  });
  it('accepte le suffixe -2', () => {
    expect(lireSeance('docs/seances/2026-11-10-2.md', md)?.date).toBe('2026-11-10');
  });
  it('rend null si le nom n\'a pas de date', () => {
    expect(lireSeance('docs/seances/notes.md', md)).toBeNull();
  });
});

function point(p: Partial<PointProjet> = {}): PointProjet {
  return {
    depot: 'qg', nom: 'QG', pousse: '2026-11-09T08:00:00Z', dernierTravail: null, enPause: false,
    avancement: { genre: 'commits' }, seance: null, commits: [], ouOnSArrete: '', ...p,
  };
}

describe('ouOnSArrete', () => {
  const cases: Avancement = { genre: 'cases', fichier: 'f.md', faites: 1, total: 3, derniere: { texte: 'X', quand: '2026-11-08T10:00:00Z' }, suite: 'Y', urgentes: [] };
  const { ouOnSArrete: _a, enPause: _b, ...base } = point();
  void _a; void _b;
  it('préfère une séance plus récente', () => {
    const seance = { fichier: 's', date: '2026-11-10', suite: ['A', 'B'] };
    expect(ouOnSArrete({ ...base, avancement: cases, seance })).toBe('La suite (séance du 10 nov.) : A ; B');
  });
  it('ignore une séance plus ancienne', () => {
    const seance = { fichier: 's', date: '2026-11-07', suite: ['A'] };
    expect(ouOnSArrete({ ...base, avancement: cases, seance })).toBe('Dernière case cochée : X (le 8 nov.) → La suite : Y');
  });
  it('liste', () => {
    expect(ouOnSArrete({ ...base, avancement: { genre: 'liste', fichier: 'f', restantes: 12, premiere: 'Z', urgentes: [] } }))
      .toBe('12 tâches restantes, la première : Z');
  });
  it('commits', () => {
    const commits = [{ date: '2026-11-06T09:00:00Z', message: 'Corrige', url: 'u' }];
    expect(ouOnSArrete({ ...base, commits })).toBe('Dernier travail le 6 nov. : Corrige');
  });
  it('sans commit, date de pousse', () => {
    expect(ouOnSArrete({ ...base, pousse: '2026-10-20T00:00:00Z' })).toBe('Dernier travail le 20 oct.');
  });
});

describe('choisirPriorite', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const urgent: Avancement = { genre: 'cases', fichier: 'f', faites: 0, total: 1, derniere: null, suite: 'S', urgentes: ['Corriger'] };
  it('liste vide', () => expect(choisirPriorite([], now)).toBeNull());
  it('une urgence gagne contre un projet travaillé hier', () => {
    const r = choisirPriorite([
      point({ depot: 'a', nom: 'A', dernierTravail: '2026-11-09T10:00:00Z' }),
      point({ depot: 'b', nom: 'B', avancement: urgent, dernierTravail: '2026-10-01T10:00:00Z' }),
    ], now);
    expect(r).toEqual({ depot: 'b', nom: 'B', raison: 'une tâche urgente attend : Corriger' });
  });
  it('deux urgences : le travail le plus récent', () => {
    const r = choisirPriorite([
      point({ depot: 'a', nom: 'A', avancement: urgent, dernierTravail: '2026-11-01T10:00:00Z' }),
      point({ depot: 'b', nom: 'B', avancement: urgent, dernierTravail: '2026-11-05T10:00:00Z' }),
    ], now);
    expect(r?.depot).toBe('b');
  });
  it('sans urgence : le projet travaillé dans les 7 jours', () => {
    const r = choisirPriorite([
      point({ depot: 'a', nom: 'A', dernierTravail: '2026-11-03T10:00:00Z', pousse: '2026-11-10T00:00:00Z' }),
      point({ depot: 'b', nom: 'B', dernierTravail: '2026-11-09T10:00:00Z', seance: { fichier: 's', date: '2026-11-09', suite: ['Finir'] } }),
    ], now);
    expect(r).toEqual({ depot: 'b', nom: 'B', raison: 'tu étais dessus le 9 nov., reprends : Finir' });
  });
  it('sinon le plus récemment poussé', () => {
    const r = choisirPriorite([
      point({ depot: 'a', nom: 'A', dernierTravail: '2026-10-01T10:00:00Z', pousse: '2026-10-02T00:00:00Z' }),
      point({ depot: 'b', nom: 'B', pousse: '2026-10-20T00:00:00Z' }),
    ], now);
    expect(r?.depot).toBe('b');
  });
  it('un projet en pause n\'est choisi que pour une urgence', () => {
    expect(choisirPriorite([point({ enPause: true, dernierTravail: '2026-11-09T10:00:00Z' })], now)).toBeNull();
    expect(choisirPriorite([point({ enPause: true, avancement: urgent })], now)?.raison).toContain('urgente');
  });
  it('un projet en lecture impossible n\'est jamais la priorité', () => {
    const r = choisirPriorite([
      point({ depot: 'a', nom: 'A', lectureImpossible: true, dernierTravail: '2026-11-09T10:00:00Z', pousse: '2026-11-10T00:00:00Z' }),
      point({ depot: 'b', nom: 'B', dernierTravail: '2026-10-01T10:00:00Z', pousse: '2026-10-02T00:00:00Z' }),
    ], now);
    expect(r?.depot).toBe('b');
    expect(choisirPriorite([point({ lectureImpossible: true, dernierTravail: '2026-11-09T10:00:00Z' })], now)).toBeNull();
  });
});
