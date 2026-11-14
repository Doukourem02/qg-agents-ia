import { describe, it, expect } from 'vitest';
import { borner } from './deplacable';

describe('borner', () => {
  const rect = { left: 100, top: 10, width: 200, height: 36 }, fenetre = { w: 1200, h: 675 };
  it('laisse passer un déplacement normal', () => {
    expect(borner({ x: 50, y: 100 }, rect, fenetre, 1)).toEqual({ x: 50, y: 100 });
  });
  it('garde au moins 40 px du menu dans la fenêtre', () => {
    expect(borner({ x: -5000, y: -5000 }, rect, fenetre, 1)).toEqual({ x: -260, y: -10 });
    expect(borner({ x: 5000, y: 5000 }, rect, fenetre, 1)).toEqual({ x: 1060, y: 625 });
  });
  it('tient compte de l’échelle de l’interface', () => {
    expect(borner({ x: 5000, y: 0 }, rect, fenetre, 2)).toEqual({ x: 530, y: 0 });
  });
});
