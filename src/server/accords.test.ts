import { describe, expect, it } from 'vitest';
import { memoire } from './memoire';
import { annulerAccord, demanderAccord, idsEnAttente, lireAccord, lireReponse, repondreAccord, texteDemande } from './accords';

describe('les accords sur WhatsApp', () => {
  it.each([
    ['OK', 'accepte'], ['oui !', 'accepte'], ['Ok.', 'accepte'], ['non', 'refuse'], ['Non.', 'refuse'],
  ])('« %s » → %s', (t, d) => expect(lireReponse(t)?.decision).toBe(d));
  it('comprend « modifie : … » et la cible #code', () => {
    expect(lireReponse('modifie : plus court')).toEqual({ decision: 'modifie', detail: 'plus court', id: undefined });
    expect(lireReponse('#ab12 OK')).toEqual({ decision: 'accepte', id: 'ab12' });
  });
  it('ne devine pas une réponse ambiguë', () => {
    expect(lireReponse('peut-être demain')).toBeNull();
    expect(lireReponse('ok mais change le titre')).toBeNull();
  });
  it('une demande puis ma réponse : l’agent lit la décision', async () => {
    const kv = memoire();
    const { accord } = await demanderAccord(kv, { agent: 'L', action: 'publier un post', resume: 'Post sur Prisma v6' });
    expect(texteDemande(accord)).toContain(`#${accord.id}`);
    const r = await repondreAccord(kv, 'OK');
    expect(r.compris && r.accord?.statut).toBe('accepte');
    expect((await lireAccord(kv, accord.id))?.statut).toBe('accepte');
    expect((await repondreAccord(kv, 'non')).accord).toBeNull(); // plus rien en attente
  });
  it('sans #code, la réponse va à la plus ancienne demande en attente', async () => {
    const kv = memoire();
    const a = (await demanderAccord(kv, { agent: 'L', action: 'publier', resume: 'premier' }, 1)).accord;
    const b = (await demanderAccord(kv, { agent: 'isaac', action: 'supprimer', resume: 'second' }, 2)).accord;
    await repondreAccord(kv, 'non');
    expect((await lireAccord(kv, a.id))?.statut).toBe('refuse');
    expect((await lireAccord(kv, b.id))?.statut).toBe('en attente');
    await repondreAccord(kv, `#${b.id} modifie : seulement les caches`);
    expect(await lireAccord(kv, b.id)).toMatchObject({ statut: 'modifie', detail: 'seulement les caches' });
  });
  it('annulerAccord ferme la demande et la retire de la file', async () => {
    const kv = memoire();
    const a = (await demanderAccord(kv, { agent: 'L', action: 'publier', resume: 'premier' }, 1)).accord;
    const b = (await demanderAccord(kv, { agent: 'L', action: 'publier', resume: 'second' }, 2)).accord;
    expect(await idsEnAttente(kv)).toEqual([a.id, b.id]);
    await annulerAccord(kv, a.id, 'remplacé');
    expect(await lireAccord(kv, a.id)).toMatchObject({ statut: 'annule', detail: 'remplacé' });
    expect(await idsEnAttente(kv)).toEqual([b.id]);
    await repondreAccord(kv, 'OK');
    expect((await lireAccord(kv, b.id))?.statut).toBe('accepte');
    expect((await lireAccord(kv, a.id))?.statut).toBe('annule');
  });
  it('une même clé ne crée qu’une seule demande', async () => {
    const kv = memoire();
    const x = await demanderAccord(kv, { agent: 'L', action: 'publier', resume: 'post', cle: 'post-mercredi' });
    const y = await demanderAccord(kv, { agent: 'L', action: 'publier', resume: 'post', cle: 'post-mercredi' });
    expect([x.nouveau, y.nouveau]).toEqual([true, false]);
    expect(y.accord.id).toBe(x.accord.id);
  });
});
