import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Le relevé montre de vrais noms : il ne doit jamais être monté dans /demo, la page qui se filme.
describe('panneau de Light', () => {
  it('n\'est monté que hors /demo', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <ReleveLight />}');
    expect(src.match(/<ReleveLight/g)).toHaveLength(1);
  });
  it('le bureau de Mafe (vrais noms de projets) n\'est monté que hors /demo', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauMafe />}');
    expect(src.match(/<BureauMafe/g)).toHaveLength(1);
  });
  it('le bureau de Luffy (vrais sites) n\'est monté que hors /demo', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauLuffy />}');
    expect(src.match(/<BureauLuffy/g)).toHaveLength(1);
  });
  it('le bureau d\'Isaac (le Mac du patron) n\'est monté que hors /demo', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauIsaac />}');
    expect(src.match(/<BureauIsaac/g)).toHaveLength(1);
  });
  it('le bureau de Ye (vraies fiches du portfolio) n\'est monté que hors /demo ; /api/ye lu par lui seul ; aucun nom de projet dans la simulation', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauYe />}');
    expect(src.match(/<BureauYe/g)).toHaveLength(1);
    const lecteurs = ['src/ui/QGApp.tsx', 'src/ui/OngletsReels.tsx', 'src/ui/Panels.tsx', 'src/ui/Cerveau.tsx', 'src/sim/engine.ts'].filter(f => readFileSync(f, 'utf8').includes('/api/ye'));
    expect(lecteurs).toEqual([]);
    const simulation = [readFileSync('src/sim/engine.ts', 'utf8'), readFileSync('src/data/agents.json', 'utf8')].join('\n');
    for (const nom of ['boutique-shop', 'Boutique Shop', 'mon_portfolio', 'PROJET_TERRA', 'app_livraison', 'BotTrading', 'APP_PRO', 'mon-compte/']) expect(simulation).not.toContain(nom);
  });
  it('le bureau de Paul (vrais projets, README et CLAUDE.md) n\'est monté que hors /demo ; rien de ses projets dans la simulation', () => {
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauPaul />}');
    expect(src.match(/<BureauPaul/g)).toHaveLength(1);
    // /api/paul n'est lu que par son bureau ; /demo garde un Paul simulé, sans nom de projet
    const lecteurs = ['src/ui/QGApp.tsx', 'src/ui/OngletsReels.tsx', 'src/ui/Panels.tsx', 'src/ui/Cerveau.tsx', 'src/sim/engine.ts'].filter(f => readFileSync(f, 'utf8').includes('/api/paul'));
    expect(lecteurs).toEqual([]);
    const simulation = [readFileSync('src/sim/engine.ts', 'utf8'), readFileSync('src/data/agents.json', 'utf8')].join('\n');
    for (const nom of ['boutique-shop', 'mon_portfolio', 'PROJET_TERRA', 'app_livraison', 'BotTrading', 'APP_PRO', 'mon-compte/']) expect(simulation).not.toContain(nom);
  });
});

describe('Feu dans /demo : simulé, sans aucun chiffre réel', () => {
  it('son script ne dit aucun prix ni montant ; son bureau n\'est monté que hors /demo', () => {
    const engine = readFileSync('src/sim/engine.ts', 'utf8');
    const bloc = engine.slice(engine.indexOf('  feu: ['), engine.indexOf('],', engine.indexOf('  feu: [')));
    const dits = [...bloc.matchAll(/say: '([^']+)'/g)].map(m => m[1]);
    expect(dits.length).toBeGreaterThan(0);
    for (const d of dits) expect(d.replace(/\b(4h|1h|15m)\b/g, ''), d).not.toMatch(/\d|usdt|\$|€/i);
    const src = readFileSync('src/ui/QGApp.tsx', 'utf8');
    expect(src).toContain('{!demo && <BureauFeu />}');
  });
});
