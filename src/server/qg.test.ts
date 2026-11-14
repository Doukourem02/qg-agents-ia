import { describe, expect, it } from 'vitest';
import { memoire } from './memoire';
import { deposerMission, ecrireEtat, lireEtat, prendreMissions, Refus } from './qg';

describe('le branchement (phase 2)', () => {
  it('un agent écrit son état, la page le lit, et le journal le garde', async () => {
    const kv = memoire();
    await ecrireEtat(kv, { agent: 'L', statut: 'au travail', tache: 'rédige le post de mercredi', outil: 'in' }, 1000);
    const { etats, journal } = await lireEtat(kv);
    expect(etats.L).toMatchObject({ statut: 'au travail', tache: 'rédige le post de mercredi', outil: 'in', quand: 1000 });
    expect(journal[0]).toMatchObject({ agent: 'L', type: 'etat', origine: 'agent' });
  });
  it('{ journal: false } met à jour l\'état en direct sans toucher au journal', async () => {
    const kv = memoire();
    await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: 'vérifie les sites' }, 2000, { journal: false });
    const { etats, journal } = await lireEtat(kv);
    expect(etats.luffy).toMatchObject({ tache: 'vérifie les sites', quand: 2000 });
    expect(journal).toEqual([]);
  });
  it('une écriture rejouée avec la même clé ne compte qu’une fois (idempotence)', async () => {
    const kv = memoire();
    const a = await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: 'sites vérifiés', cle: 'vigie-1200' });
    const b = await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: 'sites vérifiés', cle: 'vigie-1200' });
    expect([a.doublon, b.doublon]).toEqual([false, true]);
    expect((await lireEtat(kv)).journal).toHaveLength(1);
  });
  it('refuse un agent inconnu, un statut inconnu ou un texte trop long', async () => {
    const kv = memoire();
    await expect(ecrireEtat(kv, { agent: 'inconnu', statut: 'au travail', tache: 'x' })).rejects.toBeInstanceOf(Refus);
    await expect(ecrireEtat(kv, { agent: 'L', statut: 'dort', tache: 'x' })).rejects.toThrow(/statut inconnu/);
    await expect(ecrireEtat(kv, { agent: 'L', statut: 'au travail', tache: 'x'.repeat(500) })).rejects.toThrow(/trop long/);
  });
  it('une mission de la barre va au bon agent, qui la récupère une seule fois, dans l’ordre', async () => {
    const kv = memoire();
    const m1 = await deposerMission(kv, { texte: 'Un post sur Prisma v6' });
    await deposerMission(kv, { texte: 'Un deuxième post sur Next.js 16' });
    expect(m1.agent).toBe('L');
    const prises = await prendreMissions(kv, 'L');
    expect(prises.map(m => m.texte)).toEqual(['Un post sur Prisma v6', 'Un deuxième post sur Next.js 16']);
    expect(await prendreMissions(kv, 'L')).toEqual([]);
  });
  it('une mission confiée depuis la fiche va à l’agent choisi', async () => {
    const kv = memoire();
    const m = await deposerMission(kv, { texte: 'vide les newsletters', agent: 'clara' });
    expect(m.agent).toBe('clara');
  });
  it('le journal garde au plus 300 entrées', async () => {
    const kv = memoire();
    for (let i = 0; i < 320; i++) await ecrireEtat(kv, { agent: 'mafe', statut: 'au travail', tache: `point ${i}` });
    expect((await kv.lrange('qg:journal', 0, -1)).length).toBe(300);
  });
});
