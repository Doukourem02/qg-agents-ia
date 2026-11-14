import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';

const kv = memoire();
const connection = vi.fn(async () => undefined);
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { GET } = await import('./route');

describe('GET /api/qg/vues', () => {
  it('attend connection(), répond sans cache avec les trois vues, l’état des agents et l’heure de lecture', async () => {
    const r = await GET();
    expect(connection).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(await r.json()).sort()).toEqual(['agents', 'astreinte', 'calendrier', 'cerveau', 'crise', 'luffyVeille', 'maintenant', 'planningAstreinte', 'presences', 'silence', 'taches']);
  });
});
