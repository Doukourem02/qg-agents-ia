import { describe, expect, it } from 'vitest';
import { derniereSeule } from './derniere-seule';

describe('derniereSeule (bureau de Clara)', () => {
  it('F10 : deux clics rapides → seule la réponse du dernier s\'applique', () => {
    const d = derniereSeule();
    const a = d.prendre(), b = d.prendre();
    expect(b()).toBe(true);
    expect(a()).toBe(false);
  });
  it('une lecture périodique lancée avant un clic est périmée par ce clic', () => {
    const d = derniereSeule();
    const lecture = d.prendre();
    const clic = d.prendre();
    expect(lecture()).toBe(false);
    expect(clic()).toBe(true);
  });
});
