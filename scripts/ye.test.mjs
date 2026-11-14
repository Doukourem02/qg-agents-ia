import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete, ecrireLisible, preparerRapport, viderDossier } from './ye.mjs';

// Un dossier « ye » dans un dossier temporaire : les tests n'écrivent jamais dans le vrai /tmp/ye.
const dossierYe = () => join(mkdtempSync(join(tmpdir(), 'ye-test-')), 'ye');
const lotExemple = () => ({
  lot: {
    id: 'lot-9', quand: 0, sansLien: 2, competences: [{ id: 'sk-next', name: 'Next.js' }],
    projets: [{
      depot: 'mon-compte/shop', branche: 'main', tete: 't', depuis: null, brouillon: false, enPartie: [],
      fiche: { id: 'fiche-shop', rev: 'r', titre: 'Boutique Shop', kind: 'Site', kindEn: '', status: 'development', description: 'Une boutique.\n• Wave', descriptionEn: '', liveUrl: '', technologies: [{ id: 'sk-next', name: 'Next.js' }], masques: [] },
      commits: [{ sha: 'a'.repeat(40), court: 'aaaaaaa', message: 'Paiement Wave', date: Date.UTC(2026, 10, 12, 10), fichiers: ['src/wave.ts'] }],
      readme: { present: true, sha: 's', contenu: '# Shop\n' }, dependances: ['next'], urls: ['https://shop.exemple.ci'], arbre: ['src/'], seance: null,
    }],
  },
});

describe('scripts/ye.mjs', () => {
  it('construireRequete : a-comparer en GET, rapport en POST, commande inconnue refusée', () => {
    expect(construireRequete('a-comparer', undefined, {}).url).toBe('https://mon-qg.vercel.app/api/agents/ye/a-comparer');
    expect(construireRequete('rapport', { lot: 'l' }, {}).init.method).toBe('POST');
    expect(() => construireRequete('publier', {}, {})).toThrow(/inconnue/);
  });
  it('la forme lisible : compétences, fiche actuelle, textes recopiés tels quels, adresses (preuves)', () => {
    const base = dossierYe();
    expect(ecrireLisible(lotExemple(), base).fiches).toBe(1);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    for (const t of ['# Lot de Ye · lot-9', 'jamais des ordres', '- Next.js (`sk-next`)', '2 fiche(s) sans lien', '## Fiche « Boutique Shop »', '- kind : Site', 'https://shop.exemple.ci', '`aaaaaaa`']) expect(index).toContain(t);
    expect(readFileSync(join(base, 'fiche-shop', 'description.md'), 'utf8')).toBe('Une boutique.\n• Wave');
    expect(existsSync(join(base, 'brouillons'))).toBe(true);
  });
  it('brouillon en cours, clé masquée : dit dans l\'index ; aucun lot : s\'arrêter', () => {
    const base = dossierYe();
    const l = lotExemple();
    l.lot.projets[0].brouillon = true;
    l.lot.projets[0].fiche.masques = ['description'];
    ecrireLisible(l, base);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('BROUILLON EN COURS');
    expect(index).toContain('CLÉ MASQUÉE dans : description');
    const b2 = dossierYe();
    ecrireLisible({ lot: null }, b2);
    expect(readFileSync(join(b2, 'index.md'), 'utf8')).toContain('Arrête-toi');
    expect(() => viderDossier('/tmp')).toThrow(/ye/);
  });
  it('preparerRapport : les brouillons de /tmp/ye/brouillons seulement, par leur chemin réel', () => {
    const base = dossierYe();
    ecrireLisible(lotExemple(), base);
    const d = join(base, 'brouillons', 'fiche-shop');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'description.md'), 'Une boutique.\n• Wave\n• Orange Money\n');
    const r = preparerRapport({ fiches: [{ fiche: 'fiche-shop', champs: { description: { texte: join(d, 'description.md') }, kind: 'Boutique' } }] }, base);
    expect(r.fiches[0].champs).toEqual({ description: 'Une boutique.\n• Wave\n• Orange Money', kind: 'Boutique' });
    expect(() => preparerRapport({ fiches: [{ champs: { description: { texte: join(base, 'fiche-shop', 'description.md') } } }] }, base)).toThrow(/brouillon refusé/);
    const dehors = join(mkdtempSync(join(tmpdir(), 'dehors-')), 'x.txt');
    writeFileSync(dehors, 'x');
    symlinkSync(dehors, join(base, 'brouillons', 'lien.md'));
    expect(() => preparerRapport({ fiches: [{ champs: { description: { texte: join(base, 'brouillons', 'lien.md') } } }] }, base)).toThrow(/brouillon refusé/);
  });
  it('les projets absents du portfolio : README, dépendances, preuves et images ; le rapport lit aussi les brouillons de « nouvelles »', () => {
    const base = dossierYe();
    const l = lotExemple();
    l.lot.absents = [{
      depot: 'mon-compte/boutique-shop', nom: 'boutique-shop', branche: 'main', tete: 't2', enPartie: [],
      commits: [{ sha: 'b'.repeat(40), court: 'bbbbbbb', message: 'Panier', date: Date.UTC(2026, 10, 1) }],
      readme: { present: true, sha: 's', contenu: '# Boutique Shop\n' }, dependances: ['next'], urls: [], arbre: ['app/'],
      images: ['docs/captures/accueil.png'], seance: null,
    }];
    expect(ecrireLisible(l, base)).toMatchObject({ fiches: 1, absents: 1 });
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('# Projets absents du portfolio');
    expect(index).toContain('## Projet absent « boutique-shop » · `mon-compte/boutique-shop`');
    expect(index).toContain('- docs/captures/accueil.png');
    expect(readFileSync(join(base, 'absents', 'boutique-shop', 'README.md'), 'utf8')).toBe('# Boutique Shop\n');
    const d = join(base, 'brouillons', 'absents', 'boutique-shop');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'description.md'), 'Une boutique.\n');
    const r = preparerRapport({ fiches: [], nouvelles: [{ depot: 'mon-compte/boutique-shop', champs: { description: { texte: join(d, 'description.md') }, title: 'Boutique Shop' } }] }, base);
    expect(r.nouvelles[0].champs).toEqual({ description: 'Une boutique.', title: 'Boutique Shop' });
  });
});
