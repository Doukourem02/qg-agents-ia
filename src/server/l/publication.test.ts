import { describe, it, expect } from 'vitest';
import { memoire, type KV } from '../memoire';
import { commentaireLinkedIn, ErreurPublication, RefusLinkedIn } from '../linkedin/api';
import { enregistrerConnexion, statutLinkedIn } from '../linkedin/connexion';
import { lireMemoire } from './memoire';
import { CLE_POSTS, marquerPublie, type Post } from './posts';
import { ECHEC_ENREGISTREMENT, publierPost, type DepsPublication } from './publication';
import type { Visuel } from './visuels';

const carte: Visuel = { modele: 'carte', rubrique: 'IA', surtitre: 's', lignes: ['Une ligne'], accent: 'Un accent', pied: ['a', 'b'] };
const carrousel: Visuel = {
  modele: 'carrousel', rubrique: 'c', titre: ['Titre'], accent: 'accent', etiquettes: [],
  pages: [{ titre: 'Un', texte: 'un' }, { titre: 'Deux', texte: 'deux' }], pied: ['a', 'b'],
};
const PNG = new Uint8Array([1]), PDF = new Uint8Array([2]);

const unPost = (o: Partial<Post> = {}): Post => ({
  id: 'p1', sujet: 'Mon sujet', texte: 'Le texte (avec #balise).', hashtags: ['#IA', '#NextJS', '#Dev'], statut: 'pret', quand: 1, ...o,
});
const poser = (kv: KV, p: Post) => kv.hset(CLE_POSTS, p.id, JSON.stringify(p));
const lire = async (kv: KV, id = 'p1') => JSON.parse((await kv.hgetall(CLE_POSTS))[id]) as Post;

type Faux = { connecte?: boolean; televerserLeve?: boolean | Error; creerLeve?: Error; lent?: boolean; pendant?: () => Promise<void> };
function banc(o: Faux = {}) {
  const journal: string[] = [];
  const televerses: { genre: string; contenu: Uint8Array }[] = [];
  const posts: { auteur: string; commentaire: string; media?: { id: string; titre?: string } }[] = [];
  const etat = { creerLeve: o.creerLeve };
  const deps: DepsPublication = {
    connexion: async () => { journal.push('connexion'); return o.connecte === false ? null : { jeton: 'J', auteur: 'urn:li:person:x', nom: 'M', expire: Date.now() + 1e9 }; },
    rendre: async v => { journal.push('rendre'); return { png: PNG, ...(v.modele === 'carrousel' ? { pdf: PDF } : {}) }; },
    televerser: async (_j, _a, genre, contenu) => {
      journal.push('televerser:' + genre);
      if (o.televerserLeve) throw o.televerserLeve instanceof Error ? o.televerserLeve : new Error('LinkedIn a refusé');
      televerses.push({ genre, contenu });
      return genre === 'image' ? 'urn:li:image:I1' : 'urn:li:document:D1';
    },
    creerPost: async (_j, p) => {
      journal.push('creerPost');
      if (o.lent) await new Promise(r => setTimeout(r, 10));
      if (o.pendant) await o.pendant();
      if (etat.creerLeve) throw etat.creerLeve;
      posts.push(p);
      return 'urn:li:share:42';
    },
  };
  return { kv: memoire(), journal, televerses, posts, deps, etat };
}

describe('publierPost', () => {
  it('carte : rend, téléverse l’image, publie, note le post', async () => {
    const b = banc(); await poser(b.kv, unPost({ visuel: carte }));
    const r = await publierPost(b.kv, 'p1', b.deps, false, 1000);
    expect(r).toEqual({ etat: 'publie', url: 'https://www.linkedin.com/feed/update/urn:li:share:42/' });
    expect(b.televerses).toEqual([{ genre: 'image', contenu: PNG }]);
    expect(b.posts).toEqual([{ auteur: 'urn:li:person:x', commentaire: commentaireLinkedIn(unPost().texte, unPost().hashtags), media: { id: 'urn:li:image:I1' } }]);
    const p = await lire(b.kv);
    expect(p.statut).toBe('publie');
    expect(p.linkedin).toEqual({ urn: 'urn:li:share:42', url: r.etat === 'publie' ? r.url : '', quand: 1000 });
    expect((await lireMemoire(b.kv)).publies).toEqual([{ id: 'p1', sujet: 'Mon sujet', quand: 1000 }]);
  });
  it('carrousel : le PDF part en document, titré du sujet', async () => {
    const b = banc(); await poser(b.kv, unPost({ visuel: carrousel }));
    expect((await publierPost(b.kv, 'p1', b.deps)).etat).toBe('publie');
    expect(b.televerses).toEqual([{ genre: 'document', contenu: PDF }]);
    expect(b.posts[0].media).toEqual({ id: 'urn:li:document:D1', titre: 'Mon sujet' });
  });
  it('sans visuel : pas de média', async () => {
    const b = banc(); await poser(b.kv, unPost());
    await publierPost(b.kv, 'p1', b.deps);
    expect(b.journal).toEqual(['connexion', 'creerPost']);
    expect(b.posts[0].media).toBeUndefined();
  });
  it('second appel : « deja », sans nouvel envoi', async () => {
    const b = banc(); await poser(b.kv, unPost());
    const r1 = await publierPost(b.kv, 'p1', b.deps);
    const r2 = await publierPost(b.kv, 'p1', b.deps);
    expect(r2).toEqual({ etat: 'deja', url: r1.etat === 'publie' ? r1.url : '' });
    expect(b.posts).toHaveLength(1);
  });
  it('deux clics en même temps : un seul post', async () => {
    const b = banc({ lent: true }); await poser(b.kv, unPost());
    const rs = await Promise.all([publierPost(b.kv, 'p1', b.deps), publierPost(b.kv, 'p1', b.deps)]);
    expect(b.journal.filter(j => j === 'creerPost')).toHaveLength(1);
    expect(rs.map(r => r.etat).sort()).toEqual(expect.arrayContaining(['publie']));
    expect(['en-cours', 'deja']).toContain(rs.find(r => r.etat !== 'publie')?.etat);
  });
  it('non connecté : rien n’est rendu ni envoyé', async () => {
    const b = banc({ connecte: false }); await poser(b.kv, unPost({ visuel: carte }));
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'non-connecte' });
    expect(b.journal).toEqual(['connexion']);
  });
  it('post pas prêt, ou inconnu', async () => {
    const b = banc(); await poser(b.kv, unPost({ statut: 'en accord' }));
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'pas-pret', statut: 'en accord' });
    expect(await publierPost(b.kv, 'zz', b.deps)).toEqual({ etat: 'inconnu' });
    expect(b.journal).toEqual([]);
  });
  it('le téléversement échoue : echec, pas de post, verrou libéré', async () => {
    const b = banc({ televerserLeve: true }); await poser(b.kv, unPost({ visuel: carte }));
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'echec', raison: "le visuel n'a pas pu partir" });
    expect(b.journal).not.toContain('creerPost');
    const p = await lire(b.kv);
    expect(p.statut).toBe('pret');
    expect(p.linkedin).toBeUndefined();
    // nouvel essai tout de suite : le verrou n'est plus là
    b.journal.length = 0;
    expect((await publierPost(b.kv, 'p1', b.deps)).etat).toBe('echec');
    expect(b.journal).toContain('televerser:image');
  });
  it('le rendu lève : echec, sans exception', async () => {
    const b = banc(); await poser(b.kv, unPost({ visuel: carte }));
    const deps = { ...b.deps, rendre: async () => { throw new Error('rendu cassé'); } };
    expect(await publierPost(b.kv, 'p1', deps)).toEqual({ etat: 'echec', raison: "le visuel n'a pas pu partir" });
  });
  it('LinkedIn refuse sûrement : echec, pas de tentative restante', async () => {
    const b = banc({ creerLeve: new ErreurPublication('LinkedIn a refusé le post (422)', false) }); await poser(b.kv, unPost());
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'echec', raison: 'LinkedIn a refusé le post' });
    const p = await lire(b.kv);
    expect(p.statut).toBe('pret');
    expect(p.linkedin?.tentative).toBeUndefined();
  });
  it('envoi incertain : tentative gardée, pas de relance sans forcer, « Republier » publie', async () => {
    const b = banc({ creerLeve: new ErreurPublication('LinkedIn injoignable', true) }); await poser(b.kv, unPost());
    expect(await publierPost(b.kv, 'p1', b.deps, false, 500)).toEqual({ etat: 'incertain' });
    expect((await lire(b.kv)).linkedin?.tentative).toBe(500);
    b.journal.length = 0; b.etat.creerLeve = undefined;
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'incertain' });
    expect(b.journal).toEqual([]);
    expect((await publierPost(b.kv, 'p1', b.deps, true)).etat).toBe('publie');
    expect(b.posts).toHaveLength(1);
    expect((await lire(b.kv)).linkedin?.tentative).toBeUndefined();
  });
  it('une erreur imprévue de creerPost compte comme incertaine', async () => {
    const b = banc({ creerLeve: new Error('boum') }); await poser(b.kv, unPost());
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'incertain' });
  });
  it('commentaire trop long pour LinkedIn : echec sans appel', async () => {
    const b = banc(); await poser(b.kv, unPost({ texte: '#'.repeat(1600), visuel: carte }));
    expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'echec', raison: 'texte trop long pour LinkedIn' });
    expect(b.journal).toEqual(['connexion']);
  });

  describe('le stockage en panne : jamais d’exception, rien ne part', () => {
    const panne = (kv: KV, op: 'hgetall' | 'setnx' | 'hset'): KV => ({ ...kv, [op]: async () => { throw new Error('Upstash'); } });
    it.each(['hgetall', 'setnx'] as const)('%s lève : echec', async op => {
      const b = banc(); await poser(b.kv, unPost());
      expect(await publierPost(panne(b.kv, op), 'p1', b.deps)).toEqual(ECHEC_ENREGISTREMENT);
      expect(b.journal).toEqual([]);
    });
    it('l’écriture de la tentative lève : echec, pas de post, verrou libéré', async () => {
      const b = banc(); await poser(b.kv, unPost());
      expect(await publierPost(panne(b.kv, 'hset'), 'p1', b.deps)).toEqual(ECHEC_ENREGISTREMENT);
      expect(b.journal).not.toContain('creerPost');
      expect((await publierPost(b.kv, 'p1', b.deps)).etat).toBe('publie');
    });
    it('la connexion lève : echec, verrou libéré', async () => {
      const b = banc(); await poser(b.kv, unPost());
      const deps = { ...b.deps, connexion: async () => { throw new Error('Upstash'); } };
      expect(await publierPost(b.kv, 'p1', deps)).toEqual(ECHEC_ENREGISTREMENT);
      expect((await publierPost(b.kv, 'p1', b.deps)).etat).toBe('publie');
    });
  });

  describe('jeton révoqué (401/403)', () => {
    const connecter = (kv: KV) => enregistrerConnexion(kv, { jeton: 'J', expireDans: 30 * 86400, auteur: 'urn:li:person:x', nom: 'M' }, 's');
    it('au téléversement : non-connecte, la connexion est oubliée', async () => {
      const b = banc({ televerserLeve: new RefusLinkedIn('LinkedIn a refusé la préparation du image (401)', true) });
      await poser(b.kv, unPost({ visuel: carte })); await connecter(b.kv);
      expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'non-connecte' });
      expect(await statutLinkedIn(b.kv)).toEqual({ connecte: false });
      expect(b.journal).not.toContain('creerPost');
    });
    it('à la création du post : non-connecte, tentative retirée, connexion oubliée', async () => {
      const b = banc({ creerLeve: new ErreurPublication('LinkedIn a refusé le post (403)', false, true) });
      await poser(b.kv, unPost()); await connecter(b.kv);
      expect(await publierPost(b.kv, 'p1', b.deps)).toEqual({ etat: 'non-connecte' });
      const p = await lire(b.kv);
      expect(p.statut).toBe('pret');
      expect(p.linkedin).toBeUndefined();
      expect((await statutLinkedIn(b.kv)).connecte).toBe(false);
    });
  });

  describe('le post relu après LinkedIn', () => {
    it('refus net pendant qu’un « Déjà publié » a été touché : le post reste publié', async () => {
      const kvRef: { kv?: KV } = {};
      const b = banc({ creerLeve: new ErreurPublication('LinkedIn a refusé le post (422)', false), pendant: () => marquerPublie(kvRef.kv!, 'p1').then(() => {}) });
      kvRef.kv = b.kv; await poser(b.kv, unPost());
      expect((await publierPost(b.kv, 'p1', b.deps)).etat).toBe('echec');
      const p = await lire(b.kv);
      expect(p.statut).toBe('publie');
      expect(p.linkedin?.tentative).toBeUndefined();
    });
    it('succès après un « Déjà publié » : publié avec l’URN, noté une seule fois', async () => {
      const kvRef: { kv?: KV } = {};
      const b = banc({ pendant: () => marquerPublie(kvRef.kv!, 'p1', 7).then(() => {}) });
      kvRef.kv = b.kv; await poser(b.kv, unPost());
      expect((await publierPost(b.kv, 'p1', b.deps, false, 9)).etat).toBe('publie');
      const p = await lire(b.kv);
      expect(p).toMatchObject({ statut: 'publie', linkedin: { urn: 'urn:li:share:42', quand: 9 } });
      expect((await lireMemoire(b.kv)).publies.map(x => x.id)).toEqual(['p1']);
    });
  });
});
