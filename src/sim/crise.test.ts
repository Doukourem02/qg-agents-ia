import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEETING_SEATS, roomAt } from '@/data/layout';
import { etiquettesPieces } from '@/data/pieces';
import type { ReunionScene, Sujet } from '@/data/crise';
import { AGENTS_REELS } from '@/data/reels';
import { Engine } from './engine';

// La salle de réunion suit une vraie réunion de crise (page privée) ; /demo n'en a jamais.
const MIN = 60_000;
const a = (h: number, m: number) => Date.UTC(2026, 10, 12, h, m);
const livreo: Sujet = { cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: a(14, 2), grave: true };
const scene = (o: Partial<ReunionScene> = {}): ReunionScene => ({
  id: String(a(14, 5)), niveau: 'incident', debut: a(14, 5), sujets: [livreo], vus: [livreo], agents: ['luffy'], vu: a(14, 5),
  relances: { 'site:api-livreo': a(14, 10) }, ...o,
});
const prive = () => new Engine('calme', { muets: [...AGENTS_REELS, 'stalker'], prive: true, heure: Date.now() });
const avancer = (e: Engine, s: number) => { for (let i = 0; i < s * 20; i++) e.tick(0.05); };
const enSalle = (e: Engine, id: string) => roomAt(e.get(id)!.x, e.get(id)!.y)?.id === 'reunion';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('la salle de réunion pendant une vraie réunion de crise', () => {
  it('au début, les participants y vont vraiment ; la salle dit le vrai problème ; les bulles aussi', () => {
    vi.setSystemTime(a(14, 6));
    const e = prive();
    e.setReunion(scene());
    avancer(e, 40);
    for (const id of ['kuroro', 'stalker', 'luffy']) expect(enSalle(e, id), id).toBe(true);
    const places = ['kuroro', 'stalker', 'luffy'].map(id => [e.get(id)!.x, e.get(id)!.y].join());
    expect(places).toEqual(MEETING_SEATS.slice(0, 3).map(p => p.join()));
    const snap = e.snapshot();
    expect(snap.salle).toBe('Incident · Livreo en panne depuis 4 min');
    expect(etiquettesPieces(snap.rooms, false, 0, snap.salle).reunion).toBe('Incident · Livreo en panne depuis 4 min');
    expect(snap.bubbles.map(b => [b.agentId, b.text])).toEqual(expect.arrayContaining([
      ['luffy', 'API Livreo : 503 depuis 14:02'], ['kuroro', 'Luffy revérifie dans 4 min'],
    ]));
  });

  it('entre deux points, chacun retourne à son poste ; à xx:30, ils reviennent', () => {
    vi.setSystemTime(a(14, 6));
    const e = prive();
    e.setReunion(scene());
    avancer(e, 40);
    vi.setSystemTime(a(14, 20));
    avancer(e, 40);
    for (const id of ['stalker', 'luffy']) expect(e.atHome(e.get(id)!), id).toBe(true);
    expect(enSalle(e, 'kuroro')).toBe(false);
    vi.setSystemTime(a(14, 30));
    avancer(e, 40);
    for (const id of ['kuroro', 'stalker', 'luffy']) expect(enSalle(e, id), id).toBe(true);
  });

  it('un vrai agent en vraie tâche reste à son poste', () => {
    vi.setSystemTime(a(14, 6));
    const e = prive();
    e.appliquerReel({ luffy: { statut: 'au travail', tache: 'vérifie les sites', quand: a(14, 5) } }, a(14, 6));
    e.setReunion(scene());
    avancer(e, 40);
    expect(e.atHome(e.get('luffy')!)).toBe(true);
    expect(enSalle(e, 'stalker')).toBe(true);
  });

  it('la nuit : Kuroro et l’agent d’astreinte, présents et en salle ; personne d’autre', () => {
    vi.setSystemTime(Date.UTC(2026, 10, 12, 23, 3));
    const e = prive();
    e.setNuit(true);
    e.setAstreinte('clara');
    e.setReunion(scene({ debut: Date.UTC(2026, 10, 12, 23, 2), sujets: [{ ...livreo, depuis: Date.UTC(2026, 10, 12, 22, 50) }] }));
    avancer(e, 40);
    expect(enSalle(e, 'kuroro')).toBe(true);
    expect(enSalle(e, 'clara')).toBe(true);
    expect(e.present('stalker')).toBe(false);
    expect(enSalle(e, 'stalker')).toBe(false);
  });

  it('Pleine journée : les figurants de la salle laissent la place à la vraie réunion', () => {
    vi.setSystemTime(a(14, 6));
    const e = new Engine('pleine', { muets: [...AGENTS_REELS, 'stalker'], prive: true });
    expect(e.present('reu0')).toBe(true);
    e.setReunion(scene());
    avancer(e, 1);
    expect(e.present('reu0')).toBe(false);
    expect(enSalle(e, 'kuroro')).toBe(true);
  });

  it('après le débrief, plus rien : la salle redevient comme avant', () => {
    vi.setSystemTime(a(14, 41));
    const e = prive();
    e.setReunion(scene({ fin: a(14, 40), sujets: [], vus: [{ ...livreo, regle: a(14, 40) }] }));
    avancer(e, 40);
    expect(enSalle(e, 'stalker')).toBe(true);
    expect(e.snapshot().salle).toBe('Incident · débrief · Livreo revenu');
    vi.setSystemTime(a(14, 40) + 5 * MIN);
    avancer(e, 40);
    expect(e.snapshot().salle).toBeNull();
    expect(e.atHome(e.get('stalker')!)).toBe(true);
  });

  it('sans réunion : rien ne change, aucune salle de crise', () => {
    vi.setSystemTime(a(14, 6));
    const e = prive();
    e.setReunion(null);
    avancer(e, 5);
    expect(e.snapshot().salle).toBeNull();
  });
});

describe('/demo : jamais de réunion de crise', () => {
  it('la simulation de /demo ignore toute réunion qu’on lui donnerait', () => {
    vi.setSystemTime(a(14, 6));
    const e = new Engine('calme', { vif: true, heure: Date.now() });
    e.setReunion(scene());
    avancer(e, 40);
    expect(e.reunion).toBeNull();
    expect(e.snapshot().salle).toBeNull();
    expect(e.snapshot().bubbles.some(b => b.text.includes('Livreo'))).toBe(false);
  });
  it('les étiquettes de /demo restent celles de la simulation', () => {
    expect(etiquettesPieces({ reunion: '2 en réunion' }, true, 0, 'Incident · Livreo en panne depuis 4 min').reunion).toBe('2 en réunion');
  });
});
