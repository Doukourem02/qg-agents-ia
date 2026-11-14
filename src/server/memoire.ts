// La mémoire de secours locale (développement, tests) et l'interface commune avec Upstash.

export interface KV {
  hset(key: string, field: string, value: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  /** Seulement les champs demandés qui existent (les absents ne figurent pas dans l'objet). */
  hmget(key: string, fields: string[]): Promise<Record<string, string>>;
  /** Retire un champ d'une table (rien si absent). */
  hdel(key: string, field: string): Promise<void>;
  /** Ajoute `n` (entier) au champ d'une table, atomiquement ; renvoie la nouvelle valeur (champ absent = 0). */
  hincrby(key: string, field: string, n: number): Promise<number>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  rpop(key: string): Promise<string | null>;
  /** Pose la clé seulement si elle n'existe pas ; renvoie false si elle existait déjà. */
  setnx(key: string, value: string, secondes: number): Promise<boolean>;
  /** La valeur posée par `setnx`, ou null si la clé n'existe pas (ou a expiré). */
  get(key: string): Promise<string | null>;
  /** Efface la clé, quel que soit son type. */
  del(key: string): Promise<void>;
}

export function memoire(): KV {
  const h = new Map<string, Map<string, string>>(), l = new Map<string, string[]>(), s = new Map<string, { v: string; exp: number }>();
  const liste = (k: string) => { let x = l.get(k); if (!x) { x = []; l.set(k, x); } return x; };
  const fin = (x: string[], i: number) => (i < 0 ? x.length + i : i);
  return {
    async hset(k, f, v) { let m = h.get(k); if (!m) { m = new Map(); h.set(k, m); } m.set(f, v); },
    async hgetall(k) { return Object.fromEntries(h.get(k) ?? []); },
    async hmget(k, fs) {
      const m = h.get(k), o: Record<string, string> = {};
      for (const f of fs) { const v = m?.get(f); if (v !== undefined) o[f] = v; }
      return o;
    },
    async hdel(k, f) { h.get(k)?.delete(f); },
    async hincrby(k, f, n) {
      let m = h.get(k); if (!m) { m = new Map(); h.set(k, m); }
      const v = (Number(m.get(f)) || 0) + n; m.set(f, String(v)); return v;
    },
    async lpush(k, v) { liste(k).unshift(v); },
    async lrange(k, a, b) { const x = liste(k); return x.slice(a, fin(x, b) + 1); },
    async ltrim(k, a, b) { const x = liste(k); l.set(k, x.slice(a, fin(x, b) + 1)); },
    async rpop(k) { return liste(k).pop() ?? null; },
    async setnx(k, v, sec) {
      const x = s.get(k);
      if (x && x.exp > Date.now()) return false;
      s.set(k, { v, exp: Date.now() + sec * 1000 });
      return true;
    },
    async get(k) { const x = s.get(k); return x && x.exp > Date.now() ? x.v : null; },
    async del(k) { h.delete(k); l.delete(k); s.delete(k); },
  };
}

