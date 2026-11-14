import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { Refus } from '../qg';
import { validerVisuel, textesDuVisuel, listeCaptures, rendreVisuel, type Visuel } from './visuels';

// Les 4 exemples des maquettes validées (maquettes/visuels-L/), transcrits en données.
const carte: Visuel = {
  modele: 'carte', rubrique: 'IA', surtitre: ">_ ce que j'ai appris",
  lignes: ['Mes agents IA', 'proposent.'], accent: 'Moi, je décide.',
  texte: '16 agents branchés sur mes vrais projets. Aucun ne publie, ne paie ni ne supprime sans mon accord.',
  pied: ['qg · agents IA', 'lire la suite ↓'],
};
const schema: Visuel = {
  modele: 'schema', rubrique: 'architecture', titre: 'Comment mes agents parlent à ma page',
  etapes: [
    { titre: 'Routine Claude', sous: 'toutes les heures' },
    { titre: 'Upstash Redis', sous: 'mémoire et journal' },
    { titre: 'Page Next.js', sous: "l'open space en 3D" },
  ],
  liens: ['écrit son état', 'lu toutes les 20 s'],
  encadre: { titre: '✅ Accord humain', texte: 'Toute action qui sort du système attend mon OK sur Telegram.' },
  pied: ['1 / 1', '#NextJS #IA'],
};
const capture: Visuel = {
  modele: 'capture', rubrique: 'projet', lignes: ["J'ai construit un bureau"], accent: 'pour 16 agents IA.',
  capture: 'qg-open-space', barre: 'qg · open space', pied: ['Next.js · Three.js · Upstash', 'glisse →'],
};
const carrousel: Visuel = {
  modele: 'carrousel', rubrique: 'carrousel', titre: ['5 leçons', 'après 1 mois'], accent: 'avec mes agents',
  etiquettes: ['Garder la main', 'Mémoire partagée', 'Coût maîtrisé'],
  pages: [
    { titre: '1. Garder la main', texte: "Chaque action qui sort du système attend mon accord sur Telegram. Les agents proposent, je décide." },
    { titre: '2. Une mémoire partagée', texte: 'Un seul Redis pour tous : état, journal, missions. Chaque agent lit ce que les autres ont fait.' },
    { titre: '3. Un coût maîtrisé', texte: 'Des routines courtes, une par heure au plus, et rien qui tourne pour rien.' },
  ],
  pied: ["retour d'expérience", 'glisse →'],
};
const EXEMPLES = { carte, schema, capture, carrousel };
// Le pire cas de chaque modèle : chaque champ à sa longueur maximale, en lettres larges.
const LIMITES: Visuel[] = [
  { ...carte, surtitre: 'W'.repeat(40), lignes: ['W'.repeat(22), 'M'.repeat(22), 'm'.repeat(22)], accent: 'W'.repeat(22), texte: 'Www '.repeat(35).slice(0, 139) + 'W', rubrique: 'W'.repeat(20), pied: ['W'.repeat(30), 'W'.repeat(30)] },
  { ...schema, titre: 'W'.repeat(60), etapes: Array.from({ length: 4 }, () => ({ titre: 'W'.repeat(24), sous: 'W'.repeat(28) })), liens: ['W'.repeat(22), 'W'.repeat(22), 'W'.repeat(22)], encadre: { titre: 'W'.repeat(24), texte: 'mot '.repeat(27) + 'mo' } },
  { ...capture, lignes: ['W'.repeat(26), 'W'.repeat(26)], accent: 'W'.repeat(26), barre: 'W'.repeat(30) },
  { ...carrousel, titre: ['W'.repeat(16), 'W'.repeat(16)], accent: 'W'.repeat(16), etiquettes: ['W'.repeat(20), 'W'.repeat(20), 'W'.repeat(20)], pages: Array.from({ length: 5 }, () => ({ titre: 'W'.repeat(40), texte: 'mot '.repeat(70).slice(0, 279) + 't' })) },
];
const BIBLIO = ['qg-open-space'];

/** Largeur et hauteur lues dans le bloc IHDR d'un PNG. */
function taillePng(png: Uint8Array) {
  expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(new TextDecoder().decode(png.slice(12, 16))).toBe('IHDR');
  const d = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { l: d.getUint32(16), h: d.getUint32(20) };
}

/** Le visuel doit être refusé en 400, avec un message qui contient `bout`. */
function refuse(v: unknown, bout: string, captures = BIBLIO) {
  let err: unknown;
  try { validerVisuel(v, captures); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(Refus);
  expect((err as Refus).code).toBe(400);
  expect((err as Refus).message).toContain(bout);
}

describe('validerVisuel', () => {
  it('accepte les 4 exemples des maquettes', () => {
    for (const v of Object.values(EXEMPLES)) expect(validerVisuel(v, BIBLIO)).toEqual(v);
  });

  it('nettoie les espaces et le « # » de la rubrique', () => {
    const v = validerVisuel({ ...carte, rubrique: ' # IA ', lignes: ['  Mes agents IA '] }, BIBLIO);
    expect(v.rubrique).toBe('IA');
    expect(v.modele === 'carte' && v.lignes).toEqual(['Mes agents IA']);
  });

  it('refuse ce qui n\'est pas un objet et un modèle inconnu', () => {
    refuse(null, 'visuel');
    refuse('carte', 'visuel');
    refuse({ ...carte, modele: 'video' }, 'modele');
  });

  it('refuse une ligne trop longue en nommant le champ et la limite', () => {
    refuse({ ...carte, lignes: ['ok', 'x'.repeat(23)] }, '« lignes[1] » trop long (22 caractères au plus)');
    refuse({ ...carte, accent: 'x'.repeat(23) }, '« accent » trop long (22');
    refuse({ ...carte, texte: 'x'.repeat(141) }, '« texte » trop long (140');
    refuse({ ...carte, surtitre: 'x'.repeat(41) }, '« surtitre » trop long (40');
    refuse({ ...capture, lignes: ['x'.repeat(27)] }, '« lignes[0] » trop long (26');
    refuse({ ...carrousel, titre: ['x'.repeat(17)] }, '« titre[0] » trop long (16');
    refuse({ ...schema, etapes: [{ titre: 'x'.repeat(25), sous: 's' }, { titre: 't', sous: 's' }, { titre: 't', sous: 's' }] }, '« etapes[0].titre » trop long (24');
    refuse({ ...schema, encadre: { titre: 't', texte: 'x'.repeat(111) } }, '« encadre.texte » trop long (110');
    refuse({ ...carte, rubrique: 'x'.repeat(21) }, '« rubrique » trop long (20');
    refuse({ ...carte, pied: ['a', 'x'.repeat(31)] }, '« pied[1] » trop long (30');
    refuse({ ...carrousel, pages: [{ titre: 'a', texte: 'x'.repeat(281) }, { titre: 'b', texte: 'c' }] }, '« pages[0].texte » trop long (280');
  });

  it('refuse 0 ligne, trop de lignes et un champ requis vide', () => {
    refuse({ ...carte, lignes: [] }, '« lignes »');
    refuse({ ...carte, lignes: ['a', 'b', 'c', 'd'] }, '« lignes »');
    refuse({ ...capture, lignes: ['a', 'b', 'c'] }, '« lignes »');
    refuse({ ...carte, lignes: ['a', '   '] }, '« lignes[1] » manquant');
    refuse({ ...carte, accent: '' }, '« accent » manquant');
    refuse({ ...carte, pied: ['a'] }, '« pied »');
    refuse({ ...carrousel, pages: [carrousel.pages[0]] }, '« pages »');
    refuse({ ...carrousel, etiquettes: ['a', 'b', 'c', 'd'] }, '« etiquettes »');
    refuse({ ...schema, etapes: [schema.etapes[0]], liens: [] }, '« etapes »');
  });

  it('refuse une capture hors de la bibliothèque, un chemin ou une URL', () => {
    refuse({ ...capture, capture: 'autre' }, '« capture »');
    refuse({ ...capture, capture: '../x' }, '« capture »');
    refuse({ ...capture, capture: '../qg-open-space' }, '« capture »');
    refuse({ ...capture, capture: 'https://exemple.com/a.png' }, '« capture »');
    refuse({ ...capture, capture: 'qg-open-space.png' }, '« capture »');
    refuse(capture, '« capture »', []);
  });

  it('refuse des liens en mauvais nombre', () => {
    refuse({ ...schema, liens: ['un seul'] }, '« liens »');
    refuse({ ...schema, liens: ['a', 'b', 'c'] }, '« liens »');
  });

  it('accepte une carte sans texte et un schéma sans encadré', () => {
    const { texte: _t, ...sansTexte } = carte as Extract<Visuel, { modele: 'carte' }>;
    void _t;
    expect(validerVisuel(sansTexte, BIBLIO)).toEqual(sansTexte);
    const { encadre: _e, ...sansEncadre } = schema as Extract<Visuel, { modele: 'schema' }>;
    void _e;
    expect(validerVisuel(sansEncadre, BIBLIO)).toEqual(sansEncadre);
  });
});

describe('textesDuVisuel', () => {
  it('contient chaque champ de texte', () => {
    const attendus: Record<string, string[]> = {
      carte: [">_ ce que j'ai appris", 'Mes agents IA', 'proposent.', 'Moi, je décide.', '16 agents branchés', 'qg · agents IA', 'lire la suite ↓', 'IA'],
      schema: ['Comment mes agents', 'Routine Claude', 'toutes les heures', 'Upstash Redis', 'mémoire et journal', 'Page Next.js', "l'open space en 3D", 'écrit son état', 'lu toutes les 20 s', '✅ Accord humain', 'attend mon OK', '1 / 1', '#NextJS #IA', 'architecture'],
      capture: ["J'ai construit un bureau", 'pour 16 agents IA.', 'qg · open space', 'Next.js · Three.js', 'glisse →', 'projet', 'qg-open-space'],
      carrousel: ['5 leçons', 'après 1 mois', 'avec mes agents', 'Garder la main', 'Mémoire partagée', 'Coût maîtrisé', '1. Garder la main', 'Un seul Redis', 'Des routines courtes', "retour d'expérience", 'carrousel'],
    };
    for (const [nom, v] of Object.entries(EXEMPLES)) {
      const t = textesDuVisuel(v);
      for (const bout of attendus[nom]) expect(t, `${nom} : ${bout}`).toContain(bout);
    }
  });
});

describe('listeCaptures', () => {
  it('liste la bibliothèque sans extension', () => {
    expect(listeCaptures()).toContain('qg-open-space');
    expect(listeCaptures().every(n => !n.endsWith('.png'))).toBe(true);
  });
});

describe('rendreVisuel', () => {
  for (const [nom, v] of Object.entries(EXEMPLES)) {
    it(`${nom} : un PNG de 1080 × 1350`, async () => {
      const { png } = await rendreVisuel(v);
      expect(taillePng(png)).toEqual({ l: 1080, h: 1350 });
    }, 30_000);
  }

  it('carrousel de 3 pages : un PDF de 4 pages de 1080 × 1350', async () => {
    const { pdf } = await rendreVisuel(carrousel);
    expect(pdf).toBeDefined();
    expect(new TextDecoder().decode(pdf!.slice(0, 4))).toBe('%PDF');
    const doc = await PDFDocument.load(pdf!);
    expect(doc.getPageCount()).toBe(4);
    for (const p of doc.getPages()) expect(p.getSize()).toEqual({ width: 1080, height: 1350 });
  }, 60_000);

  for (const v of LIMITES) {
    it(`${v.modele} au pire cas (champs au maximum, lettres larges) : valide et rendu en 1080 × 1350`, async () => {
      expect(validerVisuel(v, BIBLIO)).toEqual(v);
      const { png, pdf } = await rendreVisuel(v);
      expect(taillePng(png)).toEqual({ l: 1080, h: 1350 });
      if (v.modele === 'carrousel') expect((await PDFDocument.load(pdf!)).getPageCount()).toBe(6);
    }, 60_000);
  }

  it('les autres modèles n\'ont pas de PDF', async () => {
    expect((await rendreVisuel(carte)).pdf).toBeUndefined();
  }, 30_000);

  // Étape 4 du plan : écrit les images à comparer avec les maquettes.
  // VISUELS_EXEMPLES=1 pnpm vitest run src/server/l/visuels.test.ts
  it.runIf(process.env.VISUELS_EXEMPLES)('écrit les exemples dans maquettes/visuels-L/code-*.png', async () => {
    const dossier = join(process.cwd(), 'maquettes/visuels-L');
    const noms = ['1-carte-idee', '2-schema', '3-capture', '4-carrousel'];
    const tous = [...Object.values(EXEMPLES).map((v, i) => [`code-${noms[i]}`, v] as const), ...LIMITES.map((v, i) => [`code-limites-${noms[i]}`, v] as const)];
    for (const [nom, v] of tous) {
      const { png, pdf } = await rendreVisuel(v);
      await writeFile(join(dossier, `${nom}.png`), png);
      if (pdf) await writeFile(join(dossier, `${nom}.pdf`), pdf);
    }
  }, 120_000);
});

describe('exemples de CONSIGNES.md', () => {
  it('chaque bloc visuel du guide passe la validation', async () => {
    const { readFileSync } = await import('node:fs');
    const md = readFileSync(join(process.cwd(), 'agents/L/CONSIGNES.md'), 'utf8');
    const blocs = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1])).filter(j => j && typeof j.modele === 'string');
    expect(blocs.map(b => b.modele).sort()).toEqual(['capture', 'carrousel', 'carte', 'schema']);
    for (const b of blocs) expect(() => validerVisuel(b, ['qg-open-space'])).not.toThrow();
  });
});
