import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Engine } from './engine';
import { estJour, presentLaNuit, PRESENCE_MAX, TRAVAIL_MAX } from './horaire';
import { AGENTS_REELS } from '@/data/reels';

const MIN = 60_000;
const a = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);

describe('estJour : l\'heure d\'Abidjan (UTC)', () => {
  it('ouvert de 07:00 à 19:59, fermé de 20:00 à 06:59', () => {
    expect(estJour(a(6, 59))).toBe(false);
    expect(estJour(a(7))).toBe(true);
    expect(estJour(a(13))).toBe(true);
    expect(estJour(a(19, 59))).toBe(true);
    expect(estJour(a(20))).toBe(false);
    expect(estJour(a(0))).toBe(false);
  });
});

describe('presentLaNuit', () => {
  const now = a(23);
  const v = (travail: Record<string, number>, luffyVeille = false) => ({ travail: new Map(Object.entries(travail)), luffyVeille, now });
  it('personne par défaut : ni figurants, ni agents simulés, ni Luffy endormi', () => {
    for (const id of ['fig0', 'barista', 'guichetier', 'couloir', 'kuroro', 'tom', 'luffy', 'stalker', 'L']) expect(presentLaNuit(id, v({})), id).toBe(false);
  });
  it('Luffy, le veilleur de nuit, seulement s\'il veille', () => {
    expect(presentLaNuit('luffy', v({}, true))).toBe(true);
  });
  it('un vrai agent pendant qu\'il travaille vraiment (moins de 30 min)', () => {
    expect(presentLaNuit('clara', v({ clara: now - 5 * MIN }))).toBe(true);
    expect(presentLaNuit('clara', v({ clara: now - TRAVAIL_MAX }))).toBe(false);
  });
  it('Stalker tant que Claude Code a donné signe depuis moins de 15 min', () => {
    expect(presentLaNuit('stalker', v({ stalker: now - 14 * MIN }))).toBe(true);
    expect(presentLaNuit('stalker', v({ stalker: now - PRESENCE_MAX }))).toBe(false);
  });
  it('un agent simulé n\'est jamais là la nuit, même avec un état écrit', () => {
    expect(presentLaNuit('obito', v({ obito: now }))).toBe(false);
  });
});

describe('Engine la nuit', () => {
  const prive = () => new Engine('calme', { muets: [...AGENTS_REELS, 'stalker'], prive: true });
  it('le jour, tout le monde est là ; la nuit, le bureau est vide et personne ne circule', () => {
    const e = prive();
    expect(e.agents.every(x => e.present(x.id))).toBe(true);
    for (let i = 0; i < 200; i++) e.tick(0.1);
    e.setNuit(true);
    e.tick(0.1);
    expect(e.agents.filter(x => e.present(x.id))).toEqual([]);
    expect(e.agents.every(x => e.atHome(x) && !x.path.length)).toBe(true);
    for (let i = 0; i < 300; i++) e.tick(0.1);
    const s = e.snapshot();
    expect(s.count).toBe(0);
    expect(s.bubbles).toEqual([]);
    expect(s.studioOn).toBe(false);
  });
  it('la nuit : Luffy s\'il veille, un vrai agent pendant son travail puis il rentre, Stalker pendant Claude Code', () => {
    const e = prive();
    e.setNuit(true);
    e.setLuffyVeille(true);
    const now = Date.now();
    e.appliquerReel({
      clara: { statut: 'au travail', tache: 'met des mails à la corbeille', quand: now - MIN },
      stalker: { statut: 'au travail', tache: 'travaille avec toi sur QG', quand: now - MIN },
      obito: { statut: 'au travail', tache: 'invente', quand: now },
    }, now);
    const la = () => e.agents.filter(x => e.present(x.id)).map(x => x.id).sort();
    expect(la()).toEqual(['clara', 'luffy', 'stalker']);
    expect(e.snapshot().count).toBe(3);
    // Clara a fini : elle rentre ; Claude Code se tait : Stalker part après 15 min
    e.appliquerReel({ clara: { statut: 'termine', tache: 'mails à la corbeille', quand: now } }, now);
    expect(e.present('clara')).toBe(false);
    expect(e.present('stalker', now + 15 * MIN)).toBe(false);
    e.setLuffyVeille(false);
    expect(la()).toEqual(['stalker']);
    // le matin, tout le monde revient
    e.setNuit(false);
    expect(e.agents.every(x => e.present(x.id))).toBe(true);
  });
});

describe('Engine la nuit : l\'agent d\'astreinte', () => {
  const prive = () => new Engine('calme', { muets: [...AGENTS_REELS, 'stalker'], prive: true });
  it('reste à son poste avec une bulle « d\'astreinte », sans devenir « au travail »', () => {
    const e = prive();
    e.setNuit(true);
    e.setAstreinte('isaac');
    expect(e.agents.filter(x => e.present(x.id)).map(x => x.id)).toEqual(['isaac']);
    const b = e.snapshot().bubbles;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ agentId: 'isaac', text: "d'astreinte" });
    expect(e.travail.has('isaac')).toBe(false);
    expect(e.snapshot().reels).not.toContain('isaac');
    e.setNuit(false);
    expect(e.snapshot().bubbles.some(x => x.text === "d'astreinte")).toBe(false);
  });
});

describe('les réglages : la page privée suit l\'heure, /demo garde ses deux moments', () => {
  const app = readFileSync(new URL('../ui/QGApp.tsx', import.meta.url), 'utf8');
  const reglages = app.slice(app.indexOf('function Reglages'), app.indexOf('function Calque'));
  it('page privée : l’étiquette jour / nuit, et de jour seulement le choix « Moment calme » / « Pleine journée »', () => {
    // le titre suit le moment de la journée (journee.ts), « Nuit · bureau fermé » la nuit
    expect(reglages).toContain('TITRES[moment].titre');
    expect(reglages).toContain("s.nuit ? 'nuit'");
    expect(reglages).toMatch(/\{!nuit && \([\s\S]*?Moment calme[\s\S]*?Pleine journée/);
    // chaque réglage tient sur une ligne (« remettre en place » ne passe plus à la ligne)
    expect(reglages.match(/whitespace-nowrap/g)?.length).toBeGreaterThanOrEqual(4);
  });
  it('changer de moment recrée la simulation : la nuit, la veille de Luffy, l’astreinte et la réunion de crise lui sont aussitôt redonnées', () => {
    expect(app).toMatch(/function useJourNuit[\s\S]*?\}, \[demo, version\]\);[\s\S]*?\[demo, luffyVeille, astreinte, reunion, version\]/);
  });
  it('/demo : les deux moments restent au choix (?moment=pleine), sans jour ni nuit', () => {
    expect(app).toContain("setDemo(q.get('moment') === 'pleine' ? 'pleine' : 'calme')");
    expect(app).toMatch(/function useJourNuit\(demo: boolean\)[\s\S]*?if \(demo\) return;/);
  });
});
