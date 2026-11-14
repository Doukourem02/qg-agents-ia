// Des bougies et un marché faux pour les tests de Feu (aucun réseau).
import type { Bougie } from './types';

export const MIN = 60_000, H = 60 * MIN;
export const DUREES = { '4h': 4 * H, '1h': H, '15m': 15 * MIN } as const;

/** Une suite de bougies [o, h, l, c, v] qui se terminent juste avant `fin` (la dernière peut être « en cours »). */
export function bougies(serie: [number, number, number, number, number?][], pas: number, debut: number): Bougie[] {
  return serie.map(([o, h, l, c, v], i) => ({ t: debut + i * pas, o, h, l, c, v: v ?? 10, f: debut + (i + 1) * pas - 1 }));
}

/** Une suite plate autour de `p` (petites oscillations, pas de pivot net), `n` bougies. */
export const plat = (p: number, n: number): [number, number, number, number, number][] =>
  Array.from({ length: n }, (_, i) => { const d = (i % 2 ? 0.1 : -0.1); return [p, p + 0.3, p - 0.3, p + d, 10]; });

/** Des vagues : hauts et bas plus hauts (`sens` 1) ou plus bas (-1), autour de `p`. */
export function vagues(p: number, n: number, sens: 1 | -1, ampleur = 3): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const tendance = sens * i * 0.15;
    const onde = Math.sin(i / 2) * ampleur;
    const c = p + tendance + onde;
    out.push([c - 0.2, c + 0.6, c - 0.6, c, 10]);
  }
  return out;
}

/** Le faux miroir Binance : répond aux klines et à exchangeInfo, note chaque appel. */
export function fauxMiroir(donnees: Record<string, Record<string, Bougie[]>>, appels: string[] = []) {
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    appels.push(`${init?.method ?? 'GET'} ${u.origin}${u.pathname}`);
    if (u.pathname === '/api/v3/exchangeInfo') {
      return Response.json({
        symbols: ['BTCUSDT', 'ETHUSDT'].map(symbol => ({
          symbol, filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
            { filterType: 'LOT_SIZE', stepSize: symbol === 'BTCUSDT' ? '0.00001000' : '0.00010000' },
            { filterType: 'NOTIONAL', minNotional: '5.00000000' },
          ],
        })),
      });
    }
    if (u.pathname === '/api/v3/klines') {
      const b = donnees[u.searchParams.get('symbol')!]?.[u.searchParams.get('interval')!];
      if (!b) return new Response('{}', { status: 400 });
      return Response.json(b.map(x => [x.t, String(x.o), String(x.h), String(x.l), String(x.c), String(x.v), x.f, '0', 1, '0', '0', '0']));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return f;
}
