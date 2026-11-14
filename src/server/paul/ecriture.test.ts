import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLES } from '../qg';
import { DEBUT, FIN } from './bloc';
import { preparerLot } from './lot';
import { ecrireRapport, idProposition } from './rapport';
import { deciderPaul, messageCommit } from './ecriture';
import { CLES_PAUL, ecrireProposition, lireProposition } from './stockage';
import type { LotPaul } from './types';
import { banc, blob, CLAUDE, D, depot, GHP, HEURE, JETON_ECRITURE, NOW, README } from './faux-github-test';

type Banc = ReturnType<typeof banc>;
const NOUVEAU_README = README.replace('Une appli.', 'Une appli qui fait le café.');
const BLOC = '## Où on s\'est arrêté\n- la partie 0 est faite';

/** Un projet « qg » relu, avec une proposition pour README.md et une pour CLAUDE.md. */
async function avecPropositions(fichiers: Record<string, string> = {}) {
  const b = banc([depot('qg', 1, fichiers)]);
  const r = await preparerLot(b.kv, b.deps, NOW);
  const lot = r.lot as LotPaul;
  const p = lot.projets[0];
  const base = (d: typeof p.readme) => (d.present ? d.sha : null);
  await ecrireRapport(b.kv, {
    lot: lot.id, projets: [{
      depot: D('qg'), propositions: [
        { fichier: 'README.md', base: base(p.readme), contenu: NOUVEAU_README, raisons: [{ texte: 'r', source: 'README.md' }] },
        { fichier: 'CLAUDE.md', base: base(p.claude), bloc: BLOC, raisons: [{ texte: 'r', source: 'CLAUDE.md' }] },
      ],
    }],
  }, b.deps, NOW + HEURE);
  return { b, readme: idProposition(lot.id, D('qg'), 'README.md'), claude: idProposition(lot.id, D('qg'), 'CLAUDE.md') };
}
const journal = async (b: Banc) => (await b.kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v));
const T = NOW + 2 * HEURE;

afterEach(() => vi.restoreAllMocks());

describe('Valider', () => {
  it('README : PUT avec le sha lu, le bon message, la branche par défaut et la clé d\'écriture ; « appliquée » avec le lien du commit', async () => {
    const { b, readme } = await avecPropositions();
    const reponse = await deciderPaul(b.kv, readme, true, b.ecriture, T);
    expect(b.gh.ecritures).toHaveLength(1);
    const e = b.gh.ecritures[0];
    expect(e).toMatchObject({ depot: D('qg'), chemin: 'README.md', jeton: JETON_ECRITURE });
    expect(e.corps).toMatchObject({ sha: blob(README), branch: 'main', message: 'Paul (Archiviste) : README.md à jour — validé par le patron' });
    expect(e.corps.message).toBe(messageCommit('README.md'));
    expect(Buffer.from(e.corps.content, 'base64').toString('utf8')).toBe(NOUVEAU_README);
    expect(b.depots[0].fichiers['README.md']).toBe(NOUVEAU_README);
    const p = await lireProposition(b.kv, readme);
    expect(p).toMatchObject({ statut: 'appliquee', decide: T });
    expect(p!.commit!.url).toMatch(/^https:\/\/github\.com\/mon-compte\/qg\/commit\//);
    expect(reponse).toBe(`C'est écrit : README.md de qg est à jour (commit ${p!.commit!.sha.slice(0, 7)}).`);
    expect((await journal(b))[0]).toMatchObject({ agent: 'paul', statut: 'termine', texte: 'a mis à jour README.md de qg' });
    // la clé d'écriture n'entre jamais dans la mémoire ni le journal
    expect(b.ecrits.join('\n')).not.toContain(JETON_ECRITURE);
  });

  it('second clic : « déjà noté », rien n\'est réécrit', async () => {
    const { b, readme } = await avecPropositions();
    await deciderPaul(b.kv, readme, true, b.ecriture, T);
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T + 1)).toBe('Déjà noté : README.md de qg est déjà écrit.');
    expect(await deciderPaul(b.kv, readme, false, b.ecriture, T + 2)).toBe('Déjà noté : README.md de qg est déjà écrit.');
    expect(b.gh.ecritures).toHaveLength(1);
  });

  it('deux clics en même temps : une seule écriture', async () => {
    const { b, readme } = await avecPropositions();
    const [x, y] = await Promise.all([deciderPaul(b.kv, readme, true, b.ecriture, T), deciderPaul(b.kv, readme, true, b.ecriture, T)]);
    expect(b.gh.ecritures).toHaveLength(1);
    expect([x, y].filter(t => t.startsWith('C\'est écrit'))).toHaveLength(1);
  });

  it('CLAUDE.md sans bloc : le serveur relit le fichier exact et insère le bloc ; le texte du patron reste intact', async () => {
    const { b, claude } = await avecPropositions();
    await deciderPaul(b.kv, claude, true, b.ecriture, T);
    const e = b.gh.ecritures[0];
    expect(e.corps.sha).toBe(blob(CLAUDE));
    const ecrit = Buffer.from(e.corps.content, 'base64').toString('utf8');
    expect(ecrit).toBe(`# Projet\n@AGENTS.md\n\n${DEBUT}\n${BLOC}\n${FIN}\n\nMes règles à moi : ne pas toucher.\n`);
  });

  it('CLAUDE.md avec bloc et un secret du patron hors du bloc : seul le bloc change, le texte réel (non masqué) est gardé', async () => {
    const avant = `# Projet\n\n${DEBUT}\nancien\n${FIN}\n\nMa note : ${GHP}\nFin.\n`;
    const { b, claude } = await avecPropositions({ 'CLAUDE.md': avant });
    await deciderPaul(b.kv, claude, true, b.ecriture, T);
    const ecrit = Buffer.from(b.gh.ecritures[0].corps.content, 'base64').toString('utf8');
    expect(ecrit).toBe(avant.replace('ancien', BLOC));
    // le texte non masqué n'a jamais été gardé par le serveur
    expect(b.ecrits.join('\n')).not.toContain(GHP);
  });

  it('CLAUDE.md absent : créé avec le bloc seul, sans sha', async () => {
    const b = banc([depot('qg', 1)]);
    delete b.depots[0].fichiers['CLAUDE.md'];
    const lot = (await preparerLot(b.kv, b.deps, NOW)).lot as LotPaul;
    expect(lot.projets[0].claude).toEqual({ present: false });
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('qg'), propositions: [{ fichier: 'CLAUDE.md', base: null, bloc: BLOC, raisons: [{ texte: 'r', source: 'README.md' }] }] }] }, b.deps, NOW + HEURE);
    await deciderPaul(b.kv, idProposition(lot.id, D('qg'), 'CLAUDE.md'), true, b.ecriture, T);
    expect(b.gh.ecritures[0].corps.sha).toBeUndefined();
    expect(b.depots[0].fichiers['CLAUDE.md']).toBe(`${DEBUT}\n${BLOC}\n${FIN}\n`);
  });

  it('le fichier a bougé depuis la lecture : rien n\'est écrasé, « bougée », message clair', async () => {
    const { b, readme } = await avecPropositions();
    b.depots[0].fichiers['README.md'] = '# Changé à la main par le patron\n';
    const r = await deciderPaul(b.kv, readme, true, b.ecriture, T);
    expect(r).toBe('Le fichier a bougé depuis : rien n\'est écrasé, Paul reproposera jeudi.');
    expect(b.depots[0].fichiers['README.md']).toBe('# Changé à la main par le patron\n');
    expect((await lireProposition(b.kv, readme))!.statut).toBe('bougee');
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T + 1)).toBe('Déjà noté : README.md de qg avait bougé, Paul reproposera jeudi.');
  });

  it('un fichier nouveau apparu entre-temps (422) : rien n\'est écrasé', async () => {
    const b = banc([depot('qg', 1)]);
    delete b.depots[0].fichiers['README.md'];
    const lot = (await preparerLot(b.kv, b.deps, NOW)).lot as LotPaul;
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('qg'), propositions: [{ fichier: 'README.md', base: null, contenu: NOUVEAU_README, raisons: [{ texte: 'r', source: 'package.json' }] }] }] }, b.deps, NOW + HEURE);
    b.depots[0].fichiers['README.md'] = '# Écrit à la main\n';
    expect(await deciderPaul(b.kv, idProposition(lot.id, D('qg'), 'README.md'), true, b.ecriture, T)).toMatch(/a bougé/);
    expect(b.depots[0].fichiers['README.md']).toBe('# Écrit à la main\n');
  });

  it('sans clé d\'écriture ou GitHub qui refuse (403) : rien n\'est écrit, la proposition reste en attente', async () => {
    const { b, readme } = await avecPropositions();
    expect(await deciderPaul(b.kv, readme, true, { fetch: b.gh.fetch, jeton: undefined }, T)).toMatch(/clé d'écriture GitHub manque/);
    const refuse = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    expect(await deciderPaul(b.kv, readme, true, { fetch: refuse, jeton: JETON_ECRITURE }, T)).toMatch(/rien n'est écrit, réessaie/);
    expect((await lireProposition(b.kv, readme))!.statut).toBe('attente');
    expect(b.gh.ecritures).toEqual([]);
  });

  it('défense en profondeur : un masque de clé absent du vrai fichier n\'est jamais écrit (bloquée)', async () => {
    const { b, readme } = await avecPropositions();
    const p = (await lireProposition(b.kv, readme))!;
    await ecrireProposition(b.kv, { ...p, contenu: `${NOUVEAU_README}\nFirebase : [clé Google masquée]\n` });
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T)).toBe('README.md de qg contient un masque de clé à la place d\'une vraie valeur : rien n\'est écrit.');
    expect(b.gh.ecritures).toEqual([]);
    expect((await lireProposition(b.kv, readme))!.statut).toBe('bloquee');
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T + 1)).toMatch(/^Déjà noté/);
  });

  it('un masque déjà présent dans le vrai fichier (texte du patron) ne bloque pas', async () => {
    const avec = `${README}Exemple : [clé GitHub masquée]\n`;
    const { b, readme } = await avecPropositions({ 'README.md': avec });
    const p = (await lireProposition(b.kv, readme))!;
    await ecrireProposition(b.kv, { ...p, base: blob(avec), contenu: avec.replace('Une appli.', 'Une appli neuve.') });
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T)).toMatch(/^C'est écrit/);
  });

  it('réponse perdue après l\'envoi (délai, panne 5xx) : « résultat inconnu », jamais « rien n\'est écrit » ; un second Valider ne réécrase pas', async () => {
    const { b, readme } = await avecPropositions();
    const coupe = (async (url: string, init?: RequestInit) => {
      await b.gh.fetch(url, init); // GitHub a écrit…
      throw new DOMException('délai', 'TimeoutError'); // …mais la réponse n'arrive pas
    }) as unknown as typeof fetch;
    const r = await deciderPaul(b.kv, readme, true, { fetch: coupe, jeton: JETON_ECRITURE }, T);
    expect(r).toBe('Résultat inconnu pour README.md de qg : GitHub n\'a pas répondu à temps, regarde sur GitHub avant de revalider.');
    expect(r).not.toMatch(/rien n'est écrit/);
    expect((await lireProposition(b.kv, readme))!.statut).toBe('attente');
    // revalider : même sha de base, le fichier a changé (par le premier envoi) → 409, rien n'est écrasé
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T + 1)).toMatch(/a bougé/);
    expect(b.gh.ecritures).toHaveLength(2);
    expect(b.depots[0].fichiers['README.md']).toBe(NOUVEAU_README);
    const panne = (async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    const { b: b2, readme: r2 } = await avecPropositions();
    expect(await deciderPaul(b2.kv, r2, true, { fetch: panne, jeton: JETON_ECRITURE }, T)).toMatch(/^Résultat inconnu/);
  });

  it('réponse illisible mais acceptée (200) : écrit', async () => {
    const { b, readme } = await avecPropositions();
    const illisible = (async (url: string, init?: RequestInit) => { await b.gh.fetch(url, init); return new Response('pas du json', { status: 200 }); }) as unknown as typeof fetch;
    expect(await deciderPaul(b.kv, readme, true, { fetch: illisible, jeton: JETON_ECRITURE }, T)).toBe('C\'est écrit : README.md de qg est à jour.');
    expect((await lireProposition(b.kv, readme))!.statut).toBe('appliquee');
  });

  it('proposition inconnue', async () => {
    const { b } = await avecPropositions();
    expect(await deciderPaul(b.kv, 'abcdef0123', true, b.ecriture, T)).toBe('Cette proposition de Paul est inconnue.');
  });
});

describe('Refuser', () => {
  it('rien n\'est écrit, « refusée », journal ; l\'autre proposition du même message reste en attente', async () => {
    const { b, readme, claude } = await avecPropositions();
    expect(await deciderPaul(b.kv, readme, false, b.ecriture, T)).toBe('Noté : je laisse README.md de qg tel quel.');
    expect(b.gh.ecritures).toEqual([]);
    expect(await lireProposition(b.kv, readme)).toMatchObject({ statut: 'refusee', decide: T });
    expect((await lireProposition(b.kv, claude))!.statut).toBe('attente');
    expect((await journal(b))[0]).toMatchObject({ agent: 'paul', texte: 'laisse README.md de qg tel quel' });
    expect(await deciderPaul(b.kv, readme, true, b.ecriture, T + 1)).toBe('Déjà noté : tu as refusé README.md de qg.');
    expect(b.gh.ecritures).toEqual([]);
  });
});

describe('un passage pendant un clic', () => {
  it('une proposition validée pendant le rapport suivant n\'est jamais rétrogradée en « remplacée »', async () => {
    const { b, readme } = await avecPropositions();
    b.depots[0].chaine.push({ sha: blob('qg-s2'), date: NOW + 6 * 86_400_000, message: 'Semaine 2' });
    const lot2 = (await preparerLot(b.kv, b.deps, NOW + 7 * 86_400_000)).lot as LotPaul;
    // le rapport lit les propositions (encore en attente)… et le patron valide juste à ce moment
    const hgetall = b.kv.hgetall.bind(b.kv);
    let fait = false;
    b.kv.hgetall = async (k: string) => {
      const r = await hgetall(k);
      if (k === CLES_PAUL.propositions && !fait) { fait = true; await deciderPaul(b.kv, readme, true, b.ecriture, T); }
      return r;
    };
    const p2 = lot2.projets[0];
    await ecrireRapport(b.kv, { lot: lot2.id, projets: [{ depot: D('qg'), propositions: [
      { fichier: 'README.md', base: p2.readme.present ? p2.readme.sha : null, contenu: NOUVEAU_README + 'Semaine 2.\n', raisons: [{ texte: 'r', source: 'README.md' }] },
    ] }] }, b.deps, NOW + 7 * 86_400_000 + HEURE);
    expect(fait).toBe(true);
    expect((await lireProposition(b.kv, readme))!.statut).toBe('appliquee');
  });
  it('un Valider en cours (verrou tenu) : le rapport ne la touche pas', async () => {
    const { b, readme } = await avecPropositions();
    await b.kv.setnx(CLES_PAUL.ecriture(readme), '1', 60);
    b.depots[0].chaine.push({ sha: blob('qg-s2'), date: NOW + 6 * 86_400_000, message: 'Semaine 2' });
    const lot2 = (await preparerLot(b.kv, b.deps, NOW + 7 * 86_400_000)).lot as LotPaul;
    const p2 = lot2.projets[0];
    await ecrireRapport(b.kv, { lot: lot2.id, projets: [{ depot: D('qg'), propositions: [
      { fichier: 'README.md', base: p2.readme.present ? p2.readme.sha : null, contenu: NOUVEAU_README + 'Semaine 2.\n', raisons: [{ texte: 'r', source: 'README.md' }] },
    ] }] }, b.deps, NOW + 7 * 86_400_000 + HEURE);
    expect((await lireProposition(b.kv, readme))!.statut).toBe('attente');
  });
});
