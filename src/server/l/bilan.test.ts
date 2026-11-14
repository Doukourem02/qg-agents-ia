import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { dernierBilan, enregistrerBilan, validerBilan } from './bilan';

const base = { statsId: 's', resume: 'ok' };

describe('bilan', () => {
  it('valide un bilan minimal avec des listes vides', () => {
    expect(validerBilan(base)).toEqual({ statsId: 's', resume: 'ok', chiffres: [], marche: [], lecteurs: [], ajustements: [] });
  });
  it('refuse : statsId absent, résumé vide ou long, trop de chiffres, listes trop grandes', () => {
    const code = (v: unknown) => { try { validerBilan(v); } catch (e) { return (e as { code: number }).code; } };
    expect(code({ resume: 'ok' })).toBe(400);
    expect(code({ ...base, resume: ' ' })).toBe(400);
    expect(code({ ...base, resume: 'x'.repeat(601) })).toBe(400);
    expect(code({ ...base, chiffres: Array(7).fill({ nom: 'a', valeur: '1' }) })).toBe(400);
    expect(code({ ...base, lecteurs: Array(6).fill('a') })).toBe(400);
    expect(code({ ...base, ajustements: ['a'.repeat(201)] })).toBe(400);
    expect(code({ ...base, marche: 'non' })).toBe(400);
  });
  it('enregistre avec la semaine ISO et rend le plus récent', async () => {
    const kv = memoire();
    expect(await dernierBilan(kv)).toBeNull();
    await enregistrerBilan(kv, validerBilan(base), Date.UTC(2026, 10, 9));
    const b2 = await enregistrerBilan(kv, validerBilan({ ...base, resume: 'deux' }), Date.UTC(2026, 10, 16));
    expect(b2.semaine).toBe('2026-W47');
    expect((await dernierBilan(kv))?.resume).toBe('deux');
  });
});
