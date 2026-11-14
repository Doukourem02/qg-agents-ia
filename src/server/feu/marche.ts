// La lecture du marché par le QG : les bougies et les règles des paires, sur le miroir public des données de marché de
// Binance (sans clé : `api.binance.com` refuse les serveurs situés aux États-Unis, ce que sont les fonctions Vercel).
// Seulement deux adresses, en GET, jamais signées : rien ici ne peut passer un ordre. `fetch` est injecté (testable).
import type { Bougie, Intervalle, Paire, ReglesPaire } from './types';

export const MIROIR = 'https://data-api.binance.vision';
/** Les seules routes que le QG appelle chez Binance (lecture publique). */
export const ROUTES_PUBLIQUES = ['/api/v3/klines', '/api/v3/exchangeInfo'] as const;
const DELAI_MS = 12_000;
/** Assez de bougies pour les pivots, le RSI et deux semaines de 4h. */
export const NOMBRE: Record<Intervalle, number> = { '4h': 120, '1h': 120, '15m': 96 };

export class ErreurMarche extends Error {}

async function lireJson(f: typeof fetch, url: string): Promise<unknown> {
  let r: Response;
  try {
    r = await f(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(DELAI_MS) });
  } catch { throw new ErreurMarche('Binance injoignable'); }
  if (!r.ok) throw new ErreurMarche(`Binance a répondu ${r.status}`);
  try { return await r.json(); } catch { throw new ErreurMarche('réponse illisible'); }
}

const nombre = (v: unknown) => { const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : NaN; };

/** Les bougies d'une paire (la dernière est celle en cours : son « c » est le prix au moment de la lecture). */
export async function lireBougies(f: typeof fetch, paire: Paire, intervalle: Intervalle, limite = NOMBRE[intervalle]): Promise<Bougie[]> {
  const brut = await lireJson(f, `${MIROIR}/api/v3/klines?symbol=${paire}&interval=${intervalle}&limit=${limite}`);
  if (!Array.isArray(brut)) throw new ErreurMarche('bougies illisibles');
  const out = brut.map(k => (Array.isArray(k) ? { t: nombre(k[0]), o: nombre(k[1]), h: nombre(k[2]), l: nombre(k[3]), c: nombre(k[4]), v: nombre(k[5]), f: nombre(k[6]) } : null));
  if (out.some(b => !b || Object.values(b).some(v => !Number.isFinite(v)))) throw new ErreurMarche('bougies illisibles');
  return out as Bougie[];
}

/** Le pas de prix, le pas de quantité et le minimum en USDT de chaque paire (exchangeInfo). */
export async function lireReglesPaires(f: typeof fetch, paires: readonly Paire[]): Promise<Record<string, ReglesPaire>> {
  const brut = await lireJson(f, `${MIROIR}/api/v3/exchangeInfo?symbols=${encodeURIComponent(JSON.stringify(paires))}`) as { symbols?: { symbol: string; filters: Record<string, string>[] }[] };
  const out: Record<string, ReglesPaire> = {};
  for (const s of brut?.symbols ?? []) {
    const filtre = (type: string) => s.filters?.find(x => x.filterType === type);
    const tick = nombre(filtre('PRICE_FILTER')?.tickSize), pas = nombre(filtre('LOT_SIZE')?.stepSize);
    const minimum = nombre(filtre('NOTIONAL')?.minNotional ?? filtre('MIN_NOTIONAL')?.minNotional);
    if (tick > 0 && pas > 0) out[s.symbol] = { tick, pas, minimum: Number.isFinite(minimum) ? minimum : 5 };
  }
  for (const p of paires) if (!out[p]) throw new ErreurMarche(`règles de ${p} introuvables`);
  return out;
}
