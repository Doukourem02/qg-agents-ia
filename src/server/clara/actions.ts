import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import type { Bouton } from '../telegram';
import { ErreurGmail, type Boite, type BoiteOuverte, type Corbeille } from './imap';
import { CLES_CLARA, idExpediteur, marquerNettoye, normaliser, type StatExpediteur } from './stats';

// Les décisions du patron et les seules actions de Clara sur la boîte : corbeille (UID MOVE vers \Trash), jamais rien d'autre.
// Règles non négociables : aucune corbeille sans son « Oui » (question 1) ou un bannissement (question 2),
// et le VIP gagne toujours, revérifié juste avant chaque lot déplacé.

export const CLES_ACTIONS = {
  verrou: (id: string) => `clara:verrou:${id}`,
  reprise: (id: string) => `clara:reprise:${id}`,
} as const;

/** Au plus 500 UID par `UID MOVE`. */
export const LOT = 500;
export const JOURNAL_MAX = 100;
const VERROU_SECONDES = 300;
/** Un appel s'arrête de lui-même avant la limite de Vercel (300 s) ; la suite reprend au prochain appel. */
const BUDGET_MS = 240_000;
const DELAI_DESABO = 10_000;

export type Question = {
  id: string; adresse: string; nom?: string; etape: 1 | 2; quand: number;
  /** « o » : Le patron a dit Oui à la question 1, la corbeille est commencée (reprise possible). */
  reponse?: 'o';
  deplaces?: number; dernierUid?: number;
  /** Étape 2 : false tant que la question 2 n'est pas partie sur Telegram (le Oui suivant la renvoie). Absent = partie. */
  q2Envoyee?: boolean;
};
export type Banni = {
  adresse: string; depuis: number; deplaces: number; dernierUid: number; desabonne?: boolean;
  /** Le désabonnement de l'expéditeur, rangé au bannissement (https seulement) : survit au recalcul des statistiques. */
  desabo?: { url: string; unClic: boolean };
};
export type Garde = { adresse: string; depuis: number };
export type Nettoyage = { quand: number; adresse: string; n: number };

type BoiteCorbeille = Pick<Boite, 'dossiers'> & Corbeille;
export type DepsReponse = {
  envoyer: (texte: string, boutons?: Bouton[]) => Promise<unknown>;
  ouvrir: () => Promise<BoiteOuverte>;
  fetch?: typeof fetch;
  /** Heure (ms) à laquelle s'arrêter entre deux lots ; par défaut maintenant + 240 s. */
  finAvant?: number;
};

const lire = <T>(v: string | undefined): T | null => {
  if (v === undefined) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const nomDe = (x: { nom?: string; adresse: string }) => x.nom || x.adresse;
/** État de l'agent au mieux : jamais de nom d'expéditeur (le journal du QG peut être filmé). */
const etat = (kv: KV, tache: string, statut: 'au travail' | 'termine' | 'erreur', resultat?: string) =>
  ecrireEtat(kv, { agent: 'clara', statut, tache, outil: 'Gm', ...(resultat ? { resultat } : {}) }).catch(() => undefined);
const messageErreur = (e: unknown) => (e instanceof ErreurGmail || e instanceof Refus ? e.message : 'Gmail injoignable');

// ——— VIP ———

/** Une entrée VIP valide, normalisée en minuscules : adresse (« Nom <a@b.c> » accepté) ou domaine entier `@b.c` ; sinon null. */
export function entreeVip(texte: string): string | null {
  const t = texte.trim().toLowerCase();
  if (!t || t.length > 254) return null;
  if (t.startsWith('@')) return /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) ? t : null;
  const a = normaliser(t).adresse;
  return /^[^\s@<>"',;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(a) ? a : null;
}

export async function lireVip(kv: KV): Promise<string[]> {
  return Object.keys(await kv.hgetall(CLES_CLARA.vip)).sort();
}

/** Vrai si l'adresse ou son domaine (sous-domaines compris : `@banque.ci` couvre `x@mail.banque.ci`) est VIP. */
export function correspondVip(adresseBrute: string, vip: Set<string>): boolean {
  const { adresse, domaine } = normaliser(adresseBrute);
  if (vip.has(adresse)) return true;
  const parts = domaine.split('.');
  for (let i = 0; i < parts.length; i++) if (vip.has('@' + parts.slice(i).join('.'))) return true;
  return false;
}

export async function estVip(kv: KV, adresse: string): Promise<boolean> {
  return correspondVip(adresse, new Set(await lireVip(kv)));
}

export async function ajouterVip(kv: KV, entree: string, now = Date.now()): Promise<string> {
  const e = entreeVip(entree);
  if (!e) throw new Refus('adresse ou domaine VIP invalide', 422);
  await kv.hset(CLES_CLARA.vip, e, JSON.stringify({ depuis: now }));
  return e;
}

/** Renvoie false si l'entrée n'était pas VIP. */
export async function retirerVip(kv: KV, entree: string): Promise<boolean> {
  const e = entreeVip(entree);
  if (!e) throw new Refus('adresse ou domaine VIP invalide', 422);
  const avant = await kv.hmget(CLES_CLARA.vip, [e]);
  if (!(e in avant)) return false;
  await kv.hdel(CLES_CLARA.vip, e);
  return true;
}

// ——— Lectures ———

const lireQuestion = async (kv: KV, id: string) => lire<Question>((await kv.hmget(CLES_CLARA.questions, [id]))[id]);
const lireBanni = async (kv: KV, id: string) => lire<Banni>((await kv.hmget(CLES_CLARA.bannis, [id]))[id]);
const lireStat = async (kv: KV, id: string) => lire<StatExpediteur>((await kv.hmget(CLES_CLARA.stats, [id]))[id]);

async function journaliser(kv: KV, n: Nettoyage) {
  // le total courant d'abord : le journal, lui, est coupé aux 100 dernières entrées
  await kv.hincrby(CLES_CLARA.compteurs, 'mailsNettoyes', n.n);
  await kv.lpush(CLES_CLARA.journal, JSON.stringify(n));
  await kv.ltrim(CLES_CLARA.journal, 0, JOURNAL_MAX - 1);
}

/** Le lien de désabonnement s'il est en https (le seul qu'on affiche ou qu'on suit), sinon null. */
export function lienHttps(desabo?: { url: string }): string | null {
  if (!desabo?.url) return null;
  try { return new URL(desabo.url).protocol === 'https:' ? desabo.url : null; } catch { return null; }
}

/** Le désabonnement d'un expéditeur : celui du banni, sinon celui de sa fiche — seulement si la fiche est bien la sienne. */
async function desaboDe(kv: KV, id: string, adresse: string, b?: Banni | null): Promise<StatExpediteur['desabo']> {
  if (b?.desabo) return b.desabo;
  const stat = await lireStat(kv, id);
  // deux adresses peuvent partager un id court : jamais le lien d'un autre expéditeur
  if (!stat || normaliser(stat.adresse).adresse !== normaliser(adresse).adresse) return undefined;
  return stat.desabo;
}

// ——— Question 1 ———

/** Pose la question 1 sur Telegram (boutons `cl1:<id>:o` / `cl1:<id>:n`). Refuse un VIP, un gardé, un banni. */
export async function poserQuestion1(
  kv: KV, envoyer: DepsReponse['envoyer'], stat: StatExpediteur, now = Date.now(),
): Promise<void> {
  const adresse = normaliser(stat.adresse).adresse;
  if (!adresse.includes('@')) throw new Refus('adresse d\'expéditeur invalide', 422);
  const id = idExpediteur(adresse);
  if (await estVip(kv, adresse)) throw new Refus('expéditeur VIP', 422);
  if (id in (await kv.hmget(CLES_CLARA.gardes, [id]))) throw new Refus('expéditeur gardé', 422);
  if (id in (await kv.hmget(CLES_CLARA.bannis, [id]))) throw new Refus('expéditeur déjà banni', 422);
  if (await lireQuestion(kv, id)) return; // déjà posée : pas deux fois

  const q: Question = { id, adresse, etape: 1, quand: now };
  if (stat.nom) q.nom = stat.nom;
  await kv.hset(CLES_CLARA.questions, id, JSON.stringify(q));
  const ouverts = Math.max(0, stat.total - stat.nonLus);
  try {
    await envoyer(
      `${nomDe(q)} (${pluriel(stat.total, 'mail')}, ${pluriel(ouverts, 'ouvert')}) est indésirable. Je mets ses mails à la corbeille ?`,
      [{ texte: 'Oui', donnee: `cl1:${id}:o` }, { texte: 'Non', donnee: `cl1:${id}:n` }],
    );
  } catch (e) {
    await kv.hdel(CLES_CLARA.questions, id);
    throw e;
  }
}

/**
 * Renvoie la question en attente des expéditeurs restés sans réponse (question 1 sans « Oui » commencé, ou
 * question 2 « plus jamais ? ») : par exemple quand
 * des clics se sont perdus. Ne crée rien, ne déplace rien : seulement les mêmes boutons, espacés de `pause` ms.
 */
export async function relancerQuestions1(
  kv: KV, envoyer: DepsReponse['envoyer'], pause = 1100, attendre: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<number> {
  const questions = Object.values(await kv.hgetall(CLES_CLARA.questions)).map(v => lire<Question>(v)).filter((q): q is Question => !!q);
  let n = 0;
  for (const q of questions) {
    if (await estVip(kv, q.adresse)) continue;
    if (q.etape === 2) {
      // la corbeille est faite : on renvoie seulement « plus jamais ? »
      if (n > 0) await attendre(pause);
      await envoyer(`Rappel : tu ne veux plus jamais recevoir les mails de ${nomDe(q)} ?`,
        [{ texte: 'Oui', donnee: `cl2:${q.id}:o` }, { texte: 'Non', donnee: `cl2:${q.id}:n` }]);
      n++;
      continue;
    }
    if (q.reponse) continue;
    const stat = await lireStat(kv, q.id);
    const detail = stat ? ` (${pluriel(stat.total, 'mail')}, ${pluriel(Math.max(0, stat.total - stat.nonLus), 'ouvert')})` : '';
    if (n > 0) await attendre(pause);
    await envoyer(`Rappel : ${nomDe(q)}${detail} est indésirable. Je mets ses mails à la corbeille ?`,
      [{ texte: 'Oui', donnee: `cl1:${q.id}:o` }, { texte: 'Non', donnee: `cl1:${q.id}:n` }]);
    n++;
  }
  return n;
}

// ——— Corbeille ———

/**
 * Déplace `uids` par lots de 500. Avant CHAQUE lot : relit la liste VIP et le From de chaque mail du lot ;
 * ne déplace que les mails dont l'adresse From est exactement `adresse` (la recherche IMAP FROM est une
 * sous-chaîne) et qui ne sont pas VIP. `encore()` peut tout arrêter (débanni entre-temps).
 */
async function parLots(
  kv: KV, boite: BoiteCorbeille, tous: string, adresse: string, uids: number[],
  apresLot: (dernierUid: number, n: number) => Promise<void>, finAvant: number, encore?: () => Promise<boolean>,
): Promise<{ fini: boolean }> {
  const tries = [...new Set(uids)].sort((x, y) => x - y);
  for (let i = 0; i < tries.length; i += LOT) {
    if (Date.now() >= finAvant) return { fini: false };
    if (encore && !(await encore())) return { fini: true };
    const lot = tries.slice(i, i + LOT);
    const de = await boite.expediteurs(tous, lot);
    // la liste VIP en dernier, juste avant le déplacement
    const vip = new Set(await lireVip(kv));
    const aDeplacer = lot.filter(u => {
      const a = normaliser(de.get(u) ?? '').adresse;
      return a === adresse && !correspondVip(a, vip);
    });
    const n = aDeplacer.length ? await boite.corbeille(tous, aDeplacer) : 0;
    await apresLot(lot[lot.length - 1], n);
  }
  return { fini: true };
}

/**
 * Met à la corbeille tous les mails existants de `adresse` (« Tous les messages », archives comprises), sauf VIP.
 * Reprend où un appel précédent s'est arrêté (`clara:reprise:<id>`). `deplaces` est le total, reprises comprises.
 */
export async function corbeilleDetail(
  kv: KV, boite: BoiteCorbeille, adresseBrute: string, options: { finAvant?: number; now?: number } = {},
): Promise<{ deplaces: number; fini: boolean; dernierUid: number }> {
  const adresse = normaliser(adresseBrute).adresse;
  if (!adresse.includes('@')) throw new Refus('adresse d\'expéditeur invalide', 422);
  const cle = CLES_ACTIONS.reprise(idExpediteur(adresse));
  const r = await kv.hgetall(cle);
  let dernierUid = Number(r.dernierUid) || 0, deplaces = Number(r.deplaces) || 0;
  const { tous, corbeille } = await boite.dossiers();
  if (tous === corbeille) throw new ErreurGmail('Gmail injoignable');
  const uids = await boite.chercherDe(tous, adresse, dernierUid);
  const { fini } = await parLots(kv, boite, tous, adresse, uids, async (dernier, n) => {
    deplaces += n;
    dernierUid = Math.max(dernierUid, dernier);
    // le compte d'abord : coupé entre les deux, le lot est recherché à nouveau mais ses mails ne sont plus là
    await kv.hset(cle, 'deplaces', String(deplaces));
    await kv.hset(cle, 'dernierUid', String(dernierUid));
  }, options.finAvant ?? Date.now() + BUDGET_MS);
  if (fini) {
    await kv.del(cle);
    if (deplaces > 0) await journaliser(kv, { quand: options.now ?? Date.now(), adresse, n: deplaces });
    // ses anciens chiffres ne sont plus vrais : il n'est plus reproposé avec eux
    await marquerNettoye(kv, idExpediteur(adresse), options.now ?? Date.now());
  }
  return { deplaces, fini, dernierUid };
}

export async function corbeilleExpediteur(kv: KV, boite: BoiteCorbeille, adresse: string, options: { finAvant?: number } = {}): Promise<number> {
  return (await corbeilleDetail(kv, boite, adresse, options)).deplaces;
}

// ——— Bannis ———

/** Pour chaque banni : ses mails arrivés depuis le dernier passage (UID > dernierUid) vont à la corbeille, sauf VIP. */
export async function appliquerBannis(
  kv: KV, boite: BoiteCorbeille, now: number, options: { finAvant?: number } = {},
): Promise<{ deplaces: number }> {
  const finAvant = options.finAvant ?? Date.now() + BUDGET_MS;
  const bannis = Object.entries(await kv.hgetall(CLES_CLARA.bannis));
  if (!bannis.length) return { deplaces: 0 };
  await etat(kv, 'applique les bannissements', 'au travail');
  let total = 0;
  try {
    const { tous, corbeille } = await boite.dossiers();
    if (tous === corbeille) throw new ErreurGmail('Gmail injoignable');
    for (const [id, brut] of bannis) {
      if (Date.now() >= finAvant) break;
      const b0 = lire<Banni>(brut);
      if (!b0?.adresse) continue;
      if (!(await kv.setnx(CLES_ACTIONS.verrou(id), String(now), VERROU_SECONDES))) continue; // déjà en cours ailleurs
      try {
        let ici = 0;
        const uids = await boite.chercherDe(tous, b0.adresse, b0.dernierUid || 0);
        await parLots(kv, boite, tous, normaliser(b0.adresse).adresse, uids, async (dernier, n) => {
          ici += n;
          total += n;
          const b = await lireBanni(kv, id);
          if (!b) return; // débanni entre-temps : ne pas le recréer
          b.deplaces = (b.deplaces || 0) + n;
          b.dernierUid = Math.max(b.dernierUid || 0, dernier);
          await kv.hset(CLES_CLARA.bannis, id, JSON.stringify(b));
        }, finAvant, async () => (await lireBanni(kv, id)) !== null);
        if (ici > 0) await journaliser(kv, { quand: now, adresse: b0.adresse, n: ici });
      } finally {
        await kv.del(CLES_ACTIONS.verrou(id)).catch(() => undefined);
      }
    }
  } catch (e) {
    await etat(kv, 'bannissements interrompus', 'erreur');
    throw e;
  }
  await etat(kv, 'bannissements appliqués', 'termine', `${pluriel(total, 'mail')} à la corbeille`);
  return { deplaces: total };
}

// ——— Désabonnement ———

/** Une IP écrite en clair (v4, v6) ou localhost : jamais visée par le serveur. */
function hoteInterdit(hote: string): boolean {
  const h = hote.toLowerCase().replace(/\.$/, '');
  return h.startsWith('[') || h.includes(':') || /^\d+(\.\d+){3}$/.test(h) || h === 'localhost' || h.endsWith('.localhost');
}

/** Désabonnement « un clic » (RFC 8058) seulement : POST sur une URL https ; jamais de mailto. */
export async function desabonner(stat: Pick<StatExpediteur, 'desabo'>, f: typeof fetch = fetch): Promise<boolean> {
  if (!stat.desabo?.unClic) return false;
  let url: URL;
  try { url = new URL(stat.desabo.url); } catch { return false; }
  if (url.protocol !== 'https:' || hoteInterdit(url.hostname)) return false;
  try {
    const r = await f(url.toString(), {
      method: 'POST',
      // une redirection n'est jamais suivie (elle pourrait viser le réseau interne) : elle compte comme un échec
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      signal: AbortSignal.timeout(DELAI_DESABO),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ——— Les boutons ———

const DONNEE = /^(cl1|cl2):([a-z0-9]{1,16}):([on])$|^cld:([a-z0-9]{1,16})$/;

/** Réponse à un bouton de Clara (`cl1:<id>:o|n`, `cl2:<id>:o|n`, `cld:<id>`). Idempotent : un bouton rejoué ne refait rien. */
export async function repondre(kv: KV, deps: DepsReponse, donnee: string, now: number): Promise<string> {
  const m = DONNEE.exec(donnee);
  if (!m) return 'Bouton inconnu.';
  const id = m[2] ?? m[4];
  if (!(await kv.setnx(CLES_ACTIONS.verrou(id), String(now), VERROU_SECONDES))) return 'Déjà en cours, patiente un instant.';
  try {
    if (m[4]) return await reponseDesabo(kv, deps, id);
    if (m[1] === 'cl1') return m[3] === 'o' ? await ouiCorbeille(kv, deps, id) : await nonCorbeille(kv, id, now);
    return await reponseBannir(kv, deps, id, m[3] === 'o', now);
  } finally {
    await kv.del(CLES_ACTIONS.verrou(id)).catch(() => undefined);
  }
}

/** Envoie la question 2 ; note qu'elle est partie. Renvoie false si Telegram a échoué (le Oui suivant la renverra). */
async function envoyerQuestion2(kv: KV, deps: DepsReponse, q: Question): Promise<boolean> {
  try {
    await deps.envoyer(`Tu ne veux plus jamais recevoir les mails de ${nomDe(q)} ?`, [
      { texte: 'Oui', donnee: `cl2:${q.id}:o` }, { texte: 'Non', donnee: `cl2:${q.id}:n` },
    ]);
  } catch {
    // un bouton pour la redemander (si Telegram répond de nouveau) ; sinon le texte final le dit
    await deps.envoyer(`Touche « Continuer » pour la question suivante sur ${nomDe(q)}.`, [{ texte: 'Continuer', donnee: `cl1:${q.id}:o` }])
      .catch(() => undefined);
    return false;
  }
  await kv.hset(CLES_CLARA.questions, q.id, JSON.stringify({ ...q, q2Envoyee: true }));
  return true;
}

async function ouiCorbeille(kv: KV, deps: DepsReponse, id: string): Promise<string> {
  const q = await lireQuestion(kv, id);
  // question 2 jamais partie : on la renvoie (sans rien redéplacer)
  if (q?.etape === 2 && q.q2Envoyee === false) {
    return (await envoyerQuestion2(kv, deps, q)) ? 'Question suivante renvoyée.' : 'La question suivante n\'a pas pu partir : réessaie « Continuer » plus tard.';
  }
  if (!q || q.etape !== 1) return 'Déjà fait.';
  if (await estVip(kv, q.adresse)) {
    await kv.hdel(CLES_CLARA.questions, id);
    await kv.del(CLES_ACTIONS.reprise(id));
    return `${nomDe(q)} est VIP : je ne touche pas à ses mails.`;
  }
  if (q.reponse !== 'o') {
    q.reponse = 'o';
    await kv.hset(CLES_CLARA.questions, id, JSON.stringify(q));
  }
  const continuer = (texte: string) =>
    deps.envoyer(texte, [{ texte: 'Continuer', donnee: `cl1:${id}:o` }]).catch(() => undefined);
  const dejaFaits = async () => Number((await kv.hgetall(CLES_ACTIONS.reprise(id))).deplaces) || 0;

  await etat(kv, 'met des mails à la corbeille', 'au travail');
  let boite: BoiteOuverte;
  try {
    boite = await deps.ouvrir();
  } catch (e) {
    await etat(kv, 'connexion à Gmail impossible', 'erreur');
    await continuer(`Touche « Continuer » pour mettre à la corbeille les mails de ${nomDe(q)}.`);
    return `${messageErreur(e)} : rien n'est déplacé pour l'instant.`;
  }
  let r: Awaited<ReturnType<typeof corbeilleDetail>>;
  try {
    r = await corbeilleDetail(kv, boite, q.adresse, { finAvant: deps.finAvant });
  } catch (e) {
    console.error(e instanceof Error ? e.name : 'erreur');
    await etat(kv, 'mise à la corbeille interrompue', 'erreur');
    const n = await dejaFaits().catch(() => 0);
    await continuer(`Touche « Continuer » pour reprendre la mise à la corbeille de ${nomDe(q)}.`);
    return `Mise à la corbeille interrompue (${messageErreur(e)}) : ${pluriel(n, 'mail')} déjà à la corbeille.`;
  } finally {
    await boite.fermer().catch(() => undefined);
  }
  if (!r.fini) {
    await etat(kv, 'mise à la corbeille en pause', 'termine', `${pluriel(r.deplaces, 'mail')} à la corbeille`);
    await continuer(`Touche « Continuer » pour finir la mise à la corbeille de ${nomDe(q)}.`);
    return `Mise à la corbeille en cours… ${r.deplaces} déjà.`;
  }
  // l'étape 2 est écrite avant l'envoi : un bouton rejoué trouve l'étape 2 et ne refait rien
  const q2: Question = { id, adresse: q.adresse, etape: 2, quand: q.quand, deplaces: r.deplaces, dernierUid: r.dernierUid, q2Envoyee: false };
  if (q.nom) q2.nom = q.nom;
  await kv.hset(CLES_CLARA.questions, id, JSON.stringify(q2));
  await etat(kv, 'mails mis à la corbeille', 'termine', `${pluriel(r.deplaces, 'mail')} à la corbeille`);
  const fait = `${pluriel(r.deplaces, 'mail')} mis à la corbeille.`;
  // les mails sont déjà à la corbeille : un échec d'envoi ne doit ni le cacher ni bloquer l'expéditeur
  return (await envoyerQuestion2(kv, deps, q2)) ? fait : `${fait} La question suivante n'a pas pu partir : touche « Continuer » quand Telegram répond.`;
}

async function nonCorbeille(kv: KV, id: string, now: number): Promise<string> {
  const q = await lireQuestion(kv, id);
  if (!q || q.etape !== 1) return 'Déjà fait.';
  const g: Garde = { adresse: q.adresse, depuis: now };
  await kv.hset(CLES_CLARA.gardes, id, JSON.stringify(g));
  await kv.hdel(CLES_CLARA.questions, id);
  await kv.del(CLES_ACTIONS.reprise(id));
  return `Gardé : ${nomDe(q)} ne te sera plus proposé.`;
}

async function reponseBannir(kv: KV, deps: DepsReponse, id: string, oui: boolean, now: number): Promise<string> {
  const q = await lireQuestion(kv, id);
  if (!q || q.etape !== 2) return 'Déjà fait.';
  if (!oui) {
    await kv.hdel(CLES_CLARA.questions, id);
    return `Noté : ${nomDe(q)} n'est pas banni.`;
  }
  const desabo = await desaboDe(kv, id, q.adresse);
  const b: Banni = { adresse: q.adresse, depuis: now, deplaces: 0, dernierUid: q.dernierUid ?? 0 };
  // seulement un lien https : c'est le seul affiché dans la page ou suivi
  if (desabo && lienHttps(desabo)) b.desabo = desabo;
  await kv.hset(CLES_CLARA.bannis, id, JSON.stringify(b));
  await kv.hdel(CLES_CLARA.questions, id);
  let texte = `Banni : les nouveaux mails de ${nomDe(q)} iront à la corbeille.`;
  if (b.desabo?.unClic) {
    await deps.envoyer(`Je te désabonne aussi de ${nomDe(q)} ?`, [{ texte: 'Se désabonner', donnee: `cld:${id}` }]);
  } else if (b.desabo) {
    texte += '\nPas de désabonnement automatique : lien dans la page.';
  }
  return texte;
}

async function reponseDesabo(kv: KV, deps: DepsReponse, id: string): Promise<string> {
  const b = await lireBanni(kv, id);
  if (!b) return 'Cet expéditeur n\'est pas banni : rien à faire.';
  if (b.desabonne) return 'Déjà fait.';
  const desabo = await desaboDe(kv, id, b.adresse, b);
  const lien = lienHttps(desabo) !== null;
  if (!desabo?.unClic || !lien) return lien ? 'Pas de désabonnement automatique : lien dans la page.' : 'Pas de désabonnement automatique.';
  if (!(await desabonner({ desabo }, deps.fetch ?? fetch))) return 'Le désabonnement n\'a pas abouti : lien dans la page.';
  const b2 = await lireBanni(kv, id);
  if (b2) await kv.hset(CLES_CLARA.bannis, id, JSON.stringify({ ...b2, desabonne: true }));
  return 'Désabonné.';
}
