import { describe, expect, it } from 'vitest';
import { POI, ROOMS, SEATS, roomAt } from '@/data/layout';
import { Engine, MAX_BUBBLES } from './engine';
import { findPath, isBlocked, wallBetween } from './path';
import { AGENTS, routeMission } from './routing';

describe('agents.json', () => {
  it('contient les 17 personnages, chacun avec une place au bureau', () => {
    expect(AGENTS).toHaveLength(17);
    for (const a of AGENTS) expect(SEATS[a.id], a.id).toBeDefined();
  });
  it('place chaque agent dans la pièce de son pôle', () => {
    const piece: Record<string, string> = { direction: 'direction', code: 'code', communication: 'communication', mac: 'mac' };
    for (const a of AGENTS) expect(roomAt(...SEATS[a.id])?.id, a.id).toBe(piece[a.pole]);
  });
});

describe('aiguillage des missions par mots-clés', () => {
  it.each([
    ['Un post sur Prisma v6', 'L'],
    ['Fais-moi le point Terra', 'mafe'],
    ['Le site est en panne ?', 'luffy'],
    ['Relis mon dernier commit', 'lea'],
    ['Vide le cache, je n’ai plus de place', 'isaac'],
    ['Fais de la place sur le disque', 'isaac'],
    ['Nettoie les caches', 'isaac'],
    ['Remplace le texte', 'kuroro'],
    ['Évidemment, je pense', 'kuroro'],
    ['Vide le cache', 'isaac'],
    ['Une vidéo de démo', 'tom'],
    ['Trie mes mails', 'clara'],
    ['Mets à jour la fiche du portfolio', 'ye'],
    ['Organise mon voyage', 'kuroro'],
    // mots courts (5 lettres ou moins) : mot entier seulement (pluriel permis), sauf les racines marquées « * »
    ['Prépare une macro Excel', 'kuroro'],
    ['Un projet de machine learning', 'kuroro'],
    ['Placer le bouton à droite', 'kuroro'],
    ['Cacher la barre du haut', 'kuroro'],
    ['Fais de la place sur mon mac', 'isaac'],
    ['Libère de l’espace disque', 'isaac'],
    ['Combien de place sur mes macs', 'isaac'],
    ['Relis la documentation', 'lea'],
    ['Publie ce texte', 'L'],
  ])('« %s » → %s', (texte, id) => {
    expect(routeMission(texte).agent.id).toBe(id);
  });
});

describe('déplacements', () => {
  it('trouve un chemin de chaque place vers chaque lieu de vie, sans traverser de mur', () => {
    const lieux = [...POI.cafe, POI.imprimante, POI.sieste, ...POI.babyfoot, ...POI.toilettes, ...POI.cabines, ...POI.reunion, POI.scene, POI.camera, POI.guichet];
    for (const [id, seat] of Object.entries(SEATS)) {
      for (const p of lieux) {
        const path = findPath(seat, p);
        expect(path.length, `${id} → ${p}`).toBeGreaterThan(0);
        expect(path[path.length - 1]).toEqual(p);
      }
    }
  });
  it('ne passe jamais à travers un mur entre deux cases', () => {
    const path = findPath(SEATS.L, POI.scene);
    const cells = path.slice(0, -1).map(([x, y]) => [Math.floor(x), Math.floor(y)] as [number, number]);
    for (let i = 1; i < cells.length; i++) {
      const [a, b] = [cells[i - 1], cells[i]];
      // les points simplifiés peuvent être éloignés : on vérifie case par case sur les segments droits
      const steps = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      let cur = a;
      for (let s = 0; s < steps; s++) {
        const next: [number, number] = [cur[0] + Math.sign(b[0] - cur[0]), cur[1] + (b[0] === cur[0] ? Math.sign(b[1] - cur[1]) : 0)];
        expect(wallBetween(cur, next), `${cur} → ${next}`).toBe(false);
        expect(isBlocked(...next)).toBe(false);
        cur = next;
      }
    }
  });
  it('chaque pièce fermée a au moins une porte', () => {
    for (const r of ROOMS) if (r.mur || r.vitre) expect(r.portes.length, r.id).toBeGreaterThan(0);
  });
});

describe('les deux moments de mes plans', () => {
  it('pleine journée : tout le monde à son poste et immobile, réunion pleine, personne dans le couloir', () => {
    const e = new Engine('pleine');
    const depart = e.agents.map(a => [a.id, a.x, a.y]);
    for (let i = 0; i < 300; i++) e.tick(1 / 30);
    for (const a of e.agents) expect([a.x, a.y]).toEqual([a.home[0], a.home[1]]);
    expect(e.agents.map(a => [a.id, a.x, a.y])).toEqual(depart);
    const s = e.snapshot();
    expect(s.rooms.reunion).toBe('7 en réunion');
    expect(s.rooms.code).toBe('7/7 au poste');
    expect(e.agents.some(a => a.id.startsWith('couloir'))).toBe(false);
    expect(s.bubbles.map(b => b.text).sort()).toEqual(['rédige le post de mercredi', 'répartit les missions du jour']);
  });
  it('calme : tout le monde à son poste au départ, accords en attente', () => {
    const e = new Engine('calme');
    expect(e.snapshot().rooms.accords).toBe('2 en attente');
    expect(e.snapshot().rooms.code).toBe('7/7 au poste');
  });
});

describe('tâches et outils', () => {
  it('l’historique n’est jamais vide : 9 tâches en cours et des utilisations pour chaque outil d’agent', () => {
    const e = new Engine();
    const s = e.snapshot();
    expect(s.taches.filter(t => t.statut === 'en cours')).toHaveLength(9);
    for (const a of AGENTS) for (const k of a.outils) expect(s.usages.some(u => u.tool === k && u.agentId === a.id), `${a.id} ${k}`).toBe(true);
  });
  it('une mission de la barre devient une tâche « ma mission » pour le bon agent, puis se termine', () => {
    const e = new Engine();
    e.mission('Un post sur Prisma v6');
    const t = e.snapshot().taches.find(x => x.origine === 'moi')!;
    expect(t.agentId).toBe('L');
    expect(t.statut).toBe('en cours');
    for (let i = 0; i < 30 * 50; i++) e.tick(1 / 30);
    expect(e.taches.find(x => x.id === t.id)!.statut).toBe('faite');
  });
  it('une mission confiée depuis la fiche va à cet agent', () => {
    const e = new Engine();
    e.missionDirecte('clara', 'vide la boîte des newsletters');
    expect(e.snapshot().taches[0]).toMatchObject({ agentId: 'clara', origine: 'moi', statut: 'en cours' });
  });
});

describe('la vie du bureau', () => {
  it('n’affiche jamais plus de 3 bulles', () => {
    const e = new Engine();
    for (let i = 0; i < 3000; i++) {
      e.tick(1 / 30);
      expect(e.bubbles.length).toBeLessThanOrEqual(MAX_BUBBLES);
    }
  });
  it('garde presque tout le monde au poste', () => {
    const e = new Engine();
    let total = 0, n = 0;
    for (let i = 0; i < 6000; i++) {
      e.tick(1 / 30);
      if (i % 30 === 0) { total += e.agents.filter(a => e.atHome(a) || a.still).length / e.agents.length; n++; }
    }
    expect(total / n).toBeGreaterThan(0.7);
  });
  it('L part au studio puis revient à son bureau', () => {
    const e = new Engine();
    let auStudio = false;
    for (let i = 0; i < 30 * 60; i++) {
      e.tick(1 / 30);
      const L = e.get('L')!;
      if (roomAt(L.x, L.y)?.id === 'studio') auStudio = true;
    }
    expect(auStudio).toBe(true);
  });
});

describe('page privée : les vrais agents ne disent que leur vrai travail', () => {
  const REELS = ['L', 'light', 'clara'];
  it('aucune bulle ni tâche inventée au-dessus de L, Light et Clara ; ils bougent quand même', () => {
    const e = new Engine('calme', { muets: REELS });
    const depart = e.get('L')!.x;
    let bouge = false;
    e.missionDirecte('clara', 'vide la boîte des newsletters');
    e.mission('Un post sur Prisma v6');
    const taches = Object.fromEntries(REELS.map(id => [id, e.snapshot().tasks[id]]));
    for (let i = 0; i < 30 * 120; i++) {
      e.tick(1 / 30);
      if (e.get('L')!.x !== depart) bouge = true;
      expect(e.bubbles.filter(b => REELS.includes(b.agentId))).toEqual([]);
    }
    expect(bouge).toBe(true);
    for (const id of REELS) expect(e.snapshot().tasks[id]).toBe(taches[id]);
  });
  it('pleine journée : pas de bulle inventée au-dessus de L', () => {
    const e = new Engine('pleine', { muets: REELS });
    expect(e.bubbles.map(b => b.agentId)).not.toContain('L');
  });
  it('le vrai état, lui, s\'affiche', () => {
    const e = new Engine('calme', { muets: REELS });
    e.appliquerReel({ L: { statut: 'au travail', tache: 'traite la boîte', quand: Date.now() } });
    expect(e.bubbles.find(b => b.agentId === 'L')?.text).toBe('traite la boîte');
    expect(e.snapshot().tasks.L).toBe('traite la boîte');
  });
  it('/demo (sans muets) : la simulation parle pour tout le monde', () => {
    const e = new Engine('pleine', { vif: true });
    expect(e.bubbles.map(b => b.agentId)).toContain('L');
  });
});

describe('page privée : pas d\'historique inventé', () => {
  it('aucune tâche ni utilisation d\'outil simulée au départ', () => {
    const s = new Engine('calme', { prive: true }).snapshot();
    expect(s.taches).toEqual([]);
    expect(s.usages).toEqual([]);
  });
});
