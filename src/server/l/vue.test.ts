import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { enregistrerConnexion } from '../linkedin/connexion';
import { CLE_POSTS, CLE_PROPOSITIONS, type Post } from './posts';
import { deposerStats } from './stats';
import { vueL } from './vue';

const T0 = 1_800_000_000_000;

describe('vueL', () => {
  it('sans rien', async () => {
    expect(await vueL(memoire(), T0)).toEqual({ linkedin: { connecte: false }, proposition: null, posts: [], bilan: null, statsEnAttente: 0 });
  });

  it('proposition, posts visibles, dépôt en attente, jamais de jeton', async () => {
    const kv = memoire();
    const sujet = { titre: 'T', angle: 'A', accroche: 'x', pourquoiMoi: 'y', format: 'texte' };
    await kv.hset(CLE_PROPOSITIONS, 'p1', JSON.stringify({ id: 'p1', semaine: '2027-W01', sujets: [sujet, sujet, sujet], quand: T0 }));
    const base = { texte: 'corps', hashtags: ['#a'], quand: T0 };
    const publie: Post = { ...base, id: 'a', sujet: 'S1', statut: 'publie', propositionId: 'p1', index: 1,
      linkedin: { url: 'https://linkedin.com/x' }, visuel: { modele: 'carte' } as never };
    const abandonne: Post = { ...base, id: 'b', sujet: 'S2', statut: 'abandonne' };
    await kv.hset(CLE_POSTS, 'a', JSON.stringify(publie));
    await kv.hset(CLE_POSTS, 'b', JSON.stringify(abandonne));
    await deposerStats(kv, 'stats.csv', [{ nom: 'f', lignes: [['1']] }], T0);
    await enregistrerConnexion(kv, { jeton: 'JETON-SECRET-123', expireDans: 3600 * 24 * 60, auteur: 'urn:li:person:abc', nom: 'Moi' }, 's1', T0);
    const v = await vueL(kv, T0);
    expect(v.proposition).toMatchObject({ id: 'p1', rediges: [1] });
    expect(v.posts).toHaveLength(1);
    expect(v.posts[0]).toMatchObject({ id: 'a', url: 'https://linkedin.com/x', aVisuel: true });
    expect(v.statsEnAttente).toBe(1);
    expect(v.linkedin).toMatchObject({ connecte: true, nom: 'Moi' });
    expect(JSON.stringify(v)).not.toContain('JETON-SECRET-123');
  });
});

describe('ids qui ressemblent à des propriétés', () => {
  it('« constructor » est un post inconnu, pas une erreur', async () => {
    const { lirePost } = await import('./posts');
    const { memoire } = await import('../memoire');
    expect(await lirePost(memoire(), 'constructor')).toBeNull();
    expect(await lirePost(memoire(), '__proto__')).toBeNull();
  });
});
