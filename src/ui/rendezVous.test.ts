import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rendezVous } from './rendezVous';
import type { EtatAgent } from '@/server/vues';

// Au survol d'un vrai agent, sous son nom : son prochain rendez-vous, tiré de /api/qg/vues (heure d'Abidjan = UTC).
const now = Date.UTC(2026, 10, 11, 9, 41); // mercredi 11 novembre
const etat = (e: Partial<EtatAgent>): EtatAgent => ({ agent: 'light', nom: 'Light', statut: 'au repos', dernierPassage: null, prochainPassage: null, ...e });

describe('rendezVous', () => {
  it('le prochain passage : titre, jour (aujourd’hui, demain, sinon le jour court) et heure', () => {
    expect(rendezVous(etat({ prochainPassage: { quand: Date.UTC(2026, 10, 11, 17, 23), titre: 'Relevé des versions' } }), now)).toBe('prochain : Relevé des versions · aujourd’hui 17:23');
    expect(rendezVous(etat({ prochainPassage: { quand: Date.UTC(2026, 10, 12, 8, 0), titre: 'Relevé des versions' } }), now)).toBe('prochain : Relevé des versions · demain 08:00');
    expect(rendezVous(etat({ prochainPassage: { quand: Date.UTC(2026, 10, 16, 7, 0), titre: 'Propose 3 sujets de la semaine' } }), now)).toBe('prochain : Propose 3 sujets de la semaine · lun. 07:00');
  });
  it('un agent qui passe en continu : son rythme', () => {
    expect(rendezVous(etat({ rythme: 'toutes les 5 min' }), now)).toBe('toutes les 5 min');
    expect(rendezVous(etat({ rythme: 'toutes les heures' }), now)).toBe('toutes les heures');
  });
  it('bloqué avec une précision : la précision', () => {
    expect(rendezVous(etat({ statut: 'bloque', note: 'n’est pas passée depuis 3 h' }), now)).toBe('n’est pas passée depuis 3 h');
  });
  it('rien de connu : pas de deuxième ligne', () => {
    expect(rendezVous(etat({}), now)).toBeNull();
    expect(rendezVous(etat({ note: 'une note sans blocage' }), now)).toBeNull();
    expect(rendezVous(undefined, now)).toBeNull();
    expect(rendezVous(etat({ prochainPassage: { quand: now, titre: 'x' } }), undefined)).toBeNull();
  });
  it('côté page : aucun import serveur', () => {
    expect(readFileSync('src/ui/rendezVous.ts', 'utf8')).not.toMatch(/from '@\/server\/(?!vues')|server-only/);
  });
});

describe('le branchement', () => {
  const lire = (f: string) => readFileSync(f, 'utf8');
  it('le survol d’un vrai agent montre son rendez-vous, jamais dans /demo', () => {
    const o = lire('src/ui/Overlay.tsx');
    expect(o).toContain('rendezVous(');
    expect(o).toMatch(/demo \? null : rendezVous\(/);
  });
  it('?heure= ne vaut que pour /demo : la page privée suit toujours l’heure réelle', () => {
    const q = lire('src/ui/QGApp.tsx');
    const lecture = q.indexOf("get('heure')");
    expect(lecture).toBeGreaterThan(0);
    const avant = q.slice(0, lecture);
    expect(avant.slice(avant.lastIndexOf('function ')).startsWith('function useDemo(')).toBe(true);
    expect(q.split("get('heure')").length).toBe(2);
    expect(q).toContain("heureDeLaDemo(q.get('heure'))");
    // l'heure forcée ne vaut que si la page est /demo (prop demo), jamais sur la page privée
    expect(q).toMatch(/useQG\(s => \(demo \? s\.heureDemo \?\? HEURE_DEMO : null\)\)/);
  });
  it('les ombres des arbres restent dehors : chaque tache est découpée au bord du bâtiment, de son côté', () => {
    const n = lire('src/scene/Nature.tsx');
    expect(n).toContain('coteDehors(a.x, a.y, BATIMENT)');
    expect(n).toContain('clippingPlanes={plans}');
    expect(lire('src/scene/Scene.tsx')).toContain('localClippingEnabled = true');
  });
});
