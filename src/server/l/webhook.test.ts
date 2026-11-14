import { describe, it, expect, vi } from 'vitest';
import { memoire } from '../memoire';
import { idsEnAttente, lireAccord } from '../accords';
import type { Recu } from '../telegram';
import { enregistrerConnexion, RAPPEL_JOURS, URL_CONNEXION } from '../linkedin/connexion';
import { traiterAction } from './api';
import { CLE_POSTS } from './posts';
import type { ResultatPublication } from './publication';
import type { Visuel } from './visuels';
import { CLE_BOITE } from './boite';
import { CLE_STATS } from './stats';
import { xlsxDeTest } from './xlsx-test';

vi.mock('server-only', () => ({}));
import { traiterTelegram, type DepsTelegram } from './webhook';
import { CLES_CLARA, idExpediteur, type StatExpediteur } from '../clara/stats';
import { poserQuestion1 } from '../clara/actions';
import type { BoiteOuverte } from '../clara/imap';

const txt = (texte: string): Recu => ({ type: 'texte', id: 'm1', de: '1', texte });
const btn = (donnee: string): Recu => ({ type: 'bouton', id: 'c1', de: '1', donnee, chat: 1, message: 2 });
const bon = { sujet: 's', texte: 'Le texte du post', hashtags: ['#a', '#b', '#c'] };

const publierFaux = async (): Promise<ResultatPublication> => ({ etat: 'inconnu' });
const JOUR = 86400;

function banc(resultat?: ResultatPublication) {
  const kv = memoire();
  const envoyes: { texte: string; boutons?: { texte: string; donnee: string }[] }[] = [];
  const publications: { postId: string; forcer: boolean }[] = [];
  const deps: DepsTelegram = {
    envoyer: async (texte, boutons) => { envoyes.push({ texte, boutons: boutons?.flat() }); },
    publier: async (_kv, postId, forcer) => { publications.push({ postId, forcer }); return resultat ?? { etat: 'inconnu' }; },
    telecharger: async () => ({ contenu: new Uint8Array() }),
  };
  const prets = () => envoyes.filter(e => e.boutons?.some(b => b.donnee.startsWith('publie:')));
  const brouillon = async (corps: Record<string, unknown> = bon) =>
    (await traiterAction(kv, 'brouillon', corps, deps)) as { post: { id: string }; accordId: string };
  return { kv, envoyes, deps, prets, brouillon, publications };
}

describe('le webhook Telegram de L', () => {
  it('✅ sur le brouillon courant : un seul envoi « prêt », avec le texte', async () => {
    const b = banc();
    const { post, accordId } = await b.brouillon();
    await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
    expect(b.prets()).toHaveLength(1);
    expect(b.prets()[0].texte).toContain('Le texte du post');
    expect(b.prets()[0].boutons).toEqual([
      { texte: 'Publier sur LinkedIn', donnee: `publier:${post.id}` },
      { texte: 'Déjà publié', donnee: `publie:${post.id}` },
    ]);
  });
  it('✅ rejoué : pas de second envoi « prêt »', async () => {
    const b = banc();
    const { accordId } = await b.brouillon();
    await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
    const info = await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
    expect(b.prets()).toHaveLength(1);
    expect(info).toContain('déjà traité');
  });
  it('✅ sur un post abandonné par une révision : pas d’envoi « prêt »', async () => {
    const b = banc();
    const ancien = await b.brouillon();
    await b.brouillon({ ...bon, texte: 'Version 2', revisionDe: ancien.post.id });
    await traiterTelegram(b.kv, btn(`ok:${ancien.accordId}`), b.deps);
    expect(b.prets()).toHaveLength(0);
  });
  it('« ok » tapé avec deux demandes en attente : rien n’est appliqué, L demande lequel', async () => {
    const b = banc();
    const x = await b.brouillon();
    const y = await b.brouillon({ ...bon, texte: 'Autre post' });
    const info = await traiterTelegram(b.kv, txt('ok'), b.deps);
    expect(info).toContain('Plusieurs demandes en attente');
    expect(info).toContain(`#${x.accordId}`);
    expect(info).toContain(`#${y.accordId}`);
    expect(b.prets()).toHaveLength(0);
    expect((await lireAccord(b.kv, x.accordId))?.statut).toBe('en attente');
    expect((await lireAccord(b.kv, y.accordId))?.statut).toBe('en attente');
    expect(await traiterTelegram(b.kv, txt('modifie : plus court'), b.deps)).toContain('Plusieurs demandes en attente');
    // avec l'#id, la réponse s'applique
    await traiterTelegram(b.kv, txt(`ok #${y.accordId}`), b.deps);
    expect(b.prets()).toHaveLength(1);
    expect(await idsEnAttente(b.kv)).toEqual([x.accordId]);
  });
  it('« ok » tapé avec une seule demande en attente : appliqué comme avant', async () => {
    const b = banc();
    await b.brouillon();
    await traiterTelegram(b.kv, txt('ok'), b.deps);
    expect(b.prets()).toHaveLength(1);
  });
  it('« J’ai publié » sur un post qui n’est pas prêt : rien n’est noté', async () => {
    const b = banc();
    const { post } = await b.brouillon();
    expect(await traiterTelegram(b.kv, btn(`publie:${post.id}`), b.deps)).toContain('pas prêt');
  });

  describe('le visuel après ✅', () => {
    const carte: Visuel = {
      modele: 'carte', rubrique: 'IA', surtitre: 's', lignes: ['Une ligne'], accent: 'Un accent', pied: ['a', 'b'],
    };
    const carrousel: Visuel = {
      modele: 'carrousel', rubrique: 'c', titre: ['Titre'], accent: 'accent', etiquettes: [],
      pages: [{ titre: 'Un', texte: 'un' }, { titre: 'Deux', texte: 'deux' }], pied: ['a', 'b'],
    };
    function bancVisuel(o: { imageEchoue?: boolean } = {}) {
      const kv = memoire();
      const journal: string[] = [];
      const envoyes: { texte: string; boutons?: { texte: string; donnee: string }[] }[] = [];
      let enPanne = false;
      const deps: DepsTelegram = {
        envoyer: async (texte, boutons) => { journal.push('texte'); envoyes.push({ texte, boutons: boutons?.flat() }); },
        publier: publierFaux, telecharger: async () => ({ contenu: new Uint8Array() }),
        rendre: async v => { journal.push('rendre'); return { png: new Uint8Array([1]), ...(v.modele === 'carrousel' ? { pdf: new Uint8Array([2]) } : {}) }; },
        envoyerImage: async () => { journal.push('image'); if (enPanne) throw new Error('sendPhoto refusé'); },
        envoyerFichier: async (_c, nom) => { journal.push('fichier:' + nom); },
      };
      const brouillon = async (visuel: Visuel) =>
        (await traiterAction(kv, 'brouillon', { ...bon, visuel }, deps)) as { post: { id: string }; accordId: string };
      const panne = () => { enPanne = !!o.imageEchoue; journal.length = 0; envoyes.length = 0; };
      return { kv, journal, envoyes, deps, brouillon, panne };
    }
    it('✅ : l’image part avant le texte prêt', async () => {
      const b = bancVisuel();
      const { post, accordId } = await b.brouillon(carte);
      b.panne();
      expect(await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps)).toBeNull();
      expect(b.journal).toEqual(['texte', 'rendre', 'image', 'texte']);
      const pret = b.envoyes[b.envoyes.length - 1];
      expect(pret.boutons?.[1].donnee).toBe(`publie:${post.id}`);
      expect(pret.texte).not.toContain('visuel indisponible');
    });
    it('✅ sur un carrousel : l’image, le PDF, puis le texte prêt', async () => {
      const b = bancVisuel();
      const { accordId } = await b.brouillon(carrousel);
      b.panne();
      await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
      expect(b.journal).toEqual(['texte', 'rendre', 'image', 'fichier:carrousel.pdf', 'texte']);
    });
    it('✅ et l’image échoue : le texte prêt part quand même, avec l’avertissement', async () => {
      const b = bancVisuel({ imageEchoue: true });
      const { post, accordId } = await b.brouillon(carte);
      b.panne();
      expect(await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps)).toBeNull();
      const pret = b.envoyes[b.envoyes.length - 1];
      expect(pret.boutons?.[1].donnee).toBe(`publie:${post.id}`);
      expect(pret.texte).toContain('Le texte du post');
      expect(pret.texte).toContain('(visuel indisponible, redemande-le)');
    });
    it('✅ et le rendu n’est pas branché : le texte prêt part avec l’avertissement', async () => {
      const b = bancVisuel();
      const { accordId } = await b.brouillon(carte);
      b.panne();
      await traiterTelegram(b.kv, btn(`ok:${accordId}`), { envoyer: b.deps.envoyer, publier: publierFaux, telecharger: b.deps.telecharger });
      expect(b.envoyes[b.envoyes.length - 1].texte).toContain('(visuel indisponible, redemande-le)');
    });
    it('✅ sans visuel : pas d’image', async () => {
      const b = bancVisuel();
      const { accordId } = (await traiterAction(b.kv, 'brouillon', bon, b.deps)) as { accordId: string };
      b.panne();
      await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
      expect(b.journal).toEqual(['texte', 'texte']);
    });
  });

  describe('la publication sur LinkedIn', () => {
    const connecter = (kv: ReturnType<typeof memoire>, jours: number) =>
      enregistrerConnexion(kv, { jeton: 'J', expireDans: jours * JOUR + 3600, auteur: 'urn:li:person:x', nom: 'M' }, 's');
    const pret = async (b: ReturnType<typeof banc>) => {
      const { accordId } = await b.brouillon();
      await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
      return b.prets()[0].texte;
    };
    it('le texte prêt rappelle la connexion quand LinkedIn n’est pas connecté', async () => {
      expect(await pret(banc())).toContain(URL_CONNEXION);
    });
    it('… ou quand elle expire dans RAPPEL_JOURS jours ou moins', async () => {
      const b = banc(); await connecter(b.kv, RAPPEL_JOURS);
      expect(await pret(b)).toContain(URL_CONNEXION);
    });
    it('pas de rappel quand la connexion tient encore', async () => {
      const b = banc(); await connecter(b.kv, RAPPEL_JOURS + 10);
      expect(await pret(b)).not.toContain(URL_CONNEXION);
    });
    it('bouton vu-light : note le « Vu » et répond', async () => {
      const b = banc();
      expect(await traiterTelegram(b.kv, btn('vu-light:2026-01-01'), b.deps)).toBe("Ce relevé n'existe plus.");
      await b.kv.hset('light:messages', '2026-11-09', JSON.stringify({ jour: '2026-11-09', texte: 't', cles: [], envoye: 1, relances: [] }));
      expect(await traiterTelegram(b.kv, btn('vu-light:2026-11-09'), b.deps)).toBe("Noté, plus de rappel aujourd'hui.");
      expect(JSON.parse((await b.kv.hgetall('light:messages'))['2026-11-09']).vu).toBeTypeOf('number');
    });
    it('bouton publier / republier : la publication est appelée avec forcer', async () => {
      const b = banc({ etat: 'publie', url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' });
      expect(await traiterTelegram(b.kv, btn('publier:abc'), b.deps)).toBe('Publié sur LinkedIn : https://www.linkedin.com/feed/update/urn:li:share:1/');
      await traiterTelegram(b.kv, btn('republier:abc'), b.deps);
      expect(b.publications).toEqual([{ postId: 'abc', forcer: false }, { postId: 'abc', forcer: true }]);
      expect(b.envoyes).toEqual([]);
    });
    it('textes courts pour deja, en-cours, pas-pret, inconnu', async () => {
      const cas: [ResultatPublication, string][] = [
        [{ etat: 'deja', url: 'https://u' }, 'Déjà publié : https://u'],
        [{ etat: 'en-cours' }, 'Publication déjà en cours, patiente un instant.'],
        [{ etat: 'pas-pret', statut: 'en accord' }, "Ce post n'est pas prêt à publier (en accord)."],
        [{ etat: 'inconnu' }, 'Ce post est inconnu.'],
      ];
      for (const [r, texte] of cas) expect(await traiterTelegram(banc(r).kv, btn('publier:abc'), banc(r).deps)).toBe(texte);
    });
    it('non connecté : un nouveau message avec l’adresse de connexion et « Réessayer »', async () => {
      const b = banc({ etat: 'non-connecte' });
      expect(await traiterTelegram(b.kv, btn('publier:abc'), b.deps)).toBe('Pas encore publié.');
      expect(b.envoyes).toHaveLength(1);
      expect(b.envoyes[0].texte).toContain(URL_CONNEXION);
      expect(b.envoyes[0].boutons).toEqual([{ texte: 'Réessayer', donnee: 'publier:abc' }]);
    });
    it('echec : « Rien n’est publié : <raison>. » et « Réessayer »', async () => {
      const b = banc({ etat: 'echec', raison: "le visuel n'a pas pu partir" });
      expect(await traiterTelegram(b.kv, btn('publier:abc'), b.deps)).toBe('Pas encore publié.');
      expect(b.envoyes).toEqual([{ texte: "Rien n'est publié : le visuel n'a pas pu partir.", boutons: [{ texte: 'Réessayer', donnee: 'publier:abc' }] }]);
    });
    it('incertain : demande de vérifier le profil, boutons « Republier » et « Déjà publié »', async () => {
      const b = banc({ etat: 'incertain' });
      expect(await traiterTelegram(b.kv, btn('publier:abc'), b.deps)).toBe('Pas encore publié.');
      expect(b.envoyes[0].texte).toBe('La dernière tentative a peut-être abouti : regarde ton profil LinkedIn. '
        + "S'il y est, touche « Déjà publié » ; sinon, touche « Republier ».");
      expect(b.envoyes[0].boutons).toEqual([
        { texte: 'Republier', donnee: 'republier:abc' },
        { texte: 'Déjà publié', donnee: 'publie:abc' },
      ]);
    });
    it('« Déjà publié » (manuel) marque toujours le post publié', async () => {
      const b = banc();
      const { post, accordId } = await b.brouillon();
      await traiterTelegram(b.kv, btn(`ok:${accordId}`), b.deps);
      expect(await traiterTelegram(b.kv, btn(`publie:${post.id}`), b.deps)).toBe('Bravo, c’est noté.');
      expect(JSON.parse((await b.kv.hgetall(CLE_POSTS))[post.id]).statut).toBe('publie');
    });
  });

  describe('un export de statistiques', () => {
    const fichier = (nom: string): Recu => ({ type: 'fichier', id: 'f1', de: '1', fileId: 'F1', nom });
    const deux = () => xlsxDeTest([
      { nom: 'DISCOVERY', lignes: [['Date', 'Impressions'], ['2026-11-01', 120]] },
      { nom: 'FOLLOWERS', lignes: [['Date', 'Nouveaux'], ['2026-11-02', 4]] },
    ]);
    it('un tableur est lu et rangé, rien dans la boîte', async () => {
      const b = banc();
      const appels: string[] = [];
      const deps = { ...b.deps, telecharger: async (id: string) => { appels.push(id); return { contenu: deux() }; } };
      expect(await traiterTelegram(b.kv, fichier('Contenu_2026.xlsx'), deps))
        .toBe('Statistiques reçues (2 feuilles). L prépare le bilan dans l\'heure.');
      expect(appels).toEqual(['F1']);
      expect(Object.keys(await b.kv.hgetall(CLE_STATS))).toHaveLength(1);
      expect(await b.kv.hgetall(CLE_BOITE)).toEqual({});
    });
    it('un tableur illisible : message clair, rien de rangé', async () => {
      const b = banc();
      const deps = { ...b.deps, telecharger: async () => ({ contenu: new Uint8Array([1, 2, 3]) }) };
      expect(await traiterTelegram(b.kv, fichier('x.xlsx'), deps)).toBe('Je n\'ai pas pu lire ce fichier : fichier illisible.');
      expect(await b.kv.hgetall(CLE_STATS)).toEqual({});
    });
    it('un autre fichier va dans la boîte, sans téléchargement', async () => {
      const b = banc();
      const deps = { ...b.deps, telecharger: async () => { throw new Error('ne doit pas être appelé'); } };
      expect(await traiterTelegram(b.kv, fichier('notes.pdf'), deps)).toBe('Reçu, L s’en occupe dans l’heure.');
      expect(Object.keys(await b.kv.hgetall(CLE_BOITE))).toHaveLength(1);
    });
  });
});

describe('le webhook Telegram : Clara', () => {
  const NOW = Date.now();
  const fausse = (mails: Map<number, string>) => {
    const corbeille: number[] = [];
    const boite: BoiteOuverte = {
      dossiers: async () => ({ corbeille: 'T', envoyes: 'S', tous: 'A' }), total: async () => 0,
      lireEntetes: async () => [], chercherGmail: async () => [],
      chercherDe: async (_d, a, apres = 0) => [...mails].filter(([u, de]) => u > apres && de.includes(a)).map(([u]) => u),
      expediteurs: async (_d, uids) => new Map(uids.map(u => [u, mails.get(u) ?? ''] as const)),
      corbeille: async (_d, uids) => { for (const u of uids) { mails.delete(u); corbeille.push(u); } return uids.length; },
      fermer: vi.fn(async () => undefined),
    };
    return { boite, corbeille };
  };

  it('Oui à la question 1 : corbeille, question 2, rejoué : Déjà fait', async () => {
    const b = banc();
    const f = fausse(new Map([[1, 'news@x.com'], [2, 'news@x.com'], [3, 'ami@y.com']]));
    const deps = { ...b.deps, ouvrirGmail: async () => f.boite };
    const s: StatExpediteur = { id: idExpediteur('news@x.com'), adresse: 'news@x.com', nom: 'Marque X', total: 2, nonLus: 2, dernier: NOW };
    await poserQuestion1(b.kv, deps.envoyer, s, NOW);
    expect(await traiterTelegram(b.kv, btn(`cl1:${s.id}:o`), deps)).toBe('2 mails mis à la corbeille.');
    expect(f.corbeille).toEqual([1, 2]);
    expect(f.boite.fermer).toHaveBeenCalledTimes(1);
    expect(b.envoyes.at(-1)?.boutons?.map(x => x.donnee)).toEqual([`cl2:${s.id}:o`, `cl2:${s.id}:n`]);
    expect(await traiterTelegram(b.kv, btn(`cl1:${s.id}:o`), deps)).toBe('Déjà fait.');
  });

  it('sans Gmail configuré : message clair, rien déplacé', async () => {
    const b = banc();
    const s: StatExpediteur = { id: idExpediteur('news@x.com'), adresse: 'news@x.com', total: 2, nonLus: 2, dernier: NOW };
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(await traiterTelegram(b.kv, btn(`cl1:${s.id}:o`), b.deps)).toBe('Gmail non configuré : rien n\'est déplacé pour l\'instant.');
  });

  it('« VIP : @Banque.ci » ajoute @banque.ci ; « plus VIP » le retire ; illisible : erreur, pas de note pour L', async () => {
    const b = banc();
    expect(await traiterTelegram(b.kv, txt('VIP : @Banque.ci'), b.deps)).toBe('VIP ajouté : @banque.ci. Clara ne touchera jamais à ses mails.');
    expect(Object.keys(await b.kv.hgetall(CLES_CLARA.vip))).toEqual(['@banque.ci']);
    expect(await traiterTelegram(b.kv, txt('plus VIP : @banque.ci'), b.deps)).toBe('@banque.ci n\'est plus VIP.');
    expect(await traiterTelegram(b.kv, txt('plus VIP : @banque.ci'), b.deps)).toBe('@banque.ci n\'était pas VIP.');
    expect(await traiterTelegram(b.kv, txt('VIP : bonjour'), b.deps)).toContain('Je n\'ai pas compris l\'adresse');
    expect(await b.kv.hgetall(CLE_BOITE)).toEqual({});
  });
  it('plusieurs « VIP : … » dans un seul message : tous ajoutés', async () => {
    const b = banc();
    const r = await traiterTelegram(b.kv, txt('VIP : @suu.edu\nVIP : proche@exemple.com'), b.deps);
    expect(r).toContain('VIP ajouté : @suu.edu.');
    expect(r).toContain('VIP ajouté : proche@exemple.com.');
    expect(Object.keys(await b.kv.hgetall(CLES_CLARA.vip)).sort()).toEqual(['@suu.edu', 'proche@exemple.com']);
  });
  it('Isaac : isc:o:<id> note le Oui une fois, le second clic répond « déjà noté »', async () => {
    const b = banc();
    await b.kv.hset('isaac:propositions', 'cache:cursor', JSON.stringify({ id: 'cache:cursor', libelle: 'caches de Cursor', statut: 'proposee' }));
    expect(await traiterTelegram(b.kv, btn('isc:o:cache:cursor'), b.deps)).toContain('Noté');
    expect(await traiterTelegram(b.kv, btn('isc:o:cache:cursor'), b.deps)).toBe('Tu as déjà dit Oui pour « caches de Cursor » : je l\'efface dans la minute, si ton Mac est allumé.');
    expect(JSON.parse((await b.kv.hgetall('isaac:propositions'))['cache:cursor']).statut).toBe('oui');
  });
  it('Paul : pau:v:<id> écrit sur GitHub avec la clé d\'écriture branchée, le second clic répond « déjà noté »', async () => {
    const b = banc();
    const prop = { id: 'abcdef0123', lot: 'L', depot: 'mon-compte/qg', branche: 'main', fichier: 'README.md', base: 'b0', contenu: '# QG\n', raisons: [], diff: [], ajoutees: 1, retirees: 0, quand: Date.now(), statut: 'attente' };
    await b.kv.hset('paul:propositions', prop.id, JSON.stringify(prop));
    const puts: { url: string; corps: Record<string, unknown> }[] = [];
    const fetchFaux = (async (url: string, init?: RequestInit) => {
      puts.push({ url, corps: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ commit: { sha: 'c0ffee0000', html_url: 'https://github.com/mon-compte/qg/commit/c0ffee0000' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = { ...b.deps, ecriturePaul: () => ({ fetch: fetchFaux, jeton: 'jeton-ecriture' }) };
    expect(await traiterTelegram(b.kv, btn('pau:v:abcdef0123'), deps)).toBe('C\'est écrit : README.md de qg est à jour (commit c0ffee0).');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('https://api.github.com/repos/mon-compte/qg/contents/README.md');
    expect(puts[0].corps).toMatchObject({ sha: 'b0', branch: 'main' });
    expect(await traiterTelegram(b.kv, btn('pau:v:abcdef0123'), deps)).toBe('Déjà noté : README.md de qg est déjà écrit.');
    expect(await traiterTelegram(b.kv, btn('pau:r:abcdef0123'), deps)).toBe('Déjà noté : README.md de qg est déjà écrit.');
    expect(puts).toHaveLength(1);
  });
  it('Ye : ye:n:<id> note le Non une fois ; ye:v:<id> sans clé branchée ne publie rien', async () => {
    const b = banc();
    await b.kv.hset('ye:questions', 'abcdef0124', JSON.stringify({ id: 'abcdef0124', techno: 'Payload', cle: 'payload', titre: 'T', source: 'package.json', quand: Date.now(), statut: 'attente' }));
    expect(await traiterTelegram(b.kv, btn('ye:n:abcdef0124'), b.deps)).toBe('Noté : je ne te demanderai plus pour Payload.');
    expect(await traiterTelegram(b.kv, btn('ye:o:abcdef0124'), b.deps)).toBe('Déjà noté : je ne te demanderai plus pour Payload.');
    await b.kv.hset('ye:propositions', 'abcdef0123', JSON.stringify({ id: 'abcdef0123', ficheId: 'f', rev: 'r', titre: 'T', set: { kind: 'x' }, changements: [], raisons: [], quand: Date.now(), statut: 'attente' }));
    expect(await traiterTelegram(b.kv, btn('ye:v:abcdef0123'), b.deps)).toMatch(/clé d'écriture Sanity manque/);
  });
  it('Paul : sans clé d\'écriture branchée, rien n\'est écrit', async () => {
    const b = banc();
    await b.kv.hset('paul:propositions', 'abcdef0123', JSON.stringify({ id: 'abcdef0123', depot: 'D/qg', fichier: 'README.md', statut: 'attente', quand: Date.now(), contenu: 'x' }));
    expect(await traiterTelegram(b.kv, btn('pau:v:abcdef0123'), b.deps)).toMatch(/clé d'écriture GitHub manque/);
  });
});
