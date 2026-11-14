import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { Refus } from '../qg';
import { lireMemoire, ajouterRegle, modifierRegle, retirerRegle, autoriser, noterPublie, projetsInterdits, CATALOGUE_PROJETS } from './memoire';

describe('mémoire de L', () => {
  it('KV vide : valeurs par défaut', async () => {
    expect(await lireMemoire(memoire())).toEqual({ regles: [], autorisations: { qg: 'nomme' }, publies: [] });
  });
  it('dédoublonne les règles', async () => {
    const kv = memoire();
    await ajouterRegle(kv, 'Pas de tiret long');
    await ajouterRegle(kv, 'Pas de tiret long');
    expect((await lireMemoire(kv)).regles).toEqual(['Pas de tiret long']);
  });
  it('refuse une règle vide ou trop longue', async () => {
    await expect(ajouterRegle(memoire(), '  ')).rejects.toBeInstanceOf(Refus);
    await expect(ajouterRegle(memoire(), 'x'.repeat(201))).rejects.toBeInstanceOf(Refus);
  });
  it('garde 100 règles, les plus anciennes sortent', async () => {
    const kv = memoire();
    for (let i = 0; i < 105; i++) await ajouterRegle(kv, `règle ${i}`);
    const r = (await lireMemoire(kv)).regles;
    expect(r).toHaveLength(100);
    expect(r[0]).toBe('règle 5');
    expect(r[99]).toBe('règle 104');
  });
  it('modifierRegle remplace à sa place ; retirerRegle enlève ; inconnue : 404', async () => {
    const kv = memoire();
    for (const r of ['a', 'b', 'c']) await ajouterRegle(kv, r);
    await kv.hset('l:memoire', 'autorisations', JSON.stringify({ livreo: 'nomme' }));
    expect(await modifierRegle(kv, 'b', ' B ')).toEqual(['a', 'B', 'c']);
    // devenue identique à une autre : pas de doublon
    expect(await modifierRegle(kv, 'B', 'c')).toEqual(['a', 'c']);
    await expect(modifierRegle(kv, 'zz', 'x')).rejects.toMatchObject({ code: 404 });
    await expect(modifierRegle(kv, 'a', '  ')).rejects.toBeInstanceOf(Refus);
    await expect(modifierRegle(kv, 'a', 'x'.repeat(201))).rejects.toBeInstanceOf(Refus);
    expect(await retirerRegle(kv, 'a')).toEqual(['c']);
    await expect(retirerRegle(kv, 'a')).rejects.toMatchObject({ code: 404 });
    // le reste de la mémoire n'est pas touché
    expect((await lireMemoire(kv)).autorisations.livreo).toBe('nomme');
  });
  it('autoriser normalise le projet', async () => {
    const kv = memoire();
    await autoriser(kv, 'Terra', 'nomme');
    await autoriser(kv, 'Studio Deco', 'jamais');
    const a = (await lireMemoire(kv)).autorisations;
    expect(a.terra).toBe('nomme');
    expect(a['studio deco']).toBe('jamais');
    expect(a.qg).toBe('nomme');
  });
  it('noterPublie garde les posts', async () => {
    const kv = memoire();
    await noterPublie(kv, { id: 'a', sujet: 's', quand: 1 });
    expect((await lireMemoire(kv)).publies).toEqual([{ id: 'a', sujet: 's', quand: 1 }]);
  });
  it('noterPublie ne note pas deux fois le même post', async () => {
    const kv = memoire();
    await noterPublie(kv, { id: 'a', sujet: 's', quand: 1 });
    await noterPublie(kv, { id: 'a', sujet: 's', quand: 2 });
    expect((await lireMemoire(kv)).publies).toEqual([{ id: 'a', sujet: 's', quand: 1 }]);
  });
  it('projetsInterdits', async () => {
    const kv = memoire();
    let m = await lireMemoire(kv);
    expect(projetsInterdits(m, 'Sur LIVREO et le QG…', CATALOGUE_PROJETS)).toEqual(['livreo']);
    await autoriser(kv, 'livreo', 'nomme');
    m = await lireMemoire(kv);
    expect(projetsInterdits(m, 'Sur LIVREO et le QG…', CATALOGUE_PROJETS)).toEqual([]);
    expect(projetsInterdits(m, 'Chez Studio Deco', CATALOGUE_PROJETS)).toEqual(['studio deco']);
  });
  it('projetsInterdits : formes compactes, CV, phrase ordinaire', async () => {
    const m = await lireMemoire(memoire());
    expect(projetsInterdits(m, '#BoutiqueStores #StudioDeco', CATALOGUE_PROJETS)).toEqual(['boutique stores', 'studio deco']);
    expect(projetsInterdits(m, '#AppPro et boutique-stores', CATALOGUE_PROJETS)).toEqual(['boutique stores', 'app_pro']);
    expect(projetsInterdits(m, '#SOLIDARCI', CATALOGUE_PROJETS)).toEqual(['solidar']);
    expect(projetsInterdits(m, 'Chez Huawei, puis Arnio et Nugo', CATALOGUE_PROJETS)).toEqual(['huawei', 'arnio', 'nugo']);
    const ordinaire = 'Les app prolications, le boutique des stores, un chrono, une belle création et le nuage.';
    expect(projetsInterdits(m, ordinaire, CATALOGUE_PROJETS)).toEqual([]);
    expect(projetsInterdits(m, 'I built a app pro last year', CATALOGUE_PROJETS)).toEqual([]);
    expect(projetsInterdits(m, 'Bienvenue au boutique stores', CATALOGUE_PROJETS)).toEqual(['boutique stores']);
  });
  it('projetsInterdits : une autorisation écrite en forme compacte vaut pour le projet', async () => {
    const kv = memoire();
    await autoriser(kv, 'BoutiqueStores', 'nomme');
    expect(projetsInterdits(await lireMemoire(kv), '#BoutiqueStores', CATALOGUE_PROJETS)).toEqual([]);
  });
});
