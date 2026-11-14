import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { enObjet } = await import('./kv');

describe('lecture Upstash (HGETALL)', () => {
  it('comprend la liste à plat du mode brut', () => {
    expect(enObjet(['L', '{"tache":"a"}', 'mafe', '{"tache":"b"}'])).toEqual({ L: '{"tache":"a"}', mafe: '{"tache":"b"}' });
  });
  it('comprend aussi un objet, et une réponse vide', () => {
    expect(enObjet({ L: { tache: 'a' } })).toEqual({ L: '{"tache":"a"}' });
    expect(enObjet(null)).toEqual({});
    expect(enObjet([])).toEqual({});
  });
});

describe('la mémoire locale : get', () => {
  it('relit la valeur d’un setnx, null sinon', async () => {
    const { memoire } = await import('./memoire');
    const kv = memoire();
    expect(await kv.get('s')).toBeNull();
    await kv.setnx('s', '42', 60);
    expect(await kv.get('s')).toBe('42');
    await kv.del('s');
    expect(await kv.get('s')).toBeNull();
  });
});

describe('la mémoire locale : del', () => {
  it('efface un hash, une liste et un setnx', async () => {
    const { memoire } = await import('./memoire');
    const kv = memoire();
    await kv.hset('h', 'a', '1');
    await kv.lpush('l', 'x');
    expect(await kv.setnx('s', 'v', 60)).toBe(true);
    expect(await kv.setnx('s', 'v', 60)).toBe(false);
    await kv.del('h'); await kv.del('l'); await kv.del('s');
    expect(await kv.hgetall('h')).toEqual({});
    expect(await kv.lrange('l', 0, -1)).toEqual([]);
    expect(await kv.setnx('s', 'v', 60)).toBe(true);
  });
});

describe('hmget', () => {
  it('mémoire locale : seulement les champs demandés et présents', async () => {
    const { memoire } = await import('./memoire');
    const kv = memoire();
    await kv.hset('h', 'a', '1'); await kv.hset('h', 'b', '2'); await kv.hset('h', 'c', '3');
    expect(await kv.hmget('h', ['a', 'c', 'z'])).toEqual({ a: '1', c: '3' });
    expect(await kv.hmget('vide', ['a'])).toEqual({});
    expect(await kv.hmget('h', [])).toEqual({});
  });

  it('réponse Upstash HMGET → objet (liste dans l\'ordre des champs, objet, ou null)', async () => {
    const { parChamps } = await import('./kv');
    expect(parChamps(['a', 'b', 'c'], ['1', null, '{"x":1}'])).toEqual({ a: '1', c: '{"x":1}' });
    expect(parChamps(['a', 'b'], { a: { x: 1 }, b: null })).toEqual({ a: '{"x":1}' });
    expect(parChamps(['a'], null)).toEqual({});
  });
});
