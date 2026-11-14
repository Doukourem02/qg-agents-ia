import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Un même « bureau » pour chaque agent réel, et des compteurs réels dans la page privée.
const lire = (f: string) => readFileSync(`src/ui/${f}`, 'utf8');

describe('les bureaux des agents réels', () => {
  it('L, Light, Clara, Mafe, Luffy, Isaac, Zoro, Léa et Paul utilisent le même modèle « Le bureau de X »', () => {
    for (const [f, agent] of [['BureauL.tsx', 'L'], ['ReleveLight.tsx', 'light'], ['BureauClara.tsx', 'clara'], ['BureauMafe.tsx', 'mafe'], ['BureauLuffy.tsx', 'luffy'], ['BureauIsaac.tsx', 'isaac'], ['BureauZoro.tsx', 'zoro'], ['BureauLea.tsx', 'lea'], ['BureauPaul.tsx', 'paul'], ['BureauYe.tsx', 'ye'], ['BureauFeu.tsx', 'feu']]) {
      expect(lire(f)).toContain(`<BureauAgent agent="${agent}"`);
      expect(lire(f)).not.toMatch(/<h2/);
    }
    const shell = lire('BureauAgent.tsx').split('export function BureauAgent')[1];
    const ordre = ['Le bureau de {nom}', 'Dernier passage', 'Prochain passage', 'Ce qui t’attend', 'Son travail', 'Son journal'].map(t => shell.indexOf(t));
    expect(ordre.every(i => i > 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    for (const f of ['Panels.tsx', 'ReleveLight.tsx', 'BureauAgent.tsx']) expect(lire(f)).not.toContain('Le relevé de Light');
    expect(lire('Panels.tsx')).toContain('Le bureau de {a.nom}');
  });
  it('Mafe : bureau enregistré, jamais de pourcentage, monté hors /demo seulement', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauMafe'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'mafe'");
    expect(lire('BureauMafe.tsx')).not.toMatch(/%|pourcent/i);
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauMafe />}');
    expect(lire('OngletsReels.tsx')).toContain("['mafe', 'Mafe']");
  });
  it('Luffy : bureau enregistré, rien de technique, monté hors /demo seulement', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauLuffy'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'luffy'");
    expect(lire('BureauLuffy.tsx')).not.toMatch(/raison|erreur \d|HTTP/i);
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauLuffy />}');
    expect(lire('OngletsReels.tsx')).toContain("['luffy', 'Luffy']");
  });
  it('Isaac : bureau enregistré, ni chemin ni cibles, monté hors /demo seulement', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauIsaac'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'isaac'");
    expect(lire('BureauIsaac.tsx')).not.toMatch(/cibles|chemin|\.id\b/i);
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauIsaac />}');
    expect(lire('OngletsReels.tsx')).toContain("['isaac', 'Isaac']");
  });
  it('Zoro : bureau enregistré, monté hors /demo seulement, « Vérifier maintenant » fait POST /api/zoro, états illisibles en clair', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauZoro'");
    expect(readFileSync('src/store.ts', 'utf8')).toContain("zoro: 'bureauZoro'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'zoro'");
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauZoro />}');
    expect(lire('OngletsReels.tsx')).toContain("['zoro', 'Zoro']");
    const z = lire('BureauZoro.tsx');
    expect(z).toContain('<BureauAgent agent="zoro"');
    expect(z).toContain("fetch('/api/zoro', { method: 'POST'");
    expect(z).toContain('Vérifier maintenant');
    expect(z).toContain('non lu');
    expect(z).toContain('illisible');
    expect(z).toContain('Mac pas vu depuis');
    expect(z).not.toMatch(/<h2|CVE|OSV|\bCI\b(?!\/)/);
    // les mots « non lu » du serveur sont comparés exactement (etiquette.ts), jamais par leur début
    expect(z).not.toContain("startsWith('GitHub')");
    expect(z).toContain('estMotNonLu(m)');
  });
  it('Zoro : la page n\'embarque aucun code serveur (vue.ts en import de type seulement, etiquette.ts sans import de valeur)', () => {
    const z = lire('BureauZoro.tsx');
    expect(z).not.toMatch(/^import (?!type)[^;]*from '@\/server\/zoro\/vue'/m);
    expect(z).toContain("import type { VueZoro } from '@/server/zoro/vue'");
    for (const l of z.split('\n').filter(l => /^import .*@\/server\//.test(l))) expect(l).toMatch(/^import type |zoro\/etiquette'/);
    const e = readFileSync('src/server/zoro/etiquette.ts', 'utf8');
    expect(e.split('\n').filter(l => /^import /.test(l)).every(l => l.startsWith('import type '))).toBe(true);
    expect(e).not.toMatch(/^export .* from /m);
  });
  it('Léa : bureau enregistré, monté hors /demo seulement, « Vu » fait POST /api/lea, la page n\'importe aucun code serveur', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauLea'");
    expect(readFileSync('src/store.ts', 'utf8')).toContain("lea: 'bureauLea'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'lea'");
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauLea />}');
    expect(lire('OngletsReels.tsx')).toContain("['lea', 'Léa']");
    const l = lire('BureauLea.tsx');
    expect(l).toContain('<BureauAgent agent="lea"');
    expect(l).toContain("fetch('/api/lea', { method: 'POST'");
    expect(l).toContain('JSON.stringify({ vu: id })');
    for (const t of ['À corriger', 'Petites remarques', 'Relectures récentes', 'Vu']) expect(l).toContain(t);
    expect(l).toContain('setInterval');
    expect(l).toContain('derniereSeule');
    expect(l).not.toMatch(/<h2/);
    // le client ne tire que le fichier d'étiquettes et des types : jamais relecture.ts, vue.ts, ni le KV
    const imports = [...l.matchAll(/^import (type )?.* from '(@\/server\/[^']+)'/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1] || m[2] === '@/server/lea/etiquette').toBeTruthy();
    const e = readFileSync('src/server/lea/etiquette.ts', 'utf8');
    expect([...e.matchAll(/^import .* from '([^']+)'/gm)].every(m => /^import type /.test(m[0]))).toBe(true);
  });
  it('Ye : bureau enregistré, monté hors /demo seulement, Valider/Refuser/Oui/Non font POST /api/ye, la page n\'importe aucun code serveur', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("ye: 'bureauYe'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'ye'");
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauYe />}');
    expect(lire('QGApp.tsx').match(/<BureauYe/g)).toHaveLength(1);
    expect(lire('OngletsReels.tsx')).toContain("['ye', 'Ye']");
    const y = lire('BureauYe.tsx');
    expect(y).toContain('<BureauAgent agent="ye"');
    expect(y).toContain("fetch('/api/ye', {");
    for (const t of ['À valider', 'Questions de compétences', 'Avant', 'Après', 'Valider', 'Refuser', 'Oui, je l’ajoute', 'Non', 'Publiées récemment', 'Refusées par le QG', 'sans lien GitHub']) expect(y).toContain(t);
    expect(y).not.toMatch(/<h2/);
    const imports = [...y.matchAll(/^import (type )?.* from '(@\/server\/[^']+)'/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1] || m[2] === '@/server/ye/etiquette').toBeTruthy();
    const e = readFileSync('src/server/ye/etiquette.ts', 'utf8');
    expect([...e.matchAll(/^import .* from '([^']+)'/gm)].every(m => /^import type /.test(m[0]))).toBe(true);
  });
  it('Feu : bureau enregistré, monté hors /demo seulement, lecture seule de /api/feu, chaque prix avec son heure, la page n\'importe que du code pur', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("feu: 'bureauFeu'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'feu'");
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauFeu />}');
    expect(lire('QGApp.tsx').match(/<BureauFeu/g)).toHaveLength(1);
    expect(lire('OngletsReels.tsx')).toContain("['feu', 'Feu']");
    const f = lire('BureauFeu.tsx');
    expect(f).toContain('<BureauAgent agent="feu"');
    expect(f).toContain("fetch('/api/feu', { cache: 'no-store' })");
    expect(f).not.toMatch(/method: 'POST'/);
    for (const t of ['Le marché', 'Plan d’ordres en cours', 'Ton compte', 'Positions en cours', 'Journal', 'Niveaux surveillés', 'Prochaines annonces', 'L’analyse et l’actualité du jour', 'pas encore créée', 'lu à {hhmm(s.lu)} UTC', 'Solde vu à']) expect(f).toContain(t);
    const permis = ['@/server/feu/etiquette', '@/server/feu/types', '@/server/feu/indicateurs', '@/server/feu/messages'];
    for (const m of f.matchAll(/^import (type )?.* from '(@\/server\/[^']+)'/gm)) expect(permis, m[2]).toContain(m[2]);
    for (const pur of ['indicateurs', 'messages', 'etiquette', 'types']) {
      const e = readFileSync(`src/server/feu/${pur}.ts`, 'utf8');
      expect([...e.matchAll(/^import .* from '([^']+)'/gm)].every(m => /^import type /.test(m[0]) || /from '\.\/(indicateurs|types)'/.test(m[0])), pur).toBe(true);
    }
    const lecteurs = ['src/ui/QGApp.tsx', 'src/ui/OngletsReels.tsx', 'src/ui/Panels.tsx', 'src/ui/Cerveau.tsx', 'src/sim/engine.ts'].filter(x => readFileSync(x, 'utf8').includes('/api/feu'));
    expect(lecteurs).toEqual([]);
  });
  it('Paul : bureau enregistré, monté hors /demo seulement, Valider/Refuser font POST /api/paul, la page n\'importe aucun code serveur', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("'bureauPaul'");
    expect(readFileSync('src/store.ts', 'utf8')).toContain("paul: 'bureauPaul'");
    expect(readFileSync('src/data/reels.ts', 'utf8')).toContain("'paul'");
    expect(lire('QGApp.tsx')).toContain('{!demo && <BureauPaul />}');
    expect(lire('QGApp.tsx').match(/<BureauPaul/g)).toHaveLength(1);
    expect(lire('OngletsReels.tsx')).toContain("['paul', 'Paul']");
    const p = lire('BureauPaul.tsx');
    expect(p).toContain('<BureauAgent agent="paul"');
    expect(p).toContain("fetch('/api/paul', {");
    expect(p).toContain('JSON.stringify(valider ? { valider: id } : { refuser: id })');
    for (const t of ['À valider', 'Valider', 'Refuser', 'Appliquées récemment', 'Refusées par le QG', 'proposition refusée par le QG', 'Le bloc tel qu’il sera écrit', 'vue.echec']) expect(p).toContain(t);
    expect(p).toContain('setInterval');
    expect(p).toContain('derniereSeule');
    expect(p).not.toMatch(/<h2/);
    // le client ne tire que le fichier d'étiquettes et des types : jamais lot.ts, rapport.ts, ecriture.ts, vue.ts, ni le KV
    const imports = [...p.matchAll(/^import (type )?.* from '(@\/server\/[^']+)'/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1] || m[2] === '@/server/paul/etiquette').toBeTruthy();
    const e = readFileSync('src/server/paul/etiquette.ts', 'utf8');
    expect([...e.matchAll(/^import .* from '([^']+)'/gm)].every(m => /^import type /.test(m[0]))).toBe(true);
  });
  it('?bureau= : lu une fois au montage, ignoré en /demo, valeurs inconnues sans effet', () => {
    const app = lire('QGApp.tsx');
    expect(app).toContain('window.location.search');
    expect(app).toContain("get('bureau')");
    expect(app).toContain('BUREAU_PAR_AGENT');
    expect(app).toMatch(/if \(demo\) return;/);
    expect(lire('Panels.tsx')).toContain('BUREAU_PAR_AGENT');
    expect(lire('OngletsReels.tsx')).toContain('BUREAU_PAR_AGENT');
  });
  it('compteur en haut à droite : en service · en tâche hors /demo (compteur.ts) ; l’onglet Tâches compte ce qui m’attend', () => {
    const app = lire('QGApp.tsx');
    expect(app).toContain("demo ? `${count} en cours` : (reels ?? '…')");
    expect(app).toContain('texteCompteur(compteur(s.vues))');
    expect(app).toContain('s.vues?.taches.enAttente.length');
  });
  it('page privée : la simulation ne fait pas parler les vrais agents', () => {
    expect(readFileSync('src/store.ts', 'utf8')).toContain("muets: vif ? [] : [...AGENTS_REELS, 'stalker']");
  });
});

describe('pièces : aucun chiffre de la simulation dans la page privée', () => {
  it('le calque et le panneau des pièces passent par etiquettesPieces ; ON AIR seulement dans /demo', () => {
    expect(lire('Overlay.tsx')).toContain('etiquettesPieces(sim, demo, enAttente, salle)');
    expect(readFileSync('src/scene/World.tsx', 'utf8')).toContain('onAirAllume(s.demo, s.snap?.studioOn)');
    expect(lire('Panels.tsx')).toContain('etiquettesPieces(sim, demo, enAttente, salle)[id]');
    expect(readFileSync('src/store.ts', 'utf8')).toContain('prive: !vif');
  });
});

describe('barre d’outils (décision du 11 novembre 2026)', () => {
  it('toutes les icônes en couleur ; les outils en service s’allument en vague ; l’outil en tâche figé (page privée)', () => {
    const app = readFileSync('src/ui/QGApp.tsx', 'utf8');
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(app).not.toContain('qg-tool-eteint');
    expect(css).not.toContain('qg-tool-eteint');
    expect(app).toContain("const lit = useQG(s => (s.demo ? s.snap?.lit : undefined));");
    expect(app).toContain("'qg-tool-service'");
    expect(app).toContain('allumesVague(n, etape)');
    expect(css).toMatch(/\.qg-tool-service \{[^}]*#ffd84a/);
    expect(css).not.toContain('qg-service 2.4s');
    // le contour de la vague doit l'emporter sur le contour transparent au repos (même poids que « .qg-vague .qg-tool »)
    expect(css).toMatch(/\.qg-vague \.qg-tool-service \{[^}]*#ffd84a/);
  });
});
