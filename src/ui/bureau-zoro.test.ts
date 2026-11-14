import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CarteMac, CarteTests, FaillesProjet } from './BureauZoro';
import type { DossierMac, Faille, Projet, Tour } from '@/server/zoro/types';

// Le bureau de Zoro rendu en HTML : ce que la page dit vraiment (spec § 2.2, § 7, § 9.3, § 9.4).
const NOW = Date.UTC(2026, 10, 11, 12, 0);
const JOUR = 86_400_000;
const projet = (o: Partial<Projet> = {}): Projet => ({ depot: 'a', pousse: NOW, failles: [], ci: { etat: 'vert', passages: 30, echecs: 0 }, ...o });
const dossier = (o: Partial<DossierMac> = {}): DossierMac => ({
  nom: 'qg', git: true, compte: 'mon-compte', distant: true, nonEnregistres: 0, plusAncienNonEnregistre: null,
  nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: NOW - JOUR, modifie: NOW - JOUR, ...o,
});
const tour = (o: Partial<Tour> = {}): Tour => ({
  quand: NOW, type: 'tour', projets: [], nonLus: [], cles: [], mac: { quand: NOW, dossiers: [] }, macVieux: false, importants: [], ...o,
});
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Le bureau de Zoro : Tests automatiques', () => {
  it('illisible avec sa raison ; le nombre d\'échecs sur les derniers passages ; dépôts non lus listés aussi', () => {
    const t = tour({
      projets: [
        projet({ depot: 'livreo', ci: { etat: 'rouge', depuis: Date.UTC(2026, 8, 30), passages: 30, echecs: 16 } }),
        projet({ depot: 'qg', ci: { etat: 'vert', passages: 30, echecs: 2 } }),
        projet({ depot: 'kds', ci: { etat: 'illisible', raison: 'droit Actions manquant' } }),
      ],
      nonLus: ['lent', 'clé GitHub'],
    });
    const h = texte(renderToStaticMarkup(createElement(CarteTests, { t })));
    expect(h).toContain('16 échecs sur 30 passages');
    expect(h).toContain('2 échecs sur 30 passages');
    expect(h).toContain('illisible (droit Actions manquant)');
    expect(h).toMatch(/lent non lu/);
    expect(h).not.toContain('clé GitHub'); // la date de la clé n'est pas une partie des tests
  });
  it('GitHub non lu : la carte le dit', () => {
    const h = texte(renderToStaticMarkup(createElement(CarteTests, { t: tour({ nonLus: ['GitHub'] }) })));
    expect(h).toMatch(/GitHub non lu/);
  });
});

describe('Le bureau de Zoro : Sur ton Mac', () => {
  it('changements mis de côté (stashes) et date de modification d\'un dossier hors git', () => {
    const t = tour({ mac: { quand: NOW, dossiers: [
      dossier({ nom: 'qg', stashes: 2 }),
      dossier({ nom: 'kds', stashes: 1, nonEnregistres: 3, plusAncienNonEnregistre: NOW - 9 * JOUR }),
      dossier({ nom: 'notes', git: false, compte: null, distant: false, dernierCommit: null, modifie: Date.UTC(2026, 10, 3, 10) }),
    ] } });
    const h = texte(renderToStaticMarkup(createElement(CarteMac, { t, now: NOW })));
    expect(h).toContain('2 changements mis de côté');
    expect(h).toContain('1 changement mis de côté');
    expect(h).toMatch(/pas suivi par git · modifié le 3 nov/);
  });
});

describe('Le bureau de Zoro : Failles', () => {
  it('sans version corrigée connue : « correctif non trouvé »', () => {
    const f: Faille = { id: 'G', paquet: 'next', version: '1.0.0', gravite: 'haute', corrigeeEn: null, directeProd: true, resume: 'r' };
    const h = texte(renderToStaticMarkup(createElement(FaillesProjet, { p: projet({ failles: [f, { ...f, id: 'H', corrigeeEn: '1.0.5' }] }) })));
    expect(h).toContain('correctif non trouvé');
    expect(h).toContain('corrigée en 1.0.5');
    expect(h).not.toContain('pas de correctif');
  });
});
