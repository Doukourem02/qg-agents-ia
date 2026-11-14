import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BINANCE, LECTURES, droitsEnTrop, passageFeu, signer } from './feu.mjs';

const NOW = Date.UTC(2026, 10, 13, 10, 0);
const CLE = 'cle-de-test-0123456789', SECRET = 'secret-de-test-9876543210';
const DROITS_LECTURE = {
  ipRestrict: false, createTime: 1, enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false,
  enableInternalTransfer: false, enableMargin: false, enableFutures: false, permitsUniversalTransfer: false,
  enableVanillaOptions: false, enablePortfolioMarginTrading: false,
};

/** Un faux Binance : répond aux lectures connues, note chaque appel (méthode, chemin, en-têtes). */
function fauxBinance(reponses = {}) {
  const appels = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    appels.push({ methode: init.method ?? 'GET', chemin: u.pathname, cle: init.headers?.['X-MBX-APIKEY'], url: String(url) });
    const r = reponses[u.pathname + (u.searchParams.get('symbol') ? `?${u.searchParams.get('symbol')}` : '')] ?? reponses[u.pathname];
    if (r === undefined) return new Response('{}', { status: 404 });
    if (r instanceof Response) return r;
    return Response.json(r);
  };
  return { appels, fetch };
}
const COMPTE = {
  '/sapi/v1/account/apiRestrictions': DROITS_LECTURE,
  '/api/v3/account': { balances: [{ asset: 'USDT', free: '0.00160486', locked: '0' }, { asset: 'DOGE', free: '5', locked: '0' }] },
  '/sapi/v1/simple-earn/flexible/position': { rows: [{ asset: 'USDT', totalAmount: '8.5' }], total: 1 },
  '/api/v3/openOrders?BTCUSDT': [], '/api/v3/openOrders?ETHUSDT': [],
  '/api/v3/myTrades?BTCUSDT': [{ symbol: 'BTCUSDT', id: 1, orderId: 9, price: '76983.33', qty: '0.0001', quoteQty: '7.698333', commission: '0.0000001', commissionAsset: 'BTC', time: NOW - 86_400_000 * 10, isBuyer: true }],
  '/api/v3/myTrades?ETHUSDT': [],
};

describe('Feu (Mac) · lecture seule', () => {
  it('la signature HMAC SHA-256 de la documentation Binance', () => {
    expect(signer('symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559', 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j'))
      .toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  });

  it('droits : seule la lecture est permise ; tout droit d\'écriture (ou une forme inconnue) est en trop', () => {
    expect(droitsEnTrop(DROITS_LECTURE)).toEqual([]);
    for (const d of ['enableSpotAndMarginTrading', 'enableWithdrawals', 'enableMargin', 'enableFutures', 'enableInternalTransfer', 'permitsUniversalTransfer', 'enableVanillaOptions', 'enablePortfolioMarginTrading', 'enableFixApiTrade']) {
      expect(droitsEnTrop({ ...DROITS_LECTURE, [d]: true })).toEqual([d]);
    }
    expect(droitsEnTrop({ ...DROITS_LECTURE, enableReading: false })).toEqual(['lectureNonConfirmee']);
    expect(droitsEnTrop(null)).toEqual(['lectureNonConfirmee']);
  });

  it('clé absente du Trousseau : rien n\'est lu chez Binance ; le QG le sait (une fois par heure au plus)', async () => {
    const { appels, fetch } = fauxBinance(COMPTE);
    const envois = [];
    const r = await passageFeu({ now: NOW, lireCle: async () => null, fetch, appeler: async (c, corps) => envois.push([c, corps]) });
    expect(appels).toHaveLength(0);
    expect(envois).toEqual([['compte', { quand: NOW, cle: 'absente' }]]);
    expect(r).toEqual({ feuAbsente: NOW });
    await passageFeu({ now: NOW + 5 * 60_000, etat: r, lireCle: async () => null, fetch, appeler: async (c, corps) => envois.push([c, corps]) });
    expect(envois).toHaveLength(1);
  });

  it('une clé qui peut trader ou retirer : Feu refuse, ne lit rien d\'autre, et le dit au QG', async () => {
    const { appels, fetch } = fauxBinance({ ...COMPTE, '/sapi/v1/account/apiRestrictions': { ...DROITS_LECTURE, enableSpotAndMarginTrading: true, enableWithdrawals: true } });
    const envois = [];
    await passageFeu({ now: NOW, lireCle: async () => ({ cle: CLE, secret: SECRET }), fetch, appeler: async (c, corps) => envois.push(corps) });
    expect(appels.map(a => a.chemin)).toEqual(['/sapi/v1/account/apiRestrictions']);
    expect(envois[0]).toEqual({ quand: NOW, cle: 'droits', droits: ['enableSpotAndMarginTrading', 'enableWithdrawals'] });
  });

  it('une clé en lecture seule : Spot, Earn, ordres ouverts et exécutés ; seulement des GET de la liste ; jamais la clé ni le secret au QG', async () => {
    const { appels, fetch } = fauxBinance(COMPTE);
    const envois = [];
    await passageFeu({ now: NOW, lireCle: async () => ({ cle: CLE, secret: SECRET }), fetch, appeler: async (c, corps) => envois.push([c, corps]) });
    expect(appels.every(a => a.methode === 'GET' && LECTURES.includes(a.chemin) && a.url.startsWith(BINANCE))).toBe(true);
    expect(appels.every(a => a.cle === CLE && /[?&]signature=[0-9a-f]{64}$/.test(a.url) && !a.url.includes(SECRET))).toBe(true);
    expect(appels.map(a => a.chemin)[0]).toBe('/sapi/v1/account/apiRestrictions');
    const [commande, corps] = envois[0];
    expect(commande).toBe('compte');
    expect(corps).toMatchObject({ cle: 'ok', spot: { USDT: { libre: 0.00160486, bloque: 0 } }, earn: { USDT: 8.5 } });
    expect(corps.spot.DOGE).toBeUndefined();
    expect(corps.executes[0]).toMatchObject({ paire: 'BTCUSDT', cote: 'BUY', prix: 76983.33, fraisActif: 'BTC' });
    const texte = JSON.stringify(envois);
    expect(texte).not.toContain(CLE);
    expect(texte).not.toContain(SECRET);
  });

  it('Binance en erreur : le QG le sait, sans détail ; le QG injoignable n\'arrête pas le relais', async () => {
    const { fetch } = fauxBinance({ '/sapi/v1/account/apiRestrictions': new Response('{"code":-2015}', { status: 401 }) });
    const envois = [];
    await passageFeu({ now: NOW, lireCle: async () => ({ cle: CLE, secret: SECRET }), fetch, appeler: async (c, corps) => envois.push(corps) });
    expect(envois[0]).toEqual({ quand: NOW, cle: 'erreur', raison: 'Binance a répondu 401' });
    const journal = [];
    const r = await passageFeu({ now: NOW, lireCle: async () => null, fetch, appeler: async () => { throw new Error('réseau'); }, journal: m => journal.push(m) });
    expect(r).toEqual({});
    expect(journal[0]).toContain('envoi en échec');
  });

  it('aucun moyen de passer un ordre : ni route d\'ordre, ni autre méthode que GET dans le code de Feu', () => {
    const code = readFileSync(new URL('./feu.mjs', import.meta.url), 'utf8');
    expect(code).not.toMatch(/\/api\/v3\/order|\/sapi\/v1\/margin|\/fapi\/|withdraw\/apply|method:\s*'(POST|PUT|DELETE)'/);
    expect(LECTURES.every(r => !/order(?!s)|\/order\b/i.test(r.replace('openOrders', '')))).toBe(true);
  });
});
