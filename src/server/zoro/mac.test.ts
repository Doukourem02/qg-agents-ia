import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { Refus } from '../qg';
import { CLES_ZORO, demanderRapportMac, enregistrerRapportMac, lireRapportMac, rapportDemande } from './mac';
import type { DossierMac } from './types';

const dossier = (o: Partial<DossierMac> = {}): DossierMac => ({
  nom: 'qg', git: true, compte: 'mon-compte', distant: true,
  nonEnregistres: 2, plusAncienNonEnregistre: 1000, nonPousses: 1, plusAncienNonPousse: 2000,
  stashes: 0, dernierCommit: 3000, modifie: 4000, ...o,
});
const refuse = async (corps: unknown) => {
  const e = await enregistrerRapportMac(memoire(), corps, 5000).then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(Refus);
  expect((e as Refus).code).toBe(400);
};

describe('enregistrerRapportMac', () => {
  it('rapport invalide (dossiers absent, nombre négatif, nom avec « / » au-delà d\'un niveau ou « .. ») → Refus 400', async () => {
    await refuse(null);
    await refuse({});
    await refuse({ dossiers: 'x' });
    await refuse({ dossiers: [dossier({ nonEnregistres: -1 })] });
    await refuse({ dossiers: [dossier({ nonPousses: 1.5 })] });
    await refuse({ dossiers: [dossier({ git: 'oui' as unknown as boolean })] });
    await refuse({ dossiers: [dossier({ distant: 1 as unknown as boolean })] });
    await refuse({ dossiers: [dossier({ nom: '' })] });
    await refuse({ dossiers: [dossier({ nom: 'a/b/c' })] });
    await refuse({ dossiers: [dossier({ nom: '../x' })] });
    await refuse({ dossiers: [dossier({ nom: 'a/..' })] });
    await refuse({ dossiers: [dossier({ nom: '/etc' })] });
    await refuse({ dossiers: [dossier({ plusAncienNonPousse: -5 })] });
    await refuse({ dossiers: [null] });
    await refuse({ dossiers: [dossier({ nom: 'a\\b' })] });
    await refuse({ dossiers: [{ ...dossier(), illisible: false }] });
    await refuse({ dossiers: [{ ...dossier(), illisible: 'oui' }] });
  });

  it('enregistré puis relu ; la demande d\'envoi est effacée', async () => {
    const kv = memoire();
    expect(await lireRapportMac(kv)).toBeNull();
    await demanderRapportMac(kv);
    expect(await rapportDemande(kv)).toBe(true);
    const d = [dossier(), dossier({ nom: 'parent/enfant' }), dossier({ nom: 'docs', git: false, compte: null, distant: false, dernierCommit: null })];
    expect(await enregistrerRapportMac(kv, { quand: 1, dossiers: d }, 5000)).toEqual({ ok: true });
    expect(await lireRapportMac(kv)).toEqual({ quand: 5000, dossiers: d });
    expect(await rapportDemande(kv)).toBe(false);
    expect(await kv.get(CLES_ZORO.demandeMac)).toBeNull();
  });

  it('accepte et garde « illisible: true »', async () => {
    const kv = memoire();
    await enregistrerRapportMac(kv, { dossiers: [{ ...dossier(), illisible: true }, dossier({ nom: 'b' })] }, 1);
    const r = await lireRapportMac(kv);
    expect(r!.dossiers[0].illisible).toBe(true);
    expect('illisible' in r!.dossiers[1]).toBe(false);
  });

  it('garde 200 dossiers au plus et ne conserve que les champs connus', async () => {
    const kv = memoire();
    const d = Array.from({ length: 250 }, (_, i) => ({ ...dossier({ nom: `p${i}` }), fichier: 'secret.txt' }));
    await enregistrerRapportMac(kv, { dossiers: d }, 1);
    const r = await lireRapportMac(kv);
    expect(r!.dossiers).toHaveLength(200);
    expect(Object.keys(r!.dossiers[0]).sort()).toEqual(Object.keys(dossier()).sort());
  });

  it('un rapport refusé ne touche ni au rapport ni à la demande', async () => {
    const kv = memoire();
    await demanderRapportMac(kv);
    await refuse({ dossiers: 3 });
    expect(await rapportDemande(kv)).toBe(true);
    expect(await lireRapportMac(kv)).toBeNull();
  });
});
