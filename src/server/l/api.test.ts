import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { CLES, Refus } from '../qg';
import { CLES_ACCORDS, idsEnAttente, lireAccord } from '../accords';
import { deposer } from './boite';
import { CLE_BILANS, dernierBilan } from './bilan';
import { deposerStats, statsATraiter } from './stats';
import { CLE_POSTS, type Sujet } from './posts';
import { traiterAction, type Deps } from './api';
import type { Visuel } from './visuels';

const sujet = (t: string): Sujet => ({ titre: t, angle: 'angle ' + t, accroche: 'a', pourquoiMoi: 'p', format: 'texte' });
const outils = (echec = false) => {
  const envoyes: { texte: string; boutons?: { texte: string; donnee: string }[] }[] = [];
  return {
    envoyes,
    deps: {
      envoyer: async (texte: string, boutons?: { texte: string; donnee: string }[]) => {
        if (echec) throw new Error('Telegram en panne');
        envoyes.push({ texte, boutons });
      },
    },
  };
};
/** Des faux qui notent l'ordre des appels : rendu, image, fichier, texte. */
const banc = (o: { rendreEchoue?: boolean; imageEchoue?: boolean } = {}) => {
  const journal: string[] = [];
  const envoyes: { texte: string; boutons?: { texte: string; donnee: string }[] }[] = [];
  const images: { legende?: string }[] = [];
  const fichiers: { nom: string; legende?: string }[] = [];
  const deps: Deps = {
    envoyer: async (texte, boutons) => { journal.push('texte'); envoyes.push({ texte, boutons }); },
    rendre: async v => {
      journal.push('rendre');
      if (o.rendreEchoue) throw new Error('rendu cassé');
      return { png: new Uint8Array([1, 2, 3]), ...(v.modele === 'carrousel' ? { pdf: new Uint8Array([4]) } : {}) };
    },
    envoyerImage: async (_png, legende) => {
      journal.push('image');
      if (o.imageEchoue) throw new Error('sendPhoto refusé');
      images.push({ legende });
    },
    envoyerFichier: async (_c, nom, legende) => { journal.push('fichier'); fichiers.push({ nom, legende }); },
  };
  return { journal, envoyes, images, fichiers, deps };
};
const carte: Visuel = {
  modele: 'carte', rubrique: 'IA', surtitre: ">_ ce que j'ai appris", lignes: ['Mes agents IA', 'proposent.'],
  accent: 'Moi, je décide.', pied: ['qg · agents IA', 'lire la suite ↓'],
};
const carrousel: Visuel = {
  modele: 'carrousel', rubrique: 'carrousel', titre: ['5 leçons'], accent: 'avec mes agents', etiquettes: [],
  pages: [{ titre: 'Un', texte: 'texte un' }, { titre: 'Deux', texte: 'texte deux' }], pied: ['a', 'b'],
};
const statuts = async (kv: ReturnType<typeof memoire>) => Object.values(await kv.hgetall(CLE_POSTS)).map(v => JSON.parse(v).statut);
const etatL = async (kv: ReturnType<typeof memoire>) => JSON.parse((await kv.hgetall(CLES.etats)).L).tache as string;
type Ctx = {
  postsEnAccord: { id: string; sujet: string; texte: string; hashtags: string[]; accordId: string }[];
  propositionEnCours: { id: string; rediges: number[] } | null;
};
const bon = { sujet: 's', texte: 'Un texte', hashtags: ['#a', '#b', '#c'] };

describe('traiterAction', () => {
  it('propositions : 1 message, 3 boutons', async () => {
    const kv = memoire(); const o = outils();
    await traiterAction(kv, 'propositions', { sujets: [sujet('A'), sujet('B'), sujet('C')] }, o.deps);
    expect(o.envoyes).toHaveLength(1);
    expect(o.envoyes[0].boutons).toHaveLength(3);
    expect((o.envoyes[0].boutons as { donnee: string }[])[1].donnee).toMatch(/^sujet:.+:1$/);
  });
  it('brouillon nommant LIVREO : 422, rien envoyé', async () => {
    const kv = memoire(); const o = outils();
    await expect(traiterAction(kv, 'brouillon', { ...bon, texte: 'Chez LIVREO' }, o.deps)).rejects.toMatchObject({ code: 422 });
    expect(o.envoyes).toHaveLength(0);
  });
  it('brouillon valide : la demande montre le texte entier, les hashtags et les boutons ok/non', async () => {
    const kv = memoire(); const o = outils();
    const texte = 'Début du post. ' + 'x'.repeat(2900) + ' FIN DU POST';
    const r = (await traiterAction(kv, 'brouillon', { ...bon, sujet: 'y'.repeat(200), texte, hashtags: ['#NextJS', '#IA', '#DevWeb'] }, o.deps)) as { accordId: string };
    expect(o.envoyes).toHaveLength(1);
    const m = o.envoyes[0];
    expect(m.texte).toContain(texte);
    expect(m.texte).toContain('#NextJS #IA #DevWeb');
    expect(m.texte.indexOf('#NextJS')).toBeGreaterThan(m.texte.indexOf('FIN DU POST'));
    expect(m.texte).toContain('#' + r.accordId);
    expect(m.texte.length).toBeLessThan(4000);
    expect(m.boutons?.map(b => b.donnee)).toEqual([`ok:${r.accordId}`, `non:${r.accordId}`]);
  });
  it('brouillon : hashtag ou sujet démesuré refusé (400)', async () => {
    const kv = memoire(); const o = outils();
    await expect(traiterAction(kv, 'brouillon', { ...bon, hashtags: ['#a', '#b', '#' + 'c'.repeat(60)] }, o.deps)).rejects.toMatchObject({ code: 400 });
    await expect(traiterAction(kv, 'brouillon', { ...bon, sujet: 's'.repeat(201) }, o.deps)).rejects.toMatchObject({ code: 400 });
  });
  it('brouillon dont l’envoi échoue : demande annulée, post abandonné, erreur remontée', async () => {
    const kv = memoire(); const o = outils(true);
    await expect(traiterAction(kv, 'brouillon', bon, o.deps)).rejects.toThrow('Telegram en panne');
    expect(await idsEnAttente(kv)).toEqual([]);
    const posts = Object.values(await kv.hgetall(CLE_POSTS)).map(v => JSON.parse(v));
    expect(posts.map(p => p.statut)).toEqual(['abandonne']);
  });
  it('brouillon avec revisionDe : l’ancienne demande est fermée, seule la nouvelle attend', async () => {
    const kv = memoire(); const o = outils();
    const a = (await traiterAction(kv, 'brouillon', bon, o.deps)) as { post: { id: string }; accordId: string };
    const b = (await traiterAction(kv, 'brouillon', { ...bon, texte: 'Version 2', revisionDe: a.post.id }, o.deps)) as { accordId: string };
    expect((await lireAccord(kv, a.accordId))?.statut).toBe('annule');
    expect(await idsEnAttente(kv)).toEqual([b.accordId]);
    expect(JSON.parse((await kv.hgetall(CLE_POSTS))[a.post.id]).statut).toBe('abandonne');
  });
  it('brouillon : propositionId et index validés et gardés', async () => {
    const kv = memoire(); const o = outils();
    for (const index of [3, -1, 1.5, '1']) {
      await expect(traiterAction(kv, 'brouillon', { ...bon, propositionId: 'p1', index }, o.deps)).rejects.toMatchObject({ code: 400 });
    }
    await expect(traiterAction(kv, 'brouillon', { ...bon, index: 0 }, o.deps)).rejects.toMatchObject({ code: 400 });
    const r = (await traiterAction(kv, 'brouillon', { ...bon, propositionId: 'p1', index: 0 }, o.deps)) as { post: object };
    expect(r.post).toMatchObject({ propositionId: 'p1', index: 0 });
  });
  it('contexte : propositionEnCours.rediges compte les sujets rédigés non abandonnés', async () => {
    const kv = memoire(); const o = outils();
    const { proposition: p } = (await traiterAction(kv, 'propositions', { sujets: [sujet('A'), sujet('B'), sujet('C')] }, o.deps)) as { proposition: { id: string } };
    const lire = async () => ((await traiterAction(kv, 'contexte', {}, o.deps)) as Ctx).propositionEnCours?.rediges;
    expect(await lire()).toEqual([]);
    const a = (await traiterAction(kv, 'brouillon', { ...bon, propositionId: p.id, index: 1 }, o.deps)) as { post: { id: string } };
    expect(await lire()).toEqual([1]);
    // une révision garde le sujet (hérité de l'ancien post) et ne compte pas en double
    await traiterAction(kv, 'brouillon', { ...bon, texte: 'v2', revisionDe: a.post.id }, o.deps);
    expect(await lire()).toEqual([1]);
    await traiterAction(kv, 'brouillon', { ...bon, propositionId: p.id, index: 0 }, o.deps);
    expect(await lire()).toEqual([0, 1]);
  });
  it('contexte : un sujet refusé par ❌ reste compté comme rédigé', async () => {
    const kv = memoire(); const o = outils();
    const { proposition: p } = (await traiterAction(kv, 'propositions', { sujets: [sujet('A'), sujet('B'), sujet('C')] }, o.deps)) as { proposition: { id: string } };
    const r = (await traiterAction(kv, 'brouillon', { ...bon, propositionId: p.id, index: 0 }, o.deps)) as { post: { id: string }; accordId: string };
    const a = await lireAccord(kv, r.accordId);
    await kv.hset(CLES_ACCORDS.tous, r.accordId, JSON.stringify({ ...a, statut: 'refuse' }));
    const post = JSON.parse((await kv.hgetall(CLE_POSTS))[r.post.id]);
    await kv.hset(CLE_POSTS, r.post.id, JSON.stringify({ ...post, statut: 'abandonne' }));
    const ctx = (await traiterAction(kv, 'contexte', {}, o.deps)) as Ctx;
    expect(ctx.propositionEnCours?.rediges).toEqual([0]);
  });
  it('propositions : un sujet qui nomme un projet interdit est refusé (422), rien envoyé', async () => {
    const kv = memoire(); const o = outils();
    await expect(traiterAction(kv, 'propositions', { sujets: [sujet('A'), sujet('Mon app LIVREO'), sujet('C')] }, o.deps))
      .rejects.toMatchObject({ code: 422 });
    expect(o.envoyes).toHaveLength(0);
  });
  it('contexte : postsEnAccord montre le brouillon qui attend l’accord', async () => {
    const kv = memoire(); const o = outils();
    const r = (await traiterAction(kv, 'brouillon', bon, o.deps)) as { post: { id: string }; accordId: string };
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as Ctx;
    expect(c.postsEnAccord).toEqual([{ id: r.post.id, sujet: bon.sujet, texte: bon.texte, hashtags: bon.hashtags, accordId: r.accordId }]);
  });
  it('brouillon invalide : 400', async () => {
    const kv = memoire(); const o = outils();
    await expect(traiterAction(kv, 'brouillon', { sujet: 's', texte: '', hashtags: [] }, o.deps)).rejects.toMatchObject({ code: 400 });
    await expect(traiterAction(kv, 'brouillon', { ...bon, hashtags: 'x' }, o.deps)).rejects.toMatchObject({ code: 400 });
  });
  it('revisionDe abandonne l’ancien post sauf publié', async () => {
    const kv = memoire(); const o = outils();
    const anc = { id: 'old', sujet: 's', texte: 't', hashtags: [], statut: 'brouillon', quand: 1 };
    const pub = { ...anc, id: 'pub', statut: 'publie' };
    await kv.hset(CLE_POSTS, 'old', JSON.stringify(anc));
    await kv.hset(CLE_POSTS, 'pub', JSON.stringify(pub));
    await traiterAction(kv, 'brouillon', { ...bon, revisionDe: 'old' }, o.deps);
    await traiterAction(kv, 'brouillon', { ...bon, revisionDe: 'pub' }, o.deps);
    const h = await kv.hgetall(CLE_POSTS);
    expect(JSON.parse(h.old).statut).toBe('abandonne');
    expect(JSON.parse(h.pub).statut).toBe('publie');
  });
  it('traite avec reponse : envoyer appelé une fois avec ce texte', async () => {
    const kv = memoire(); const o = outils();
    await deposer(kv, { id: 'm1', type: 'lien', contenu: 'https://a.fr' });
    await traiterAction(kv, 'traite', { id: 'm1', resume: 'lu', reponse: 'Voici ma réponse' }, o.deps);
    expect(o.envoyes).toHaveLength(1);
    expect(o.envoyes[0].texte).toBe('Voici ma réponse');
  });
  it('traite : une réponse qui nomme un projet interdit est refusée (422) avant tout envoi', async () => {
    const kv = memoire(); const o = outils();
    await deposer(kv, { id: 'm1', type: 'commentaire', contenu: 'Bravo' });
    await expect(traiterAction(kv, 'traite', { id: 'm1', resume: 'r', reponse: 'Merci ! Sur #BoutiqueStores…' }, o.deps)).rejects.toMatchObject({ code: 422 });
    expect(o.envoyes).toHaveLength(0);
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as { aTraiter: unknown[] };
    expect(c.aTraiter).toHaveLength(1);
  });
  it('traite : l’état dit ce qui a été traité', async () => {
    const kv = memoire(); const o = outils();
    await deposer(kv, { id: 'm1', type: 'commentaire', contenu: 'Bravo' });
    await traiterAction(kv, 'traite', { id: 'm1', resume: 'r' }, o.deps);
    expect(await etatL(kv)).toBe('répond à un commentaire');
    await traiterAction(kv, 'traite', { id: 'inconnu', resume: 'r' }, o.deps);
    expect(await etatL(kv)).toBe('traite la boîte');
  });
  it('question : envoyée au patron ; vide 400, trop longue 400, projet interdit 422', async () => {
    const kv = memoire(); const o = outils();
    await traiterAction(kv, 'question', { texte: 'Je peux parler de ton app de livraison ?' }, o.deps);
    expect(o.envoyes).toEqual([{ texte: 'L · question : Je peux parler de ton app de livraison ?', boutons: undefined }]);
    await expect(traiterAction(kv, 'question', { texte: '  ' }, o.deps)).rejects.toMatchObject({ code: 400 });
    await expect(traiterAction(kv, 'question', { texte: 'q'.repeat(1001) }, o.deps)).rejects.toMatchObject({ code: 400 });
    await expect(traiterAction(kv, 'question', { texte: 'Je peux nommer Livreo ?' }, o.deps)).rejects.toMatchObject({ code: 422 });
    expect(o.envoyes).toHaveLength(1);
  });
  it('traite sans id : 400', async () => {
    await expect(traiterAction(memoire(), 'traite', { resume: 'x' }, outils().deps)).rejects.toMatchObject({ code: 400 });
  });
  it('memoire : règle et autorisation, sinon 400', async () => {
    const kv = memoire(); const o = outils();
    await traiterAction(kv, 'memoire', { regle: 'Toujours tutoyer', projet: 'livreo', visibilite: 'nomme' }, o.deps);
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as { memoire: { regles: string[]; autorisations: Record<string, string> } };
    expect(c.memoire.regles).toEqual(['Toujours tutoyer']);
    expect(c.memoire.autorisations.livreo).toBe('nomme');
    await expect(traiterAction(kv, 'memoire', { projet: 'x', visibilite: 'zzz' }, o.deps)).rejects.toMatchObject({ code: 400 });
  });
  it('contexte : boîte, proposition la plus récente, date, brouillons avec demande', async () => {
    const kv = memoire(); const o = outils();
    await deposer(kv, { id: 'm1', type: 'lien', contenu: 'https://a.fr' });
    await traiterAction(kv, 'propositions', { sujets: [sujet('A'), sujet('B'), sujet('C')] }, o.deps);
    await kv.hset('l:posts', 'p1', JSON.stringify({ id: 'p1', sujet: 's', texte: 't', hashtags: [], statut: 'brouillon', accordId: 'zz', quand: 1 }));
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as {
      aTraiter: unknown[]; propositionEnCours: { sujets: unknown[] } | null; aujourdhui: string; postsEnAttente: unknown[];
    };
    expect(c.aTraiter).toHaveLength(1);
    expect(c.propositionEnCours?.sujets).toHaveLength(3);
    expect(c.aujourdhui).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.postsEnAttente).toHaveLength(1);
  });
  it('contexte : l’état de la connexion LinkedIn, sans le jeton', async () => {
    const kv = memoire(); const o = outils();
    const { enregistrerConnexion } = await import('../linkedin/connexion');
    expect(((await traiterAction(kv, 'contexte', {}, o.deps)) as { linkedin: unknown }).linkedin).toEqual({ connecte: false });
    await enregistrerConnexion(kv, { jeton: 'SECRET-JETON', expireDans: 30 * 86400 + 3600, auteur: 'urn:li:person:x', nom: 'patron' }, 's');
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as { linkedin: { connecte: boolean; nom: string; joursRestants: number } };
    expect(c.linkedin).toMatchObject({ connecte: true, nom: 'patron', joursRestants: 30 });
    expect(JSON.stringify(c)).not.toContain('SECRET-JETON');
  });
  it('contexte : une lecture LinkedIn en panne donne « non connecté »', async () => {
    const kv = memoire(); const o = outils();
    const enPanne = { ...kv, hgetall: async (k: string) => { if (k.startsWith('linkedin:')) throw new Error('Upstash'); return kv.hgetall(k); } };
    expect(((await traiterAction(enPanne, 'contexte', {}, o.deps)) as { linkedin: unknown }).linkedin).toEqual({ connecte: false });
  });
  it('contexte joint la demande de modification', async () => {
    const kv = memoire(); const o = outils();
    await kv.hset('l:posts', 'p1', JSON.stringify({ id: 'p1', sujet: 's', texte: 't', hashtags: [], statut: 'brouillon', accordId: 'acc1', quand: 1 }));
    const { CLES_ACCORDS } = await import('../accords');
    await kv.hset(CLES_ACCORDS.tous, 'acc1', JSON.stringify({ id: 'acc1', agent: 'L', action: 'x', resume: 'r', statut: 'modifie', detail: 'plus court', demande: 1 }));
    const c = (await traiterAction(kv, 'contexte', {}, o.deps)) as { postsEnAttente: { demande?: string }[] };
    expect(c.postsEnAttente[0].demande).toBe('plus court');
  });
  it('action inconnue : 404', async () => {
    await expect(traiterAction(memoire(), 'xyz', {}, outils().deps)).rejects.toBeInstanceOf(Refus);
    await expect(traiterAction(memoire(), 'xyz', {}, outils().deps)).rejects.toMatchObject({ code: 404 });
  });

  describe('le visuel du brouillon', () => {
    it('brouillon avec visuel : rendu, 1 image puis la demande, visuel gardé avec le post', async () => {
      const kv = memoire(); const b = banc();
      const r = (await traiterAction(kv, 'brouillon', { ...bon, sujet: 'Mes agents', visuel: carte }, b.deps)) as { post: { id: string; visuel?: Visuel } };
      expect(b.journal).toEqual(['rendre', 'image', 'texte']);
      expect(b.images).toEqual([{ legende: 'Visuel proposé pour : Mes agents (le texte suit)' }]);
      expect(b.envoyes[0].boutons).toHaveLength(2);
      expect(r.post.visuel).toEqual(carte);
      expect(JSON.parse((await kv.hgetall(CLE_POSTS))[r.post.id]).visuel).toEqual(carte);
    });
    it('carrousel : l’image, puis le PDF, puis la demande', async () => {
      const kv = memoire(); const b = banc();
      await traiterAction(kv, 'brouillon', { ...bon, visuel: carrousel }, b.deps);
      expect(b.journal).toEqual(['rendre', 'image', 'fichier', 'texte']);
      expect(b.fichiers.map(f => f.nom)).toEqual(['carrousel.pdf']);
    });
    it('un projet interdit dans visuel.lignes : 422, rien rendu ni envoyé, aucun post', async () => {
      const kv = memoire(); const b = banc();
      await expect(traiterAction(kv, 'brouillon', { ...bon, visuel: { ...carte, lignes: ['Chez LIVREO'] } }, b.deps)).rejects.toMatchObject({ code: 422 });
      expect(b.journal).toEqual([]);
      expect(await statuts(kv)).toEqual([]);
    });
    it('un visuel invalide : 400, rien envoyé, aucun post', async () => {
      const kv = memoire(); const b = banc();
      await expect(traiterAction(kv, 'brouillon', { ...bon, visuel: { ...carte, modele: 'video' } }, b.deps)).rejects.toMatchObject({ code: 400 });
      await expect(traiterAction(kv, 'brouillon', { ...bon, visuel: { ...carte, lignes: ['x'.repeat(23)] } }, b.deps)).rejects.toMatchObject({ code: 400 });
      expect(b.journal).toEqual([]);
      expect(await statuts(kv)).toEqual([]);
    });
    it('un visuel invalide ne ferme pas l’ancienne demande d’une révision', async () => {
      const kv = memoire(); const b = banc();
      const a = (await traiterAction(kv, 'brouillon', bon, b.deps)) as { post: { id: string }; accordId: string };
      await expect(traiterAction(kv, 'brouillon', { ...bon, revisionDe: a.post.id, visuel: { modele: 'x' } }, b.deps)).rejects.toMatchObject({ code: 400 });
      expect(await idsEnAttente(kv)).toEqual([a.accordId]);
    });
    it('le rendu échoue : rien n’est envoyé, aucune demande ni post créés, erreur claire', async () => {
      const kv = memoire(); const b = banc({ rendreEchoue: true });
      await expect(traiterAction(kv, 'brouillon', { ...bon, visuel: carte }, b.deps)).rejects.toThrow(/visuel.*rendu cassé/);
      expect(b.envoyes).toHaveLength(0);
      expect(await idsEnAttente(kv)).toEqual([]);
      expect(await statuts(kv)).toEqual([]);
    });
    it('l’envoi de l’image échoue : pas de demande texte, aucune demande ni post créés', async () => {
      const kv = memoire(); const b = banc({ imageEchoue: true });
      await expect(traiterAction(kv, 'brouillon', { ...bon, visuel: carte }, b.deps)).rejects.toThrow(/sendPhoto refusé/);
      expect(b.journal).toEqual(['rendre', 'image']);
      expect(await idsEnAttente(kv)).toEqual([]);
      expect(await statuts(kv)).toEqual([]);
    });
    it('pendant l’envoi de l’image, aucune demande n’est en attente (un « ok » tapé ne peut rien valider)', async () => {
      const kv = memoire(); const b = banc();
      let enAttentePendantImage: string[] | null = null;
      const deps = { ...b.deps, envoyerImage: async (png: Uint8Array, legende?: string) => {
        enAttentePendantImage = await idsEnAttente(kv);
        return b.deps.envoyerImage!(png, legende);
      } };
      await traiterAction(kv, 'brouillon', { ...bon, visuel: carte }, deps);
      expect(enAttentePendantImage).toEqual([]);
      expect(await idsEnAttente(kv)).toHaveLength(1);
    });
    it('une révision sans visuel garde l’ancien, et le renvoie', async () => {
      const kv = memoire(); const b = banc();
      const a = (await traiterAction(kv, 'brouillon', { ...bon, visuel: carte }, b.deps)) as { post: { id: string } };
      const r = (await traiterAction(kv, 'brouillon', { ...bon, texte: 'v2', revisionDe: a.post.id }, b.deps)) as { post: { visuel?: Visuel } };
      expect(r.post.visuel).toEqual(carte);
      expect(b.journal).toEqual(['rendre', 'image', 'texte', 'rendre', 'image', 'texte']);
      // une révision avec un nouveau visuel le remplace
      const c = (await traiterAction(kv, 'brouillon', { ...bon, texte: 'v3', revisionDe: a.post.id, visuel: carrousel }, b.deps)) as { post: { visuel?: Visuel } };
      expect(c.post.visuel).toEqual(carrousel);
    });
    it('brouillon sans visuel : ni rendu ni image', async () => {
      const kv = memoire(); const b = banc();
      await traiterAction(kv, 'brouillon', bon, b.deps);
      expect(b.journal).toEqual(['texte']);
    });
    it('contexte.captures liste la bibliothèque', async () => {
      const c = (await traiterAction(memoire(), 'contexte', {}, banc().deps)) as { captures: string[] };
      expect(c.captures).toContain('qg-open-space');
    });
    it('apercu : rend l’image et n’envoie rien', async () => {
      const kv = memoire(); const b = banc();
      const r = (await traiterAction(kv, 'apercu', carte, b.deps)) as { image: Uint8Array };
      expect(r.image).toEqual(new Uint8Array([1, 2, 3]));
      expect(b.journal).toEqual(['rendre']);
      await expect(traiterAction(kv, 'apercu', { ...carte, lignes: [] }, b.deps)).rejects.toMatchObject({ code: 400 });
      await expect(traiterAction(kv, 'apercu', { ...carte, accent: 'Livreo' }, b.deps)).rejects.toMatchObject({ code: 422 });
      expect(b.journal).toEqual(['rendre']);
      expect(await statuts(kv)).toEqual([]);
    });
  });

  describe('bilan', () => {
    const corpsBilan = (statsId: string, plus: Record<string, unknown> = {}) => ({
      statsId, resume: 'Une bonne semaine.', chiffres: [{ nom: 'Impressions', valeur: '1200', evolution: '+10 %' }],
      marche: ['les posts courts'], lecteurs: ['des développeurs'], ajustements: ['publier plus tôt'], ...plus,
    });
    const depot = (kv: ReturnType<typeof memoire>) => deposerStats(kv, 'stats.csv', [{ nom: 'a', lignes: [['x', '1']] }]);

    it('valide : enregistré, dépôt traité, message envoyé avec le résumé', async () => {
      const kv = memoire(); const o = outils(); const d = await depot(kv);
      const r = await traiterAction(kv, 'bilan', corpsBilan(d.id), o.deps) as { bilan: { id: string } };
      expect(r.bilan.id).toBeTruthy();
      expect((await dernierBilan(kv))?.statsId).toBe(d.id);
      expect(await statsATraiter(kv)).toEqual([]);
      expect(o.envoyes).toHaveLength(1);
      expect(o.envoyes[0].texte).toContain('L · bilan de la semaine\nUne bonne semaine.');
      expect(o.envoyes[0].texte).toContain('les posts courts');
      expect(o.envoyes[0].texte).toContain('publier plus tôt');
      expect(o.envoyes[0].boutons).toBeUndefined();
    });
    it('même statsId deux fois : 409, pas de second message', async () => {
      const kv = memoire(); const o = outils(); const d = await depot(kv);
      await traiterAction(kv, 'bilan', corpsBilan(d.id), o.deps);
      await expect(traiterAction(kv, 'bilan', corpsBilan(d.id), o.deps)).rejects.toMatchObject({ code: 409 });
      expect(o.envoyes).toHaveLength(1);
    });
    it('statsId inconnu : 404, rien envoyé', async () => {
      const kv = memoire(); const o = outils();
      await expect(traiterAction(kv, 'bilan', corpsBilan('nope'), o.deps)).rejects.toMatchObject({ code: 404 });
      expect(o.envoyes).toEqual([]);
    });
    it('un champ trop long : 400, dépôt toujours à traiter', async () => {
      const kv = memoire(); const o = outils(); const d = await depot(kv);
      await expect(traiterAction(kv, 'bilan', corpsBilan(d.id, { resume: 'x'.repeat(601) }), o.deps)).rejects.toMatchObject({ code: 400 });
      await expect(traiterAction(kv, 'bilan', corpsBilan(d.id, { marche: ['a'.repeat(201)] }), o.deps)).rejects.toMatchObject({ code: 400 });
      await expect(traiterAction(kv, 'bilan', corpsBilan(d.id, { chiffres: Array(7).fill({ nom: 'a', valeur: '1' }) }), o.deps)).rejects.toMatchObject({ code: 400 });
      expect(await statsATraiter(kv)).toHaveLength(1);
      expect(o.envoyes).toEqual([]);
    });
    it('projet interdit dans marche : 422, dépôt toujours à traiter, rien enregistré', async () => {
      const kv = memoire(); const o = outils(); const d = await depot(kv);
      await expect(traiterAction(kv, 'bilan', corpsBilan(d.id, { marche: ['le post sur LIVREO'] }), o.deps)).rejects.toMatchObject({ code: 422 });
      expect(await statsATraiter(kv)).toHaveLength(1);
      expect(await kv.hgetall(CLE_BILANS)).toEqual({});
      expect(o.envoyes).toEqual([]);
    });
    it('Telegram en panne : bilan gardé, dépôt traité, avertissement', async () => {
      const kv = memoire(); const o = outils(true); const d = await depot(kv);
      const r = await traiterAction(kv, 'bilan', corpsBilan(d.id), o.deps) as { bilan: unknown; avertissement?: string };
      expect(r.avertissement).toBe('message Telegram non envoyé');
      expect(r.bilan).toBeTruthy();
      expect(await dernierBilan(kv)).not.toBeNull();
      expect(await statsATraiter(kv)).toEqual([]);
    });
    it('contexte : un seul dépôt, borné à 60 000 caractères, statsEnAttente', async () => {
      const kv = memoire(); const o = outils();
      const gros = Array.from({ length: 80 }, () => ['x'.repeat(120), 'y'.repeat(120), 'z'.repeat(120), 'w'.repeat(120)]);
      const d1 = await deposerStats(kv, 'a.csv', [{ nom: 'a', lignes: gros }, { nom: 'b', lignes: gros }], 1);
      await deposerStats(kv, 'b.csv', [{ nom: 'a', lignes: [['1']] }], 2);
      const c = await traiterAction(kv, 'contexte', {}, o.deps) as { statsATraiter: { id: string; feuilles: { lignes: string[][] }[]; tronque?: boolean }[]; statsEnAttente: number };
      expect(c.statsEnAttente).toBe(2);
      expect(c.statsATraiter).toHaveLength(1);
      expect(c.statsATraiter[0].id).toBe(d1.id);
      expect(c.statsATraiter[0].tronque).toBe(true);
      const total = c.statsATraiter[0].feuilles.flatMap(f => f.lignes).flat().reduce((t, x) => t + x.length, 0);
      expect(total).toBeLessThanOrEqual(60000);
    });
    it('contexte : statsATraiter et dernierBilan', async () => {
      const kv = memoire(); const o = outils(); const d = await depot(kv);
      let c = await traiterAction(kv, 'contexte', {}, o.deps) as { statsATraiter: { id: string }[]; dernierBilan: unknown };
      expect(c.statsATraiter.map(x => x.id)).toEqual([d.id]);
      expect(c.dernierBilan).toBeNull();
      await traiterAction(kv, 'bilan', corpsBilan(d.id), o.deps);
      c = await traiterAction(kv, 'contexte', {}, o.deps) as typeof c;
      expect(c.statsATraiter).toEqual([]);
      expect(c.dernierBilan).toMatchObject({ statsId: d.id });
    });
  });
});
