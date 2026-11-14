import 'server-only';
import { Redis } from '@upstash/redis';
import { memoire } from './memoire';
import { Refus } from './qg';

// Le stockage du QG : Upstash Redis en ligne ; une mémoire de secours locale tant qu'Upstash n'est pas branché
// (développement, tests). Seulement les quelques opérations dont le QG a besoin.

export type { KV } from './memoire';
import type { KV } from './memoire';

const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Réponse HGETALL → objet, qu'elle arrive en liste à plat (mode brut) ou déjà en objet. */
export function enObjet(brut: unknown): Record<string, string> {
  if (Array.isArray(brut)) {
    const o: Record<string, string> = {};
    for (let i = 0; i + 1 < brut.length; i += 2) o[String(brut[i])] = str(brut[i + 1]);
    return o;
  }
  if (brut && typeof brut === 'object') return Object.fromEntries(Object.entries(brut).map(([f, v]) => [f, str(v)]));
  return {};
}

/** Réponse HMGET → objet des seuls champs présents : liste dans l'ordre des champs (mode brut), objet, ou null. */
export function parChamps(champs: string[], brut: unknown): Record<string, string> {
  const o: Record<string, string> = {};
  if (Array.isArray(brut)) champs.forEach((f, i) => { if (brut[i] != null) o[f] = str(brut[i]); });
  else if (brut && typeof brut === 'object') {
    for (const [f, v] of Object.entries(brut)) if (v != null) o[f] = str(v);
  }
  return o;
}

function upstash(url: string, token: string): KV {
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    async hset(k, f, v) { await r.hset(k, { [f]: v }); },
    async hgetall(k) {
      // en mode brut, Upstash renvoie une liste à plat [champ, valeur, champ, valeur…], pas un objet
      return enObjet((await r.hgetall(k)) as unknown);
    },
    async hmget(k, fs) { return fs.length ? parChamps(fs, (await r.hmget(k, ...fs)) as unknown) : {}; },
    async hdel(k, f) { await r.hdel(k, f); },
    async hincrby(k, f, n) { return Number(await r.hincrby(k, f, n)); },
    async lpush(k, v) { await r.lpush(k, v); },
    async lrange(k, a, b) { return (await r.lrange<unknown>(k, a, b)).map(str); },
    async ltrim(k, a, b) { await r.ltrim(k, a, b); },
    async rpop(k) { const v = await r.rpop<unknown>(k); return v == null ? null : str(v); },
    async setnx(k, v, s) { return (await r.set(k, v, { nx: true, ex: s })) === 'OK'; },
    async get(k) { const v = await r.get<unknown>(k); return v == null ? null : str(v); },
    async del(k) { await r.del(k); },
  };
}

let instance: { kv: KV; source: 'upstash' | 'memoire' } | null = null;

/** Upstash si ses variables existent (posées par Vercel quand la base est reliée au projet), sinon la mémoire locale. */
export function getKV() {
  if (!instance) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) instance = { kv: upstash(url, token), source: 'upstash' };
    // sur Vercel, la mémoire locale s'efface entre deux requêtes : sans Upstash, on refuse plutôt que de perdre des missions
    else if (process.env.VERCEL) throw new Refus('stockage Upstash non branché', 503);
    else instance = { kv: memoire(), source: 'memoire' };
  }
  return instance;
}
