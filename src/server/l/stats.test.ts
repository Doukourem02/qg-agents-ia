import { describe, it, expect } from 'vitest';
import { memoire } from '../memoire';
import { Refus } from '../qg';
import { deposerStats, estTableur, lireTableur, marquerStatsTraite, statsATraiter } from './stats';
import { xlsxDeTest } from './xlsx-test';

const octets = (t: string) => new TextEncoder().encode(t);
const refus = async (p: Promise<unknown>) => p.then(() => null, e => e as Refus);

describe('estTableur', () => {
  it('reconnaît .xlsx et .csv, casse ignorée', () => {
    expect(estTableur('a.XLSX')).toBe(true);
    expect(estTableur('a.csv')).toBe(true);
    expect(estTableur('a.pdf')).toBe(false);
    expect(estTableur('xlsx')).toBe(false);
  });
});

describe('lireTableur', () => {
  it('lit un csv, lignes vides retirées', async () => {
    expect(await lireTableur('a.csv', octets('Date,Impressions\n01/11/2026,120\n\n02/11/2026,90')))
      .toEqual([{ nom: 'a', lignes: [['Date', 'Impressions'], ['01/11/2026', '120'], ['02/11/2026', '90']] }]);
  });
  it('lit un csv à point-virgule et respecte les guillemets', async () => {
    expect((await lireTableur('a.csv', octets('Titre;N\r\n"a;b";3\r\n')))[0].lignes).toEqual([['Titre', 'N'], ['a;b', '3']]);
    expect((await lireTableur('a.csv', octets('Titre,N\n"a,b",3\n"il dit ""oui""",4')))[0].lignes)
      .toEqual([['Titre', 'N'], ['a,b', '3'], ['il dit "oui"', '4']]);
  });
  it('lit un xlsx de deux feuilles, dates et nombres en texte', async () => {
    const f = await lireTableur('Contenu.xlsx', xlsxDeTest([
      { nom: 'DISCOVERY', lignes: [['Date', 'Impressions'], ['2026-11-01', 120]] },
      { nom: 'FOLLOWERS', lignes: [['Date', 'Nouveaux'], ['2026-11-02', 4.5]] },
    ]));
    expect(f).toEqual([
      { nom: 'DISCOVERY', lignes: [['Date', 'Impressions'], ['01/11/2026', '120']] },
      { nom: 'FOLLOWERS', lignes: [['Date', 'Nouveaux'], ['02/11/2026', '4.5']] },
    ]);
  });
  it('refuse ce qui n\'est pas un tableur, un xlsx abîmé, un fichier vide', async () => {
    const a = await refus(lireTableur('photo.png', new Uint8Array([1])));
    expect([a?.code, a?.message]).toEqual([422, 'ce fichier n\'est pas un tableur (.xlsx ou .csv)']);
    const b = await refus(lireTableur('x.xlsx', new Uint8Array([1, 2, 3])));
    expect([b?.code, b?.message]).toEqual([422, 'fichier illisible']);
    expect((await refus(lireTableur('v.csv', octets('\n\n'))))?.code).toBe(422);
  });
  it('limite à 80 lignes et 120 caractères par cellule', async () => {
    const f = await lireTableur('g.csv', octets(Array.from({ length: 90 }, (_, i) => `l${i},${'x'.repeat(300)}`).join('\n')));
    expect(f[0].lignes).toHaveLength(80);
    expect(f[0].lignes[0][1]).toHaveLength(120);
  });
});

describe('le rangement des statistiques', () => {
  it('dépose, liste les non traités, marque traité une seule fois', async () => {
    const kv = memoire();
    const feuilles = [{ nom: 'a', lignes: [['x']] }];
    const d = await deposerStats(kv, 'a.csv', feuilles, 1000);
    expect(d).toMatchObject({ nom: 'a.csv', quand: 1000, feuilles, traite: false });
    expect(await statsATraiter(kv)).toEqual([d]);
    expect((await marquerStatsTraite(kv, d.id)).traite).toBe(true);
    expect(await statsATraiter(kv)).toEqual([]);
    expect((await refus(marquerStatsTraite(kv, d.id)))?.code).toBe(409);
    expect((await refus(marquerStatsTraite(kv, 'nope')))?.code).toBe(404);
  });
  it('du plus ancien au plus récent', async () => {
    const kv = memoire();
    const r = await deposerStats(kv, 'r.csv', [], 2000), v = await deposerStats(kv, 'v.csv', [], 1000);
    expect((await statsATraiter(kv)).map(d => d.id)).toEqual([v.id, r.id]);
  });
});
