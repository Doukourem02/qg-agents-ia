import type { KV } from '../memoire';
import { idsEnAttente, lireReponse, repondreAccord, texteConfirmation } from '../accords';
import { Refus } from '../qg';
import type { Bouton, Recu } from '../telegram';
import { RAPPEL_JOURS, statutLinkedIn, URL_CONNEXION } from '../linkedin/connexion';
import { envoyerVisuel, type Deps } from './api';
import { marquerVu } from '../light/api';
import { deposer } from './boite';
import { apresDecision, choisirSujet, marquerPublie, textePret } from './posts';
import type { ResultatPublication } from './publication';
import { aiguiller } from './routage';
import { ajouterVip, repondre, retirerVip } from '../clara/actions';
import type { BoiteOuverte } from '../clara/imap';
import { deciderIsaac } from '../isaac/api';
import { deciderPaul, type DepsEcriture } from '../paul/ecriture';
import { deciderYe, repondreQuestion, type DepsPublication } from '../ye/ecriture';
import { deciderNouvelle, type DepsCreation } from '../ye/nouvelle';
import { deposerStats, estTableur, lireTableur } from './stats';
import { lireCommande } from '../telegram-commandes';
import { boutonSilence, traiterCommande, type DepsSilence, type Reponse } from '../silence';
import { lireSujets, type Lecture } from '../crise/lecture';
import { suivreCrise } from '../crise/suivi';
import { parlerAKuroro } from '../kuroro-telegram';
import type { ClientKuroro } from '../kuroro';
import { executerActions, pasEnPause, type DepsImmediat } from '../missions/immediat';
import { lireActionsImmediates } from '@/sim/actions-immediates';
import { lireIgnores } from '../silence';
import { ignorerSujet } from '../feu/passage';
import { commandeFeu, estQuestionFeu, repondreQuestion as repondreFeu } from '../feu/questions';

// Ce que fait le webhook Telegram de chaque mise à jour, sans réseau : l'envoi est injecté (testable).
// Renvoie le message de confirmation à afficher, ou null si tout a déjà été envoyé.

export type DepsTelegram = {
  envoyer: (texte: string, boutons?: Bouton[] | Bouton[][]) => Promise<unknown>;
  /** Claude pour Kuroro (seulement si la clé existe) ; absent ou null : le modèle local du Mac par le relais. */
  client?: ClientKuroro | null;
  /** La lecture des vraies alertes, pour « ignore » (Upstash par défaut ; un faux dans les tests). */
  lire?: (kv: KV, now: number) => Promise<Lecture>;
  /** La publication sur LinkedIn (`publierPost` branché par la route, un faux dans les tests). */
  publier: (kv: KV, postId: string, forcer: boolean) => Promise<ResultatPublication>;
  /** Le téléchargement d'un fichier reçu (`telechargerFichier` branché par la route). */
  telecharger: (fileId: string) => Promise<{ contenu: Uint8Array }>;
  /** La boîte Gmail de Clara (branchée par la route depuis l'environnement ; toujours refermée après usage). */
  ouvrirGmail?: () => Promise<BoiteOuverte>;
  /** Le fetch du désabonnement « un clic » (global par défaut). */
  fetch?: typeof fetch;
  /** L'écriture sur GitHub après le « Valider » de Paul (GITHUB_ECRITURE_PERSO, branchée par la route). */
  ecriturePaul?: () => DepsEcriture;
  /** La publication sur Sanity après le « Valider » de Ye (SANITY_ECRITURE_PORTFOLIO, branchée par la route). */
  publicationYe?: () => DepsPublication;
  /** La création d'une fiche après « Ajouter » (SANITY_ECRITURE_PORTFOLIO + GITHUB_LECTURE_PERSO pour les images). */
  creationYe?: () => DepsCreation;
  /** Les actions immédiates (vérifier les sites, refaire le tour de sécurité, pause d'un agent), branchées par la route. */
  immediat?: DepsImmediat;
} & Pick<Deps, 'rendre' | 'envoyerImage' | 'envoyerFichier'>;

export const AVERTISSEMENT_VISUEL = '(visuel indisponible, redemande-le)';
export const TEXTE_INCERTAIN = 'La dernière tentative a peut-être abouti : regarde ton profil LinkedIn. '
  + 'S\'il y est, touche « Déjà publié » ; sinon, touche « Republier ».';

/** La ligne de rappel quand la connexion LinkedIn manque ou expire bientôt ; vide sinon. */
async function rappelConnexion(kv: KV): Promise<string> {
  const s = await statutLinkedIn(kv).catch(() => null);
  if (!s) return '';
  const aRenouveler = !s.connecte || (s.joursRestants !== undefined && s.joursRestants <= RAPPEL_JOURS);
  return aRenouveler ? `\n\nLinkedIn : connexion à renouveler, ouvre ${URL_CONNEXION}` : '';
}

/** Ce que le patron lit après « Publier sur LinkedIn ». Les boutons du message touché sont retirés (route) :
 *  un échec renvoie donc un NOUVEAU message, avec le bouton pour réessayer. */
async function apresPublication(r: ResultatPublication, postId: string, deps: DepsTelegram): Promise<string> {
  const reessayer = { texte: 'Réessayer', donnee: 'publier:' + postId };
  switch (r.etat) {
    case 'publie': return `Publié sur LinkedIn : ${r.url}`;
    case 'deja': return r.url ? `Déjà publié : ${r.url}` : 'Déjà publié.';
    case 'en-cours': return 'Publication déjà en cours, patiente un instant.';
    case 'pas-pret': return `Ce post n'est pas prêt à publier (${r.statut}).`;
    case 'inconnu': return 'Ce post est inconnu.';
    case 'non-connecte':
      await deps.envoyer(`LinkedIn n'est pas connecté : ouvre ${URL_CONNEXION}, puis touche « Réessayer ».`, [reessayer]);
      return 'Pas encore publié.';
    case 'echec':
      await deps.envoyer(`Rien n'est publié : ${r.raison}.`, [reessayer]);
      return 'Pas encore publié.';
    case 'incertain':
      await deps.envoyer(TEXTE_INCERTAIN, [
        { texte: 'Republier', donnee: 'republier:' + postId },
        { texte: 'Déjà publié', donnee: 'publie:' + postId },
      ]);
      return 'Pas encore publié.';
  }
}

/** Une réponse avec boutons part tout de suite ; sans boutons, la route l'envoie. */
async function repondreAvec(r: Reponse | null, deps: DepsTelegram): Promise<string | null> {
  if (!r) return null;
  if (!r.boutons) return r.texte;
  await deps.envoyer(r.texte, r.boutons);
  return null;
}

const depsSilence = (kv: KV, deps: DepsTelegram): DepsSilence => ({
  envoyer: deps.envoyer, lire: deps.lire ?? lireSujets,
  // juste après un « ignore », le suivi des réunions : une réunion dont tout est ignoré se termine tout de suite
  apres: (now) => suivreCrise(kv, { envoyer: deps.envoyer, lire: deps.lire }, now),
});

export async function traiterTelegram(kv: KV, u: Recu, deps: DepsTelegram, now = Date.now()): Promise<string | null> {
  const a = aiguiller(u);
  switch (a.vers) {
    case 'silence':
      return repondreAvec(await boutonSilence(kv, a.donnee, depsSilence(kv, deps), now), deps);
    case 'feu-ignorer':
      return ignorerSujet(kv, a.sujet, now);
    case 'kuroro': {
      // les actions immédiates (« vérifie mes sites », « mets Ye en pause cette semaine ») d'abord, puis les commandes
      // (« ignore Livreo », « pas d'alertes pendant 2 h ») : reconnues par le code, jamais par le modèle
      const actions = deps.immediat ? lireActionsImmediates(a.texte, now) : [];
      if (actions.length) {
        const r = await executerActions(kv, actions, 'telegram', deps.immediat!, now);
        if (r) return r.texte;
        // « reprends Zoro » sans pause : c'est peut-être la reprise de ce que j'ai dit d'ignorer (la commande ci-dessous)
        const agent = actions[0].type === 'reprendre-agent' ? actions[0].agent : '';
        if (!(await lireIgnores(kv).catch(() => [])).some(i => i.agent === agent)) return pasEnPause(agent);
      }
      const c = lireCommande(a.texte, now);
      // « ignore BTC », « reprends Feu » : les alertes de Feu (ses sujets à lui, hors réunions de crise)
      if (c && (c.type === 'ignorer' || c.type === 'reprendre')) {
        const f = await commandeFeu(kv, c.type, a.texte, now);
        if (f) return f;
      }
      if (c) {
        const r = await traiterCommande(kv, c, depsSilence(kv, deps), now);
        if (r !== 'kuroro') return repondreAvec(r, deps);
      }
      // une question pour Feu (trading, Binance, crypto, BTC, ETH) : le code répond tout de suite s'il sait, sinon
      // c'est une mission pour Feu (faite dans l'heure par « QG · missions »)
      if (estQuestionFeu(a.texte)) return (await repondreFeu(kv, a.texte, now)).texte;
      return parlerAKuroro(kv, a.texte, { envoyer: deps.envoyer, client: deps.client ?? null }, now);
    }
    case 'start':
      return 'QG · bot prêt. Je t’enverrai ici mes demandes d’accord et les alertes urgentes. Tu peux aussi m’écrire : Kuroro te répond.';
    case 'accord': {
      const lu = lireReponse(a.texte);
      if (lu && !lu.id) {
        // sans #id, on ne devine pas quand plusieurs demandes attendent
        const ids = await idsEnAttente(kv);
        if (ids.length > 1) {
          return `Plusieurs demandes en attente : ${ids.map(i => '#' + i).join(', ')}. Réponds avec l'#id (ex. « ok #${ids[ids.length - 1]} »).`;
        }
      }
      const r = await repondreAccord(kv, a.texte);
      if (!r.compris) return 'QG · je n’ai pas compris. Touche ✅ ou ❌, ou écris « modifie : … ».';
      if (!r.accord) return 'QG · aucune demande d’accord en attente.';
      if ('deja' in r && r.deja) return `QG · #${r.accord.id} est déjà traité (${r.accord.statut}).`;
      const info = texteConfirmation(r.accord);
      if (r.accord.cle?.startsWith('post:')) {
        const { post, aEnvoyer } = await apresDecision(kv, r.accord.id);
        if (aEnvoyer === 'pret') {
          await deps.envoyer(info);
          // L'image précède le texte prêt, mais ne le bloque jamais : en cas d'échec, une ligne le signale.
          let avertissement = '';
          if (post.visuel) {
            try {
              await envoyerVisuel(post.visuel, `Visuel à publier avec : ${post.sujet}`, deps);
            } catch (e) {
              console.error(e);
              avertissement = `\n\n${AVERTISSEMENT_VISUEL}`;
            }
          }
          await deps.envoyer(textePret(post) + avertissement + await rappelConnexion(kv), [
            { texte: 'Publier sur LinkedIn', donnee: 'publier:' + post.id },
            { texte: 'Déjà publié', donnee: 'publie:' + post.id },
          ]);
          return null;
        }
        if (aEnvoyer === 'abandon') return `${info}\nBrouillon abandonné.`;
        if (aEnvoyer === 'revision') return `${info}\nBien reçu, L reprend le texte.`;
      }
      return info;
    }
    case 'clara':
      return repondre(kv, {
        envoyer: deps.envoyer, fetch: deps.fetch,
        ouvrir: deps.ouvrirGmail ?? (async () => { throw new Refus('Gmail non configuré', 503); }),
      }, a.donnee, Date.now());
    case 'isaac':
      return deciderIsaac(kv, a.id, a.oui);
    case 'ye':
      if (a.quoi === 'o' || a.quoi === 'n') return repondreQuestion(kv, a.id, a.quoi === 'o');
      if (a.quoi === 'a' || a.quoi === 'p' || a.quoi === 'j') {
        const choix = a.quoi === 'a' ? 'ajouter' : a.quoi === 'p' ? 'plus-tard' : 'jamais';
        return deciderNouvelle(kv, a.id, choix, deps.creationYe?.() ?? { fetch: deps.fetch ?? fetch, jeton: undefined, github: undefined });
      }
      return deciderYe(kv, a.id, a.quoi === 'v', deps.publicationYe?.() ?? { fetch: deps.fetch ?? fetch, jeton: undefined });
    case 'paul':
      return deciderPaul(kv, a.id, a.valider, deps.ecriturePaul?.() ?? { fetch: deps.fetch ?? fetch, jeton: undefined });
    case 'clara-vip': {
      if (!a.entree) return 'Je n\'ai pas compris l\'adresse. Écris « VIP : nom@exemple.com » ou « VIP : @domaine.com ».';
      if (a.ajout) return `VIP ajouté : ${await ajouterVip(kv, a.entree)}. Clara ne touchera jamais à ses mails.`;
      return (await retirerVip(kv, a.entree)) ? `${a.entree} n'est plus VIP.` : `${a.entree} n'était pas VIP.`;
    }
    case 'clara-vips': {
      const reponses: string[] = [];
      for (const l of a.lignes) {
        if (!l.entree) { reponses.push('Une ligne illisible : écris « VIP : nom@exemple.com » ou « VIP : @domaine.com ».'); continue; }
        if (l.ajout) reponses.push(`VIP ajouté : ${await ajouterVip(kv, l.entree)}.`);
        else reponses.push((await retirerVip(kv, l.entree)) ? `${l.entree} n'est plus VIP.` : `${l.entree} n'était pas VIP.`);
      }
      return reponses.join('\n') + '\nClara ne touchera jamais aux mails de tes VIP.';
    }
    case 'vu-light':
      return marquerVu(kv, a.jour);
    case 'sujet': {
      const p = await choisirSujet(kv, a.propositionId, a.index).catch(() => null);
      return p ? `Noté : L rédige « ${p.sujets[a.index]?.titre} ».` : 'Cette proposition de sujets est inconnue.';
    }
    case 'publie': {
      try {
        await marquerPublie(kv, a.postId);
        return 'Bravo, c’est noté.';
      } catch (e) {
        if (e instanceof Refus && e.code === 409) return 'Ce post n’est pas prêt à publier : rien n’est noté.';
        return 'Ce post est inconnu.';
      }
    }
    case 'publier':
      return apresPublication(await deps.publier(kv, a.postId, a.forcer), a.postId, deps);
    case 'boite': {
      // Un export de statistiques (tableur) va dans les stats, pas dans la boîte.
      if (u.type === 'fichier' && estTableur(u.nom)) {
        try {
          const { contenu } = await deps.telecharger(u.fileId);
          const feuilles = await lireTableur(u.nom, contenu);
          await deposerStats(kv, u.nom, feuilles);
          return `Statistiques reçues (${feuilles.length} feuille${feuilles.length > 1 ? 's' : ''}). L prépare le bilan dans l'heure.`;
        } catch (e) {
          console.error(e);
          return `Je n'ai pas pu lire ce fichier : ${e instanceof Refus ? e.message : 'erreur inattendue'}.`;
        }
      }
      await deposer(kv, { id: u.id, type: a.type, contenu: a.contenu });
      return 'Reçu, L s’en occupe dans l’heure.';
    }
    default:
      return null;
  }
}
