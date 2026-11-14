import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tâches, Calendrier et Cerveau montrent de vraies données : jamais lues ni affichées dans /demo, la page qui se filme.
describe('onglets réels', () => {
  const app = readFileSync('src/ui/QGApp.tsx', 'utf8');
  const reels = readFileSync('src/ui/OngletsReels.tsx', 'utf8');
  const panels = readFileSync('src/ui/Panels.tsx', 'utf8');
  it('cachés dans la barre et dans le panneau en mode démo', () => {
    expect(app).toContain('!(demo && ONGLETS_REELS.includes(id))');
    expect(panels).toContain('!(demo && ONGLETS_REELS.includes(onglet))');
  });
  it('la lecture de /api/qg/vues ne part jamais en mode démo', () => {
    expect(app).toContain('useVuesQG(demo)');
    expect(reels).toMatch(/useEffect\(\(\) => \{\s*if \(demo\) return;/);
    expect(reels.match(/fetch\(/g)).toHaveLength(1);
  });
  it('Cerveau : écrit seulement sur un geste (aucune lecture à lui), en lecture seule dans /demo', () => {
    const cerveau = readFileSync('src/ui/Cerveau.tsx', 'utf8');
    expect(cerveau.match(/fetch\(/g)).toHaveLength(1);
    expect(cerveau).toContain("const lecture = useQG(s => s.demo);");
    expect(cerveau).not.toMatch(/useEffect\([^)]*fetch/);
    expect(cerveau).not.toMatch(/simulé|démo/i);
  });
  it('plus aucune donnée écrite à la main ni mot « simulé » / « démo » à l\'écran', () => {
    expect(panels).not.toMatch(/CERVEAU|SEMAINE|function Taches/);
    expect(app).not.toContain('snap?.taches');
    expect(reels).not.toMatch(/simulé|démo/i);
    expect(reels).not.toContain('WhatsApp');
  });
});

describe('fiche d\'un agent', () => {
  const panels = readFileSync('src/ui/Panels.tsx', 'utf8');
  it('« Dernières tâches » : le vrai journal pour L, Light et Clara ; sinon « Pas encore branché »', () => {
    expect(panels).toContain('Pas encore branché — aucune tâche réelle.');
    expect(panels).toContain('faites.filter(t => t.agent === id).slice(0, 5)');
    // les tâches de la simulation ne sont montrées que dans /demo
    expect(panels).toMatch(/\{demo\s*\n\s*\/\/[^\n]*\n\s*\? toutes\.filter/);
  });
  it('le code serveur n\'est jamais importé par la page (seulement des types)', () => {
    for (const f of ['src/ui/Panels.tsx', 'src/ui/OngletsReels.tsx', 'src/ui/Cerveau.tsx', 'src/store.ts']) {
      for (const l of readFileSync(f, 'utf8').split('\n').filter(x => x.includes("from '@/server/"))) expect(l).toMatch(/^import type /);
    }
  });
});
