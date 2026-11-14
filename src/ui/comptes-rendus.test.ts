import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lire = (f: string) => readFileSync(f, 'utf8');
const app = lire('src/ui/QGApp.tsx');
const menu = lire('src/ui/ComptesRendus.tsx');

describe('le menu d\'arrivée', () => {
  it('n\'est monté que hors /demo ; plus de bouton « Comptes rendus » à côté du compteur (13 novembre 2026)', () => {
    expect(app).toContain('{!demo && <ComptesRendus />}');
    expect(app.match(/<ComptesRendus/g)).toHaveLength(1);
    expect(app).not.toContain('BoutonComptesRendus');
    expect(menu).not.toContain('BoutonComptesRendus');
  });
  it('?arrivee=1 l\'ouvre, puis le paramètre est retiré de l\'adresse ; ignoré en /demo', () => {
    const hook = app.split('function useArriveeDansLUrl')[1].split('\n}\n')[0];
    expect(hook).toContain('if (demo) return;');
    expect(hook).toContain("searchParams.has('arrivee')");
    expect(hook).toContain("setArrivee(true)");
    expect(hook).toContain('history.replaceState');
    expect(hook).toContain("searchParams.delete('arrivee')");
    expect(app).toContain('useArriveeDansLUrl(demo);');
  });
  it('fermer enregistre la visite ; le vide se ferme seul après 4 s', () => {
    expect(menu).toContain("method: 'POST'");
    expect(menu).toContain('vu: true');
    expect(menu).toContain('Rien de nouveau, tout tourne.');
    expect(menu).toContain('setTimeout(() => fermer(true), 4000)');
  });
  it('les boutons, le personnage entier qui salue, les annonces une par une', () => {
    for (const t of ['Suivant →', '← Précédent', '← Tous', 'Son bureau', 'Terminer', 'PersonnageQuiSalue', "'wave1' : 'wave0'"]) expect(menu).toContain(t);
    expect(menu).not.toContain('👋');
    expect(menu).toMatch(/delay: 1 \+ i \* 0\.6/);
    expect(menu).toContain('saluer(agent)');
    expect(menu).not.toMatch(/HTTP|erreur \d/i);
  });
  it('la visite : jusqu\'à la liste vue, attendue puis relue ; « Voir son bureau » ne la note pas seul ; Échap ferme sans noter', () => {
    expect(menu).toContain('jusqua');
    expect(menu).toContain('await marquerVu(');
    expect(menu).toContain('res.ok');
    expect(menu).toContain('fermer(tousVus)');
    expect(menu).not.toContain('derniereSeule');
    const revenir = lire('src/store.ts').split('revenir: () =>')[2];
    expect(revenir.split('\n')[0]).toContain('arrivee: false');
  });
});
