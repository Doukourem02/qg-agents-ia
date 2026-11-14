import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { Refus } from '../qg';
import { lireAccord, repondreAccord } from '../accords';
import { lireMemoire } from './memoire';
import { enregistrerPropositions, choisirSujet, deposerBrouillon, apresDecision, marquerPublie, textePret, type Sujet } from './posts';

const sujet = (n: number): Sujet => ({ titre: `T${n}`, angle: 'a', accroche: 'h', pourquoiMoi: 'p', format: 'texte' });
const trois = [sujet(1), sujet(2), sujet(3)];
const valide = { sujet: 'Mon sujet', texte: 'Un texte propre.', hashtags: ['#a', '#b', '#c'] };

async function brouillon() {
  const kv = memoire();
  const m = await lireMemoire(kv);
  const r = await deposerBrouillon(kv, valide, m);
  return { kv, ...r };
}

describe('propositions', () => {
  it('refuse autre chose que 3 sujets', async () => {
    await expect(enregistrerPropositions(memoire(), [sujet(1), sujet(2)])).rejects.toBeInstanceOf(Refus);
  });
  it('calcule la semaine ISO (10/11/2026 = 2026-W46)', async () => {
    const p = await enregistrerPropositions(memoire(), trois, new Date('2026-11-10T09:00:00Z').getTime());
    expect(p.semaine).toBe('2026-W46');
    expect(p.sujets).toHaveLength(3);
  });
  it('choisirSujet est idempotent : le 1er choix reste', async () => {
    const kv = memoire();
    const p = await enregistrerPropositions(kv, trois);
    await choisirSujet(kv, p.id, 1);
    const r = await choisirSujet(kv, p.id, 2);
    expect(r.choix).toBe(1);
  });
});

describe('brouillons', () => {
  it('refuse un projet interdit, sans créer d\'accord', async () => {
    const kv = memoire();
    const m = await lireMemoire(kv);
    await expect(deposerBrouillon(kv, { ...valide, texte: 'Chez Terra on a...' }, m)).rejects.toMatchObject({ code: 422 });
    expect(await kv.hgetall('qg:accords')).toEqual({});
  });
  it('refuse 2 hashtags, 6 hashtags ou un texte trop long', async () => {
    const kv = memoire();
    const m = await lireMemoire(kv);
    await expect(deposerBrouillon(kv, { ...valide, hashtags: ['#a', '#b'] }, m)).rejects.toMatchObject({ code: 422 });
    await expect(deposerBrouillon(kv, { ...valide, hashtags: ['#a', '#b', '#c', '#d', '#e', '#f'] }, m)).rejects.toMatchObject({ code: 422 });
    await expect(deposerBrouillon(kv, { ...valide, texte: 'x'.repeat(3001) }, m)).rejects.toMatchObject({ code: 422 });
  });
  it('brouillon valide : accord lié par cle, statut en accord', async () => {
    const { kv, post, accordId } = await brouillon();
    expect(post.statut).toBe('en accord');
    expect((await lireAccord(kv, accordId))?.cle).toBe('post:' + post.id);
  });
  it('apresDecision : OK donne pret une seule fois', async () => {
    const { kv, accordId } = await brouillon();
    await repondreAccord(kv, 'OK');
    const a = await apresDecision(kv, accordId);
    expect(a.aEnvoyer).toBe('pret');
    expect(a.post.statut).toBe('pret');
    expect((await apresDecision(kv, accordId)).aEnvoyer).toBeNull();
  });
  it('apresDecision : refus abandonne', async () => {
    const { kv, accordId } = await brouillon();
    await repondreAccord(kv, 'non');
    const a = await apresDecision(kv, accordId);
    expect(a.post.statut).toBe('abandonne');
    expect(a.aEnvoyer).toBe('abandon');
  });
  it('apresDecision : modifie renvoie en brouillon + revision', async () => {
    const { kv, accordId } = await brouillon();
    await repondreAccord(kv, 'modifie : plus court');
    const a = await apresDecision(kv, accordId);
    expect(a.post.statut).toBe('brouillon');
    expect(a.aEnvoyer).toBe('revision');
  });
  it('marquerPublie est idempotent', async () => {
    const { kv, post, accordId } = await brouillon();
    await repondreAccord(kv, 'OK');
    await apresDecision(kv, accordId);
    await marquerPublie(kv, post.id);
    const p = await marquerPublie(kv, post.id);
    expect(p.statut).toBe('publie');
    expect((await lireMemoire(kv)).publies).toHaveLength(1);
  });
  it('marquerPublie refuse un post qui n’est pas prêt (409), sans le noter', async () => {
    const { kv, post } = await brouillon();
    await expect(marquerPublie(kv, post.id)).rejects.toMatchObject({ code: 409 });
    expect((await kv.hgetall('l:posts'))[post.id]).toContain('"en accord"');
    expect((await lireMemoire(kv)).publies).toHaveLength(0);
  });
  it('refuse un sujet qui nomme un projet interdit (422)', async () => {
    const kv = memoire();
    await expect(deposerBrouillon(kv, { ...valide, sujet: 'Ce que LIVREO m’a appris' }, await lireMemoire(kv))).rejects.toMatchObject({ code: 422 });
  });
  it('garde propositionId et index', async () => {
    const kv = memoire();
    const { post } = await deposerBrouillon(kv, { ...valide, propositionId: 'p1', index: 2 }, await lireMemoire(kv));
    expect(post).toMatchObject({ propositionId: 'p1', index: 2 });
  });
  it('textePret contient texte, hashtags et la consigne', async () => {
    const { post } = await brouillon();
    const t = textePret(post);
    expect(t).toContain('Un texte propre.');
    expect(t).toContain('#a #b #c');
    expect(t).toContain("Touche « Publier sur LinkedIn » quand tu veux qu'il parte (idéal : vers 8 h 30). Si tu l'as publié toi-même, touche « Déjà publié ».");
  });
});
