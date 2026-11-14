import { describe, expect, it } from 'vitest';
import { memoire } from './memoire';
import { Refus } from './qg';
import { ajouterRegleQG, CLE_REGLES, lireRegles, MAX_REGLES_QG, modifierRegleQG, retirerRegleQG, textesRegles } from './regles';

describe('mes règles (qg:regles)', () => {
  it('vide au départ', async () => {
    expect(await lireRegles(memoire())).toEqual([]);
  });
  it('ajoute dans l\'ordre, texte nettoyé, doublon ignoré', async () => {
    const kv = memoire();
    await ajouterRegleQG(kv, '  Pas de message   après 22 h. ', 10);
    await ajouterRegleQG(kv, 'Toujours en français.', 20);
    await ajouterRegleQG(kv, 'Pas de message après 22 h.', 30);
    const r = await lireRegles(kv);
    expect(r.map(x => x.texte)).toEqual(['Pas de message après 22 h.', 'Toujours en français.']);
    expect(r[0]).toMatchObject({ quand: 10 });
    expect(r[0].id).toMatch(/^[a-z0-9]{8,}$/);
    expect(Object.keys(await kv.hgetall(CLE_REGLES))).toHaveLength(2);
    expect(await textesRegles(kv)).toEqual(['Pas de message après 22 h.', 'Toujours en français.']);
  });
  it('refuse un texte vide, trop long (200 au plus) ou une 31e règle', async () => {
    const kv = memoire();
    await expect(ajouterRegleQG(kv, '  ')).rejects.toBeInstanceOf(Refus);
    await expect(ajouterRegleQG(kv, 42 as unknown as string)).rejects.toBeInstanceOf(Refus);
    await expect(ajouterRegleQG(kv, 'x'.repeat(201))).rejects.toBeInstanceOf(Refus);
    await ajouterRegleQG(kv, 'x'.repeat(200));
    for (let i = 1; i < MAX_REGLES_QG; i++) await ajouterRegleQG(kv, `règle ${i}`);
    expect(await lireRegles(kv)).toHaveLength(30);
    await expect(ajouterRegleQG(kv, 'une de trop')).rejects.toMatchObject({ code: 409 });
  });
  it('modifie et retire par identifiant ; identifiant inconnu : 404', async () => {
    const kv = memoire();
    const [a] = await ajouterRegleQG(kv, 'Avant', 1);
    await ajouterRegleQG(kv, 'Autre', 2);
    await modifierRegleQG(kv, a.id, ' Après ');
    expect((await lireRegles(kv)).map(x => x.texte)).toEqual(['Après', 'Autre']);
    expect((await lireRegles(kv))[0].quand).toBe(1);
    await expect(modifierRegleQG(kv, a.id, '')).rejects.toBeInstanceOf(Refus);
    await expect(modifierRegleQG(kv, 'inconnu1', 'x')).rejects.toMatchObject({ code: 404 });
    await retirerRegleQG(kv, a.id);
    expect((await lireRegles(kv)).map(x => x.texte)).toEqual(['Autre']);
    await expect(retirerRegleQG(kv, a.id)).rejects.toMatchObject({ code: 404 });
  });
  it('ignore une valeur illisible', async () => {
    const kv = memoire();
    await kv.hset(CLE_REGLES, 'abc', 'pas du json');
    expect(await lireRegles(kv)).toEqual([]);
  });
});
