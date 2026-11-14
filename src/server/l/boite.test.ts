import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { deposer, aTraiter, marquerTraite } from './boite';

describe('la boîte de L', () => {
  it('ne dépose pas deux fois le même id', async () => {
    const kv = memoire();
    const e = { id: 'm1', type: 'note' as const, contenu: 'idée' };
    expect([await deposer(kv, e), await deposer(kv, e)]).toEqual([true, false]);
    expect(await aTraiter(kv)).toHaveLength(1);
  });
  it('marquerTraite retire l’élément de la liste à traiter', async () => {
    const kv = memoire();
    await deposer(kv, { id: 'm1', type: 'lien', contenu: 'https://a.fr' });
    await marquerTraite(kv, 'm1', 'lu');
    expect(await aTraiter(kv)).toEqual([]);
  });
  it('liste les plus anciens d’abord', async () => {
    const kv = memoire();
    await deposer(kv, { id: 'b', type: 'note', contenu: 'second' }, 2000);
    await deposer(kv, { id: 'a', type: 'note', contenu: 'premier' }, 1000);
    expect((await aTraiter(kv)).map(e => e.id)).toEqual(['a', 'b']);
  });
});
