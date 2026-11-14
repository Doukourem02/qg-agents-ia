import { describe, expect, it } from 'vitest';
import { fontOmbre } from './OmbresContact';

describe('les ombres de contact', () => {
  const b = (o: object) => ({ x: 0, y: 0, w: 1, d: 1, h: 0.5, c: '#fff', ...o });
  it('un meuble posé au sol ou un plateau bas fait de l\'ombre', () => {
    expect(fontOmbre(b({}))).toBe(true);
    expect(fontOmbre(b({ z: 0.4, h: 0.06 }))).toBe(true);
  });
  it('ni ce qui est en hauteur, ni le sous-sol, ni les miettes, ni les très grands blocs (l\'île, un mur entier)', () => {
    expect(fontOmbre(b({ z: 1 }))).toBe(false);
    expect(fontOmbre(b({ z: -0.12 }))).toBe(false);
    expect(fontOmbre(b({ w: 0.1, d: 0.1 }))).toBe(false);
    expect(fontOmbre(b({ h: 0.02 }))).toBe(false);
    expect(fontOmbre(b({ w: 39 }))).toBe(false);
  });
});
