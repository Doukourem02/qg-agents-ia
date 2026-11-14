import { describe, it, expect } from 'vitest';
import { construireRequete } from './connaissances.mjs';

describe('construireRequete (connaissances)', () => {
  it('envoyer : POST JSON vers /api/agents/connaissances, sans laissez-passer si QG_BYPASS absent', () => {
    const { url, init } = construireRequete('envoyer', { projet: {} }, {});
    expect(url).toBe('https://mon-qg.vercel.app/api/agents/connaissances');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ projet: {} });
  });
  it('respecte QG_URL et QG_BYPASS', () => {
    const { url, init } = construireRequete('envoyer', {}, { QG_URL: 'http://localhost:1/', QG_BYPASS: 'x' });
    expect(url).toBe('http://localhost:1/api/agents/connaissances');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('refuse une commande inconnue', () => {
    expect(() => construireRequete('lire', {}, {})).toThrow(/inconnue/);
  });
});
