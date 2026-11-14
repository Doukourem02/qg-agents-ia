import { describe, expect, it } from 'vitest';
import { salutation, phraseNombre } from './comptes-rendus-texte';

describe('la salutation (heure d\'Abidjan = UTC)', () => {
  const a = (h: number) => Date.UTC(2026, 10, 10, h, 30);
  it('« Bonjour » de 5 h à 18 h', () => {
    for (const h of [5, 9, 12, 17]) expect(salutation(a(h))).toBe('Bonjour patron');
  });
  it('« Bonsoir » le reste du temps', () => {
    for (const h of [18, 22, 0, 4]) expect(salutation(a(h))).toBe('Bonsoir patron');
  });
});

describe('la phrase du nombre', () => {
  it('singulier et pluriel', () => {
    expect(phraseNombre(1)).toBe('1 personne a un compte rendu pour toi');
    expect(phraseNombre(3)).toBe('3 personnes ont un compte rendu pour toi');
  });
});
