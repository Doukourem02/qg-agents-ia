import { describe, expect, it } from 'vitest';
import agents from '@/data/agents.json';
import { AUDITEURS, choisirAuditeur } from './ecoute';
import { Engine } from './engine';

/** L'aléa qui tire exactement cet agent (sans morceau précédent). */
const pour = (id: string) => () => (AUDITEURS.indexOf(id) + 0.5) / AUDITEURS.length;

describe('choisirAuditeur', () => {
  it('seuls les agents du pôle Mac & Outils écoutent (Spotify est sur mon Mac)', () => {
    const ids = agents.agents.filter(a => a.pole === 'mac').map(a => a.id);
    expect([...AUDITEURS].sort()).toEqual(['clara', 'isaac', 'malenia']);
    expect([...AUDITEURS].sort()).toEqual([...ids].sort());
    const vus = new Set(AUDITEURS.map((id, i) => choisirAuditeur(`m${i}`, null, pour(id)).agentId));
    expect(vus.size).toBe(AUDITEURS.length);
  });
  it('même morceau : même agent ; nouveau morceau : jamais le même deux fois de suite', () => {
    const a = choisirAuditeur('m1', null, pour('isaac'));
    expect(a.agentId).toBe('isaac');
    expect(choisirAuditeur('m1', a, () => 0.9)).toBe(a);
    let prec = a;
    for (let i = 0; i < 200; i++) {
      const suivant = choisirAuditeur(`n${i}`, prec);
      expect(suivant.agentId).not.toBe(prec.agentId);
      prec = suivant;
    }
  });
});

describe('Engine.appliquerEcoute', () => {
  const morceau = { id: 't1', titre: 'Nights', artistes: 'Frank Ocean', joue: true };
  it('bulle, fiche et icône Spotify réellement allumée', () => {
    const e = new Engine('calme');
    e.appliquerEcoute(morceau, pour('isaac')); // tom
    const s = e.snapshot();
    expect(s.bubbles.find(b => b.agentId === 'isaac')?.text).toBe('🎧 Nights · Frank Ocean');
    expect(s.tasks.isaac).toBe('écoute : Nights · Frank Ocean');
    expect(Object.values(s.tasks).join(' ') + s.bubbles.map(b => b.text).join(' ')).not.toMatch(/avec (Le patron|moi)/);
    expect(s.lit).toContain('Sp');
    expect(s.usages[0]).toMatchObject({ tool: 'Sp', agentId: 'isaac' });
  });
  it('le même agent tout le morceau, la bulle une seule fois', () => {
    const e = new Engine('calme');
    e.appliquerEcoute(morceau, pour('isaac'));
    e.bubbles = [];
    e.appliquerEcoute(morceau, () => 0.9);
    expect(e.snapshot().tasks.isaac).toContain('Nights');
    expect(e.snapshot().tasks.malenia ?? '').not.toContain('Nights');
    expect(e.bubbles).toHaveLength(0);
  });
  it('en pause ou rien : plus de casque, icône éteinte', () => {
    const e = new Engine('calme');
    e.appliquerEcoute({ ...morceau, joue: false }, pour('isaac'));
    expect(e.snapshot().lit).not.toContain('Sp');
    expect(e.snapshot().tasks.isaac).not.toContain('Nights');
    e.appliquerEcoute(morceau, pour('isaac'));
    e.appliquerEcoute(null);
    expect(e.snapshot().tasks.isaac).not.toContain('Nights');
    expect(e.snapshot().lit).not.toContain('Sp');
  });
  it('seul l’agent choisi danse, et seulement pendant la lecture', () => {
    const e = new Engine('calme');
    expect(e.snapshot().danse).toEqual([]);
    e.appliquerEcoute({ ...morceau, dureeMs: 200_000, progressionMs: 100_000 }, pour('clara')); // paul
    expect(e.snapshot().danse).toEqual(['clara']);
    expect(e.dansant('clara')).toBe(true);
    expect(e.dansant('malenia')).toBe(false);
    e.appliquerEcoute({ ...morceau, joue: false });
    expect(e.snapshot().danse).toEqual([]);
    e.appliquerEcoute(morceau);
    expect(e.snapshot().danse).toEqual(['clara']);
    e.appliquerEcoute(null);
    expect(e.snapshot().danse).toEqual([]);
  });
  it('la danse s’arrête à la fin estimée du morceau, et le danseur reste à son poste', () => {
    const e = new Engine('calme');
    e.appliquerEcoute({ ...morceau, dureeMs: 10_000, progressionMs: 5_000 }, pour('clara'));
    const paul = e.get('clara')!;
    for (let i = 0; i < 60; i++) { e.tick(0.1); expect(paul.errand ?? null).toBeNull(); }
    expect(e.snapshot().danse).toEqual(['clara']);
    for (let i = 0; i < 20; i++) e.tick(0.1); // 5 s restantes + 2 s de marge dépassées
    expect(e.snapshot().danse).toEqual([]);
  });
  it('l’auditeur rentre à son poste et y reste pour danser tout le morceau', () => {
    const e = new Engine('calme');
    e.appliquerEcoute({ ...morceau, id: 'autre', dureeMs: 300_000, progressionMs: 0 }, pour('isaac'));
    const isaac = e.get('isaac')!;
    for (let i = 0; i < 600; i++) e.tick(0.1); // 60 s : largement le temps de rentrer
    expect(e.atHome(isaac)).toBe(true);
    for (let i = 0; i < 200; i++) { e.tick(0.1); expect(isaac.path).toHaveLength(0); } // 20 s sans bouger de son poste
    expect(e.snapshot().danse).toEqual(['isaac']);
  });
});
