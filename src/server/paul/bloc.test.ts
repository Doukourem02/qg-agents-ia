import { describe, expect, it } from 'vitest';
import { DEBUT, FIN, extraireBloc, reconstruire } from './bloc';
import { difference, retireTrop } from './diff';

const bloc = (t: string) => `${DEBUT}\n${t}\n${FIN}`;

describe('le bloc de Paul dans CLAUDE.md', () => {
  it('extraire : absent, présent, abîmé', () => {
    expect(extraireBloc('# Projet\n\nTexte.')).toBeNull();
    expect(extraireBloc(`# P\n\n${bloc('## Où on s\'est arrêté\n- a')}\n\nSuite`)).toBe('## Où on s\'est arrêté\n- a');
    expect(extraireBloc(`${DEBUT}\nseul`)).toBe('abime');
    expect(extraireBloc(`${FIN}\n${DEBUT}`)).toBe('abime');
    expect(extraireBloc(`${bloc('a')}\n${bloc('b')}`)).toBe('abime');
  });

  it('bloc présent : seul le texte entre les marqueurs change, tout le reste est identique au caractère près', () => {
    const avant = '# Mon projet\r\n\r\n@AGENTS.md\n\n' + bloc('ancien\nbloc') + '\n\n## Mes notes\n\nNe   pas toucher  \n  ni ici.\n';
    const apres = reconstruire(avant, '## Où on s\'est arrêté\n- nouveau');
    expect(apres).toBe('# Mon projet\r\n\r\n@AGENTS.md\n\n' + bloc('## Où on s\'est arrêté\n- nouveau') + '\n\n## Mes notes\n\nNe   pas toucher  \n  ni ici.\n');
    expect(extraireBloc(apres)).toBe('## Où on s\'est arrêté\n- nouveau');
  });

  it('bloc absent : inséré après le titre et les lignes @ d\'en-tête, le texte du patron intact autour', () => {
    const avant = '# Projet\n@AGENTS.md\n@docs/regles.md\n\nMon texte à moi.\n\n## Suite\n';
    const apres = reconstruire(avant, 'B');
    expect(apres).toBe('# Projet\n@AGENTS.md\n@docs/regles.md\n\n' + bloc('B') + '\n\nMon texte à moi.\n\n## Suite\n');
    // retirer le bloc inséré rend exactement le texte d'origine (à une ligne vide près)
    expect(apres.replace('\n' + bloc('B') + '\n', '')).toBe(avant);
  });

  it('bloc absent sans titre : tout en haut ; seulement un titre : juste après ; fichier vide ou absent : le bloc seul', () => {
    expect(reconstruire('Du texte.\n', 'B')).toBe(bloc('B') + '\n\nDu texte.\n');
    expect(reconstruire('# Titre', 'B')).toBe('# Titre\n\n' + bloc('B') + '\n');
    expect(reconstruire('', 'B')).toBe(bloc('B') + '\n');
    // un second titre n'est pas de l'en-tête
    expect(reconstruire('# A\n# B\n', 'X')).toBe('# A\n\n' + bloc('X') + '\n\n# B\n');
  });

  it('le bloc reçu est nettoyé (retours Windows, lignes vides au bord) ; marqueurs abîmés : erreur, rien n\'est écrit', () => {
    expect(reconstruire('', '\n\n  B\r\nC  \n\n')).toBe(bloc('  B\nC') + '\n');
    expect(() => reconstruire(`${DEBUT}\nseul`, 'B')).toThrow(/abîmés/);
  });
});

describe('ce qui change', () => {
  it('lignes ajoutées et retirées, « … » entre deux changements', () => {
    const d = difference('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\ne\nf\n');
    expect(d).toMatchObject({ ajoutees: 2, retirees: 1, nonVidesAvant: 5, nonVidesRetirees: 1 });
    expect(d.lignes).toEqual([
      { sorte: '-', texte: 'b' }, { sorte: '+', texte: 'B' }, { sorte: '…', texte: '' }, { sorte: '+', texte: 'f' },
    ]);
  });
  it('fichier nouveau : tout est ajouté ; au-delà de 150 lignes, le reste est compté', () => {
    const d = difference('', Array.from({ length: 160 }, (_, i) => `l${i}`).join('\n'));
    expect(d.ajoutees).toBe(160);
    expect(d.lignes).toHaveLength(151);
    expect(d.lignes.at(-1)).toEqual({ sorte: '…', texte: 'et 10 autres lignes changées' });
  });
  it('entier : aucune ligne coupée (pour le bloc de CLAUDE.md)', () => {
    const l = 'y'.repeat(400);
    expect(difference(l, 'z', { entier: true }).lignes[0]).toEqual({ sorte: '-', texte: l });
    expect(difference(l, 'z').lignes[0].texte.length).toBe(300);
  });
  it('règle des 40 % : sur les lignes non vides du fichier actuel', () => {
    const avant = ['# T', '', 'a', 'b', 'c', 'd', '', 'e'].join('\n'); // 6 lignes non vides
    expect(retireTrop(difference(avant, ['# T', 'a', 'b', 'c', 'x'].join('\n')))).toBe(false); // 2 sur 6 = 33 %
    expect(retireTrop(difference(avant, ['# T', 'a', 'b', 'x'].join('\n')))).toBe(true); // 3 sur 6 = 50 %
    expect(retireTrop(difference('', 'tout neuf'))).toBe(false);
  });
});
