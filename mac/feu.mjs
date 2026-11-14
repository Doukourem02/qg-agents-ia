// Feu, le copilote de trading (côté Mac) : lit le compte Binance du patron en LECTURE SEULE et envoie au QG seulement
// les montants et les ordres (POST /api/agents/feu/compte), jamais la clé.
//  - la clé et son secret sont rangés dans le Trousseau macOS (services « qg-binance-lecture » et « qg-binance-secret ») ;
//    absents → rien n'est lu, le QG dit « clé pas encore créée » ;
//  - avant toute lecture, les droits de la clé sont vérifiés (GET /sapi/v1/account/apiRestrictions) : un seul droit
//    d'écriture (trading Spot ou marge, retraits, marge, Futures, transferts, options…) et Feu REFUSE de s'en servir ;
//  - seulement des GET signés vers une liste fermée de routes de lecture : aucun moyen de passer un ordre.
// Tout ce qui touche au système (réseau, Trousseau, horloge) est injecté : rien n'est testé sur le vrai compte.
import { createHmac } from 'node:crypto';

export const BINANCE = 'https://api.binance.com';
/** Les seules routes que Feu appelle sur le compte : toutes en lecture (GET), aucune route d'ordre. */
export const LECTURES = Object.freeze([
  '/sapi/v1/account/apiRestrictions',
  '/api/v3/account',
  '/sapi/v1/simple-earn/flexible/position',
  '/api/v3/openOrders',
  '/api/v3/myTrades',
]);
export const PAIRES = Object.freeze(['BTCUSDT', 'ETHUSDT']);
/** Les actifs gardés (le reste du portefeuille ne regarde pas Feu). */
const ACTIFS = new Set(['USDT', 'BTC', 'ETH', 'BNB']);
const DELAI_MS = 15_000;
/** Clé absente : on le redit au QG une fois par heure au plus. */
const RAPPEL_ABSENTE_MS = 60 * 60_000;

/** La signature HMAC SHA-256 d'une requête signée Binance (hexadécimal). */
export const signer = (requete, secret) => createHmac('sha256', secret).update(requete).digest('hex');

/**
 * Les droits en trop d'une clé : tout « enable… » ou « permits… » vrai, sauf la lecture. Une forme inattendue compte
 * comme un droit en trop (dans le doute, Feu ne s'en sert pas).
 */
export function droitsEnTrop(r) {
  if (!r || typeof r !== 'object' || r.enableReading !== true) return ['lectureNonConfirmee'];
  return Object.entries(r).filter(([k, v]) => /^(enable|permits)/.test(k) && k !== 'enableReading' && v !== false).map(([k]) => k);
}

class ErreurBinance extends Error {}

/** Une lecture signée : GET seulement, route de la liste seulement. La clé va dans l'en-tête, jamais dans un journal. */
export async function lireSigne({ fetch, cle, secret, now }, route, params = {}) {
  if (!LECTURES.includes(route)) throw new Error(`route refusée : ${route}`);
  const requete = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(now) }).toString();
  const url = `${BINANCE}${route}?${requete}&signature=${signer(requete, secret)}`;
  let r;
  try {
    r = await fetch(url, { method: 'GET', headers: { 'X-MBX-APIKEY': cle }, signal: AbortSignal.timeout(DELAI_MS) });
  } catch { throw new ErreurBinance('Binance injoignable'); }
  if (!r.ok) throw new ErreurBinance(`Binance a répondu ${r.status}`);
  return r.json();
}

const n = v => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };

/** Le compte en lecture seule (les droits déjà vérifiés). Seulement des nombres et des ordres. */
export async function lireCompte(acces) {
  const [compte, earn, ...parPaire] = await Promise.all([
    lireSigne(acces, '/api/v3/account', { omitZeroBalances: 'true' }),
    lireSigne(acces, '/sapi/v1/simple-earn/flexible/position', { size: '100' }),
    ...PAIRES.flatMap(symbol => [lireSigne(acces, '/api/v3/openOrders', { symbol }), lireSigne(acces, '/api/v3/myTrades', { symbol, limit: '500' })]),
  ]);
  const spot = {};
  for (const b of compte?.balances ?? []) {
    if (!ACTIFS.has(b.asset)) continue;
    const libre = n(b.free), bloque = n(b.locked);
    if (libre > 0 || bloque > 0) spot[b.asset] = { libre, bloque };
  }
  const earnOut = {};
  for (const p of earn?.rows ?? []) if (ACTIFS.has(p.asset) && n(p.totalAmount) > 0) earnOut[p.asset] = (earnOut[p.asset] ?? 0) + n(p.totalAmount);
  const ouverts = [], executes = [];
  PAIRES.forEach((paire, i) => {
    for (const o of parPaire[2 * i] ?? []) {
      ouverts.push({
        paire, id: n(o.orderId), cote: o.side === 'SELL' ? 'SELL' : 'BUY', type: String(o.type ?? '').replace(/[^A-Z_]/g, '') || 'INCONNU',
        prix: n(o.price), declenchement: n(o.stopPrice), quantite: n(o.origQty), executee: n(o.executedQty), quand: n(o.time),
        liste: Number.isInteger(o.orderListId) ? o.orderListId : -1,
      });
    }
    for (const t of parPaire[2 * i + 1] ?? []) {
      executes.push({
        paire, id: n(t.id), ordre: n(t.orderId), cote: t.isBuyer ? 'BUY' : 'SELL', prix: n(t.price), quantite: n(t.qty),
        montant: n(t.quoteQty), frais: n(t.commission), fraisActif: String(t.commissionAsset ?? 'USDT').replace(/[^A-Z0-9]/g, '') || 'USDT', quand: n(t.time),
      });
    }
  });
  return { spot, earn: earnOut, ouverts: ouverts.slice(0, 50), executes: executes.sort((a, b) => a.quand - b.quand).slice(-500) };
}

/**
 * Un passage de Feu (toutes les 5 minutes, avec le relais) : la clé du Trousseau, ses droits, puis le compte, envoyé au
 * QG. Rend ce qu'il faut garder dans l'état du relais (`feuAbsente` : dernier « clé absente » envoyé).
 */
export async function passageFeu({ now, etat = {}, lireCle, fetch, appeler, journal = () => {} }) {
  let acces;
  try { acces = await lireCle(); } catch { acces = null; }
  if (!acces?.cle || !acces?.secret) {
    if (typeof etat.feuAbsente === 'number' && now - etat.feuAbsente < RAPPEL_ABSENTE_MS) return {};
    try { await appeler('compte', { quand: now, cle: 'absente' }); } catch (e) { journal(`feu : envoi en échec (${e.message})`); return {}; }
    journal('feu : clé Binance pas encore créée');
    return { feuAbsente: now };
  }
  const a = { fetch, cle: acces.cle, secret: acces.secret, now };
  let corps;
  try {
    const trop = droitsEnTrop(await lireSigne(a, '/sapi/v1/account/apiRestrictions'));
    if (trop.length) {
      // la clé peut écrire : Feu refuse de s'en servir et ne lit rien d'autre
      corps = { quand: now, cle: 'droits', droits: trop };
      journal(`feu : la clé a des droits en trop (${trop.join(', ')}), lecture refusée`);
    } else corps = { quand: now, cle: 'ok', ...(await lireCompte(a)) };
  } catch (e) {
    corps = { quand: now, cle: 'erreur', raison: e instanceof ErreurBinance ? e.message : 'lecture impossible' };
    journal(`feu : ${corps.raison}`);
  }
  try { await appeler('compte', corps); } catch (e) { journal(`feu : envoi en échec (${e.message})`); return {}; }
  if (corps.cle === 'ok') journal(`feu : compte envoyé (${corps.executes.length} exécution(s), ${corps.ouverts.length} ordre(s) ouvert(s))`);
  return { feuAbsente: undefined };
}
