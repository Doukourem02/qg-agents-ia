import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { demanderRelais, repondreIA, reveillerMac, type Tour } from './kuroro-ia';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const conv: Tour[] = [{ role: 'moi', texte: 'qui est en charge de mon Mac ?' }];
const vite = { attendre: async () => {} };

/** Un faux fetch : une réponse par adresse (une file si plusieurs), ou une erreur. */
function faux(routes: Record<string, (() => Response | Promise<Response>) | (() => Response)[]>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const r = routes[String(url)];
    if (!r) throw new TypeError('Failed to fetch');
    return Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0])() : r();
  }) as unknown as typeof fetch & { mock: { calls: [RequestInfo | URL, RequestInit?][] } };
}
const R = '/api/qg/kuroro/reponse?id=abc';

describe('Kuroro dans la page : Claude, puis le Mac par le QG, puis les règles', () => {
  it('Claude répond : le Mac n’est pas sollicité', async () => {
    const f = faux({ '/api/qg/kuroro': () => json({ texte: 'C’est Isaac.' }) });
    expect(await repondreIA(conv, f, vite)).toEqual({ source: 'claude', texte: 'C’est Isaac.' });
    expect(f.mock.calls.map(c => String(c[0]))).toEqual(['/api/qg/kuroro']);
  });

  it('Claude dit « repli » : la demande part au QG, la page attend la réponse du Mac (toutes les 700 ms)', async () => {
    const pas: number[] = [];
    const f = faux({
      '/api/qg/kuroro': () => json({ repli: true }),
      '/api/qg/kuroro/demande': () => json({ id: 'abc' }),
      [R]: [() => json({ statut: 'attente' }), () => json({ statut: 'attente' }), () => json({ statut: 'prete', texte: 'Entendu…', mission: { agent: 'isaac', nom: 'Isaac' } })],
    });
    expect(await repondreIA(conv, f, { attendre: async ms => { pas.push(ms); } }))
      .toEqual({ source: 'relais', texte: 'Entendu…', mission: { agent: 'isaac', nom: 'Isaac' } });
    expect(pas).toEqual([700, 700, 700]);
    const [, init] = f.mock.calls[1];
    expect(JSON.parse(String(init!.body))).toEqual({ messages: conv });
  });

  it('le Mac n’est pas là, la réponse expire, la demande est refusée : null (les règles), sans attendre', async () => {
    const pas: number[] = [];
    const attendre = async (ms: number) => { pas.push(ms); };
    expect(await repondreIA(conv, faux({ '/api/qg/kuroro': () => json({ repli: true }), '/api/qg/kuroro/demande': () => json({ mac: false }) }), { attendre })).toBeNull();
    expect(pas).toEqual([]);
    expect(await repondreIA(conv, faux({ '/api/qg/kuroro/demande': () => json({ id: 'abc' }), [R]: () => json({ statut: 'expiree' }) }), vite)).toBeNull();
    expect(await repondreIA(conv, faux({ '/api/qg/kuroro/demande': () => json({ erreur: 'x' }, 403) }), vite)).toBeNull();
  });

  it('jamais plus de 30 s d’attente', async () => {
    const pas: number[] = [];
    const f = faux({ '/api/qg/kuroro/demande': () => json({ id: 'abc' }), [R]: () => json({ statut: 'attente' }) });
    expect(await demanderRelais(conv, f, { attendre: async ms => { pas.push(ms); } })).toBeNull();
    expect(pas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);
    expect(pas.length).toBeGreaterThan(40);
  });

  it('« Effacer » coupe l’attente tout de suite', async () => {
    const c = new AbortController();
    let n = 0;
    const f = faux({ '/api/qg/kuroro/demande': () => json({ id: 'abc' }), [R]: () => { if (++n === 2) c.abort(); return json({ statut: 'attente' }); } });
    expect(await demanderRelais(conv, f, { ...vite, signal: c.signal })).toBeNull();
    expect(n).toBe(2);
  });

  it('la page n’appelle plus Ollama directement (Safari le bloque)', () => {
    expect(readFileSync('src/ui/kuroro-ia.ts', 'utf8')).not.toMatch(/localhost|11434/);
  });

  it('ouvrir la conversation réveille le Mac : au plus un appel par 30 s, sans attendre la réponse', async () => {
    const f = vi.fn(async () => json({ reveil: true })) as unknown as typeof fetch & { mock: { calls: [RequestInfo | URL, RequestInit?][] } };
    const T = 1_000_000;
    expect(reveillerMac(f, T)).toBe(true);
    expect(reveillerMac(f, T + 10_000)).toBe(false);
    expect(reveillerMac(f, T + 30_000)).toBe(true);
    expect(f.mock.calls.map(c => [String(c[0]), c[1]?.method])).toEqual([['/api/qg/kuroro/eveil', 'POST'], ['/api/qg/kuroro/eveil', 'POST']]);
    expect(reveillerMac(vi.fn(async () => { throw new TypeError('x'); }) as unknown as typeof fetch, T + 90_000)).toBe(true);
  });
});
