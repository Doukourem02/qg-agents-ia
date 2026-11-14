import type { KV } from '../memoire';
import { annulerAccord, lireAccord } from '../accords';
import { ecrireEtat, Refus } from '../qg';
import { statutLinkedIn } from '../linkedin/connexion';
import type { Bouton } from '../telegram';
import { dernierBilan, enregistrerBilan, validerBilan } from './bilan';
import { marquerStatsTraite, statsATraiter } from './stats';
import { aTraiter, CLE_BOITE, marquerTraite, type ElementBoite } from './boite';
import { ajouterRegle, autoriser, CATALOGUE_PROJETS, lireMemoire, projetsInterdits, type MemoireL, type Visibilite } from './memoire';
import {
  CLE_POSTS, CLE_PROPOSITIONS, deposerBrouillon, sujetsRediges, verifierBrouillon, enregistrerPropositions,
  type Post, type Proposition, type Sujet,
} from './posts';
import { listeCaptures, textesDuVisuel, validerVisuel, type Visuel } from './visuels';

// Les entrées de L pour sa routine : une action = une fonction, testable sans réseau (les envois sont injectés).

export type Rendu = { png: Uint8Array; pdf?: Uint8Array };
export type Deps = {
  envoyer: (texte: string, boutons?: Bouton[]) => Promise<unknown>;
  /** Le rendu et l'envoi des visuels : branchés par les routes, des faux dans les tests. */
  rendre?: (v: Visuel) => Promise<Rendu>;
  envoyerImage?: (png: Uint8Array, legende?: string) => Promise<unknown>;
  envoyerFichier?: (contenu: Uint8Array, nom: string, legende?: string) => Promise<unknown>;
};

/** Rend le visuel et l'envoie : l'image, puis le PDF d'un carrousel. Lève une erreur au moindre échec. */
export async function envoyerVisuel(v: Visuel, legende: string, deps: Pick<Deps, 'rendre' | 'envoyerImage' | 'envoyerFichier'>) {
  if (!deps.rendre || !deps.envoyerImage) throw new Error('rendu ou envoi d’image non branché');
  const { png, pdf } = await deps.rendre(v);
  await deps.envoyerImage(png, legende);
  if (pdf) {
    if (!deps.envoyerFichier) throw new Error('envoi de fichier non branché');
    await deps.envoyerFichier(pdf, 'carrousel.pdf');
  }
}

/** Valide un visuel (400) et refuse (422) un projet non autorisé dans ses textes. */
function visuelSur(m: MemoireL, v: unknown): Visuel {
  const visuel = validerVisuel(v, listeCaptures());
  verifierProjets(m, textesDuVisuel(visuel), 'le visuel');
  return visuel;
}

const texteNonVide = (v: unknown, nom: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Refus(`« ${nom} » manquant`);
  return v;
};
const court = (t: string, max = 100) => (t.length > max ? t.slice(0, max - 1) + '…' : t);
// `outil` allume l'icône correspondante dans la page (in = LinkedIn, Tg = Telegram)
const etat = (kv: KV, tache: string, outil?: 'in' | 'Tg') => ecrireEtat(kv, { agent: 'L', statut: 'au travail', tache: court(tache, 140), ...(outil ? { outil } : {}) });

/** Refuse (422) un texte qui sort du QG et nomme un projet non autorisé. */
function verifierProjets(m: MemoireL, texte: string, ou: string) {
  const interdits = projetsInterdits(m, texte, CATALOGUE_PROJETS);
  if (interdits.length) throw new Refus(`projet non autorisé dans ${ou} : ${interdits.join(', ')}`, 422);
}

const TACHE_TRAITE: Record<ElementBoite['type'], string> = {
  lien: 'commente un lien', commentaire: 'répond à un commentaire', note: 'applique une note', fichier: 'lit un fichier',
};

/** La demande d'accord d'un post : le texte entier, puis les hashtags, puis les boutons (moins de 4 000 caractères). */
const texteDemandePost = (post: Post, accordId: string) =>
  `L · brouillon à valider #${accordId}\n(pour toi seulement : ${post.sujet})\n\n`
  + `▼ LE POST, tel qu'il paraîtra sur LinkedIn ▼\n\n${post.texte}\n\n${post.hashtags.join(' ')}\n\n▲ fin du post ▲\n\n`
  + `Touche ✅ pour valider, ❌ pour refuser, ou écris « modifie #${accordId} : … ».`;

const MAX_CARACTERES_STATS = 60000;

/** Le plus ancien dépôt non traité seulement, borné à 60 000 caractères de cellules (`tronque` si on a coupé). */
async function contexteStats(kv: KV) {
  const attente = await statsATraiter(kv);
  const premier = attente[0];
  if (!premier) return { statsATraiter: [], statsEnAttente: 0 };
  let reste = MAX_CARACTERES_STATS, tronque = false;
  const feuilles = premier.feuilles.map(f => {
    const lignes: string[][] = [];
    for (const l of f.lignes) {
      const n = l.reduce((t, c) => t + c.length, 0);
      if (n > reste) { tronque = true; break; }
      reste -= n; lignes.push(l);
    }
    return { ...f, lignes };
  });
  return { statsATraiter: [{ ...premier, feuilles, ...(tronque ? { tronque: true } : {}) }], statsEnAttente: attente.length };
}

async function contexte(kv: KV) {
  const propositions = Object.values(await kv.hgetall(CLE_PROPOSITIONS)).map(v => JSON.parse(v) as Proposition);
  const propositionEnCours = propositions.sort((a, b) => b.quand - a.quand)[0] ?? null;
  const posts = Object.values(await kv.hgetall(CLE_POSTS)).map(v => JSON.parse(v) as Post);
  const rediges = await sujetsRediges(kv, propositionEnCours, posts);
  const postsEnAccord = posts.filter(p => p.statut === 'en accord').sort((a, b) => a.quand - b.quand)
    .map(p => ({ id: p.id, sujet: p.sujet, texte: p.texte, hashtags: p.hashtags, accordId: p.accordId }));
  const postsEnAttente: (Post & { demande?: string })[] = [];
  for (const p of posts.filter(x => x.statut === 'brouillon')) {
    const accord = p.accordId ? await lireAccord(kv, p.accordId) : null;
    postsEnAttente.push(accord?.statut === 'modifie' && accord.detail ? { ...p, demande: accord.detail } : p);
  }
  return {
    memoire: await lireMemoire(kv),
    aTraiter: await aTraiter(kv),
    propositionEnCours: propositionEnCours ? { ...propositionEnCours, rediges } : null,
    postsEnAttente,
    postsEnAccord,
    captures: listeCaptures(),
    ...(await contexteStats(kv)),
    dernierBilan: await dernierBilan(kv),
    linkedin: await statutLinkedIn(kv).catch(() => ({ connecte: false })),
    aujourdhui: new Date().toISOString().slice(0, 10),
  };
}

export async function traiterAction(kv: KV, action: string, corps: Record<string, unknown>, deps: Deps): Promise<unknown> {
  switch (action) {
    case 'contexte':
      return contexte(kv);

    case 'propositions': {
      if (!Array.isArray(corps.sujets)) throw new Refus('« sujets » doit être une liste');
      const m = await lireMemoire(kv);
      (corps.sujets as Sujet[]).forEach((s, i) =>
        verifierProjets(m, [s?.titre, s?.angle, s?.accroche, s?.pourquoiMoi].filter(x => typeof x === 'string').join('\n'), `le sujet ${i + 1}`));
      const p = await enregistrerPropositions(kv, corps.sujets as Sujet[]);
      const liste = p.sujets.map((s, i) => `${i + 1}. ${s.titre}\n   ${s.angle}`).join('\n\n');
      await deps.envoyer(`Trois sujets pour cette semaine :\n\n${liste}\n\nLequel on développe ?`,
        p.sujets.map((_, i) => ({ texte: String(i + 1), donnee: `sujet:${p.id}:${i}` })));
      await etat(kv, 'propose 3 sujets', 'Tg');
      return { proposition: p };
    }

    case 'brouillon': {
      const sujet = texteNonVide(corps.sujet, 'sujet');
      if (sujet.length > 200) throw new Refus('« sujet » trop long (200 caractères au plus)');
      const texte = texteNonVide(corps.texte, 'texte');
      const h = corps.hashtags;
      if (!Array.isArray(h) || !h.every(x => typeof x === 'string')) throw new Refus('« hashtags » doit être une liste de textes');
      if (h.some(x => x.length > 50)) throw new Refus('un hashtag fait 50 caractères au plus');
      const revisionDe = typeof corps.revisionDe === 'string' ? corps.revisionDe : undefined;
      let propositionId = corps.propositionId, index = corps.index;
      if (propositionId !== undefined && (typeof propositionId !== 'string' || !propositionId.trim())) throw new Refus('« propositionId » doit être un texte');
      if (index !== undefined && (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 2)) throw new Refus('« index » doit valoir 0, 1 ou 2');
      if ((propositionId === undefined) !== (index === undefined)) throw new Refus('« propositionId » et « index » vont ensemble');
      const brutAncien = revisionDe ? (await kv.hgetall(CLE_POSTS))[revisionDe] : undefined;
      const ancien = brutAncien ? (JSON.parse(brutAncien) as Post) : null;
      if (ancien && propositionId === undefined && ancien.propositionId !== undefined) {
        propositionId = ancien.propositionId; index = ancien.index;
      }
      const memoire = await lireMemoire(kv);
      // Une révision sans visuel garde celui de l'ancien post ; il est revérifié (la mémoire a pu changer).
      const brutVisuel = corps.visuel ?? ancien?.visuel;
      const visuel = brutVisuel !== undefined ? visuelSur(memoire, brutVisuel) : undefined;
      verifierBrouillon({ sujet, texte, hashtags: h as string[] }, memoire);
      // L'image part AVANT que la demande existe : tant qu'elle n'est pas en attente, aucun « ok » tapé ne peut
      // valider un post dont le patron n'a pas encore lu le texte. Un échec ici ne laisse rien derrière lui.
      if (visuel) {
        try {
          await envoyerVisuel(visuel, `Visuel proposé pour : ${sujet} (le texte suit)`, deps);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          throw new Refus(`visuel non envoyé (${detail}) : aucune demande créée, rien d'autre n'est parti`, 502);
        }
      }
      const { post, accordId } = await deposerBrouillon(kv, {
        sujet, texte, hashtags: h as string[],
        ...(propositionId !== undefined ? { propositionId: propositionId as string, index: index as number } : {}),
        ...(visuel ? { visuel } : {}),
      }, memoire);
      if (ancien && ancien.statut !== 'publie') {
        await kv.hset(CLE_POSTS, ancien.id, JSON.stringify({ ...ancien, statut: 'abandonne' }));
        if (ancien.accordId) await annulerAccord(kv, ancien.accordId, `remplacé par le post ${post.id}`);
      }
      // jamais montrée : la demande ne doit pas pouvoir être validée par un « ok » tapé plus tard
      const abandonner = async (raison: string) => {
        await annulerAccord(kv, accordId, raison);
        await kv.hset(CLE_POSTS, post.id, JSON.stringify({ ...post, statut: 'abandonne' }));
      };
      try {
        await deps.envoyer(texteDemandePost(post, accordId), [
          { texte: '✅ OK', donnee: `ok:${accordId}` },
          { texte: '❌ Non', donnee: `non:${accordId}` },
        ]);
      } catch (e) {
        await abandonner('envoi Telegram échoué');
        throw e;
      }
      await etat(kv, `rédige : ${sujet}`, 'in');
      return { post, accordId };
    }

    case 'apercu': {
      // Le corps est le visuel lui-même : validé, vérifié, rendu, et renvoyé sans rien envoyer.
      const visuel = visuelSur(await lireMemoire(kv), corps);
      if (!deps.rendre) throw new Refus('rendu non branché', 500);
      return { image: (await deps.rendre(visuel)).png };
    }

    case 'traite': {
      const id = texteNonVide(corps.id, 'id');
      const resume = texteNonVide(corps.resume, 'resume');
      const reponse = typeof corps.reponse === 'string' && corps.reponse.trim() ? corps.reponse : null;
      if (reponse) verifierProjets(await lireMemoire(kv), reponse, 'la réponse');
      const brut = (await kv.hgetall(CLE_BOITE))[id];
      const type = brut ? (JSON.parse(brut) as ElementBoite).type : null;
      await marquerTraite(kv, id, resume);
      if (reponse) await deps.envoyer(reponse);
      await etat(kv, type ? TACHE_TRAITE[type] : 'traite la boîte');
      return { ok: true };
    }

    case 'question': {
      const texte = texteNonVide(corps.texte, 'texte').trim();
      if (texte.length > 1000) throw new Refus('« texte » trop long (1 000 caractères au plus) : un post passe par « brouillon »');
      verifierProjets(await lireMemoire(kv), texte, 'la question');
      await deps.envoyer(`L · question : ${texte}`);
      await etat(kv, 'pose une question au patron', 'Tg');
      return { ok: true };
    }

    case 'memoire': {
      const aRegle = typeof corps.regle === 'string' && corps.regle.trim() !== '';
      const aProjet = typeof corps.projet === 'string' && corps.projet.trim() !== ''
        && ['nomme', 'anonyme', 'jamais'].includes(corps.visibilite as string);
      if (!aRegle && !aProjet) throw new Refus('il faut « regle », ou « projet » avec « visibilite » (nomme, anonyme, jamais)');
      if (aRegle) await ajouterRegle(kv, corps.regle as string);
      if (aProjet) await autoriser(kv, corps.projet as string, corps.visibilite as Visibilite);
      await etat(kv, 'met sa mémoire à jour');
      return { ok: true };
    }

    case 'bilan': {
      const b = validerBilan(corps);
      const textes = [b.resume, ...b.chiffres.flatMap(c => [c.nom, c.valeur, c.evolution ?? '']), ...b.marche, ...b.lecteurs, ...b.ajustements].join('\n');
      verifierProjets(await lireMemoire(kv), textes, 'le bilan');
      // 404 ou 409 ici, avant tout envoi : le dépôt n'est marqué traité qu'une fois le bilan valide.
      await marquerStatsTraite(kv, b.statsId);
      const bilan = await enregistrerBilan(kv, b);
      const liste = (t: string[]) => t.map(x => `- ${x}`).join('\n');
      let avertissement: string | undefined;
      try {
        await deps.envoyer(`L · bilan de la semaine\n${bilan.resume}\n\nCe qui a marché : ${b.marche.length ? '\n' + liste(b.marche) : 'rien à signaler'}\nCe que j'ajuste : ${b.ajustements.length ? '\n' + liste(b.ajustements) : 'rien pour l’instant'}`);
      } catch {
        avertissement = 'message Telegram non envoyé';
      }
      await etat(kv, 'fait le bilan de la semaine', 'in');
      return avertissement ? { bilan, avertissement } : { bilan };
    }

    default:
      throw new Refus(`action inconnue : ${action}`, 404);
  }
}
