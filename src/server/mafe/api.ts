import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { CLE_BOITE, deposer } from '../l/boite';
import { calculerReleve, CLES_MAFE, jourDe, type DepsMafe, type ReleveMafe } from './releve';

// Les entrées de Mafe pour sa routine et pour le Mac : une action = une fonction, testable sans réseau (l'envoi est injecté).

export type NoteSeance = {
  id: string; depot: string; nom: string; jour: string; jours: string[]; markdown: string; auteur: 'mafe';
  notion?: string; obsidian: boolean; quand: number;
};
export type DepsMafeApi = DepsMafe & { envoyer: (texte: string) => Promise<unknown> };

const MAX_PHRASE = 400;
const MAX_TELEGRAM = 1500;
const MAX_BILAN = 1000;
const MAX_NOTE = 4000;
const MARDI = 2;
const VENDREDI = 5;

type StatutMafe = 'au travail' | 'termine' | 'en pause' | 'erreur';
// `outil` allume l'icône correspondante dans la page (GH = GitHub, Tg = Telegram)
const etat = (kv: KV, tache: string, statut: StatutMafe, outil?: 'GH' | 'Tg') => ecrireEtat(kv, { agent: 'mafe', statut, tache, ...(outil ? { outil } : {}) });
/** Sur un chemin d'erreur : l'état est écrit au mieux, sans masquer l'erreur d'origine. */
const etatSurEchec = (kv: KV, tache: string) => etat(kv, tache, 'erreur').catch(() => undefined);

function texteBorne(v: unknown, nom: string, max: number, requis = true): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (requis) throw new Refus(`« ${nom} » manquant`);
    return undefined;
  }
  if (typeof v !== 'string' || (requis && !v.trim())) throw new Refus(`« ${nom} » doit être un texte`);
  if (v.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return v;
}

const lireBrut = <T>(brut: string): T => JSON.parse(brut) as T;

async function releveDuJour(kv: KV, jour: string): Promise<ReleveMafe> {
  const brut = (await kv.hgetall(CLES_MAFE.releves))[jour];
  if (!brut) throw new Refus('pas de relevé aujourd\'hui : appelle « releve » d\'abord', 409);
  try { return lireBrut<ReleveMafe>(brut); } catch { throw new Refus('le relevé du jour est abîmé : appelle « releve » d\'abord', 409); }
}
const ecrireReleve = (kv: KV, r: ReleveMafe) => kv.hset(CLES_MAFE.releves, r.jour, JSON.stringify(r));

async function releve(kv: KV, deps: DepsMafe, now: number, tache: string, apres?: StatutMafe) {
  await etat(kv, tache, 'au travail', 'GH');
  try {
    const r = await calculerReleve(kv, deps, now);
    // Rafraîchissement du Mac : l'état « au travail » ne doit pas rester allumé (rien de faux dans le calendrier).
    if (apres) await etat(kv, tache, apres);
    return r;
  } catch (e) {
    await etatSurEchec(kv, `${tache} interrompu`);
    throw e;
  }
}

const TECHNIQUE = /→|`|https?:\/\/|www\.|\b[\w-]+\.(?:com|io|app|dev|net|org|ci)\b|\b\w+\/\w+/i;

async function point(kv: KV, corps: Record<string, unknown>, now: number) {
  const phrase = texteBorne(corps.phrase, 'phrase', MAX_PHRASE)!;
  // La page reste simple : chemins, adresses, commandes et code vont dans Telegram (demande du patron, 10 nov.).
  if (TECHNIQUE.test(phrase)) throw new Refus('phrase de la page : pas de détail technique (chemin, adresse, commande, code) ; garde-le pour Telegram', 422);
  const r = await releveDuJour(kv, jourDe(now));
  await ecrireReleve(kv, { ...r, phrase });
  await etat(kv, 'point du matin', 'termine');
  return { ok: true };
}

/**
 * Range le bilan dans le relevé s'il manque, puis le dépose chez L s'il n'y est pas.
 * `deposer` pose son marqueur « déjà vu » avant d'écrire : après un échec en route, on le lève pour que le dépôt reparte.
 */
async function rattraperBilan(kv: KV, r: ReleveMafe, bilan: string, jour: string, now: number) {
  if (!r.bilan) await ecrireReleve(kv, { ...r, bilan });
  const id = 'mafe-' + jour;
  if ((await kv.hgetall(CLE_BOITE))[id]) return;
  await kv.del(`l:recu:${id}`);
  await deposer(kv, { id, type: 'note', contenu: 'Bilan de la semaine (Mafe) : ' + bilan }, now);
}

async function envoyer(kv: KV, corps: Record<string, unknown>, deps: DepsMafeApi, now: number) {
  const jour = jourDe(now);
  const dow = new Date(now).getUTCDay();
  if (dow !== MARDI && dow !== VENDREDI) throw new Refus('Telegram : seulement le mardi et le vendredi', 409);
  const telegram = texteBorne(corps.telegram, 'telegram', MAX_TELEGRAM)!;
  if (!telegram.startsWith('Commence par')) throw new Refus('« telegram » doit commencer par « Commence par »');
  const bilan = dow === VENDREDI ? texteBorne(corps.bilan, 'bilan', MAX_BILAN, false) : undefined;
  if (dow === VENDREDI && !bilan) throw new Refus('« bilan » requis le vendredi', 422);
  const r = await releveDuJour(kv, jour);

  if ((await kv.hgetall(CLES_MAFE.messages))[jour]) {
    // Déjà parti : jamais renvoyé. Mais si le bilan du vendredi n'a pas fini d'arriver (relevé ou boîte de L), on le rattrape.
    if (bilan) await rattraperBilan(kv, r, bilan, jour, now);
    return { envoye: false, raison: 'déjà envoyé aujourd\'hui' };
  }
  // Verrou court : deux rejeux simultanés ne peuvent pas envoyer deux fois.
  const verrou = `mafe:envoi:${jour}`;
  if (!(await kv.setnx(verrou, '1', 120))) return { envoye: false, raison: 'un envoi est déjà en cours' };
  try {
    await deps.envoyer(telegram);
  } catch (e) {
    await kv.del(verrou);
    throw new Refus(`Telegram n'a pas reçu le message (${e instanceof Error ? e.message : 'erreur'}) : rien n'est consommé`, 502);
  }
  // Rien n'est consommé avant l'envoi réussi.
  await kv.hset(CLES_MAFE.messages, jour, JSON.stringify({ jour, texte: telegram, envoye: now }));
  if (bilan) await rattraperBilan(kv, r, bilan, jour, now);
  await etat(kv, 'envoie le point sur Telegram', 'termine', 'Tg');
  return { envoye: true };
}

async function lireNote(kv: KV, id: string): Promise<NoteSeance | null> {
  const brut = (await kv.hgetall(CLES_MAFE.notes))[id];
  return brut ? lireBrut<NoteSeance>(brut) : null;
}
const ecrireNote = (kv: KV, n: NoteSeance) => kv.hset(CLES_MAFE.notes, n.id, JSON.stringify(n));

async function note(kv: KV, corps: Record<string, unknown>, now: number) {
  const id = texteBorne(corps.id, 'id', 200)!;
  const markdown = texteBorne(corps.markdown, 'markdown', MAX_NOTE)!;
  // Une note déjà rangée n'est jamais réécrite : on rend l'existante (adresse Notion comprise).
  const existante = await lireNote(kv, id);
  if (existante) return existante;
  const r = await releveDuJour(kv, jourDe(now));
  const voulue = r.aEcrire.find(a => a.id === id);
  if (!voulue) throw new Refus('cette note n\'est pas à écrire aujourd\'hui (identifiant absent du relevé)', 422);
  const n: NoteSeance = { id, depot: voulue.depot, nom: voulue.nom, jour: voulue.jour, jours: voulue.jours ?? [voulue.jour], markdown, auteur: 'mafe', obsidian: false, quand: now };
  await ecrireNote(kv, n);
  return n;
}

const HOTES_NOTION = ['notion.so', 'notion.site', 'app.notion.com'];
function adresseNotion(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (HOTES_NOTION.includes(u.hostname) || u.hostname.endsWith('.notion.so') || u.hostname.endsWith('.notion.site'));
  } catch { return false; }
}

async function notion(kv: KV, corps: Record<string, unknown>) {
  const id = texteBorne(corps.id, 'id', 200)!;
  const url = texteBorne(corps.url, 'url', 500)!;
  if (!adresseNotion(url)) throw new Refus('« url » doit être une adresse Notion en https:// (notion.so, notion.site ou app.notion.com)', 422);
  const n = await lireNote(kv, id);
  if (!n) throw new Refus('note inconnue', 404);
  if (n.notion) return n; // la première adresse gagne : pas de doublon
  const avec = { ...n, notion: url };
  await ecrireNote(kv, avec);
  return avec;
}

async function aCopier(kv: KV): Promise<NoteSeance[]> {
  const toutes = Object.values(await kv.hgetall(CLES_MAFE.notes)).map(v => lireBrut<NoteSeance>(v));
  return toutes.filter(n => !n.obsidian).sort((a, b) => a.quand - b.quand);
}

async function copie(kv: KV, corps: Record<string, unknown>) {
  const ids = corps.ids;
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(i => typeof i !== 'string')) throw new Refus('« ids » : une liste de textes (100 au plus)');
  let copiees = 0;
  for (const id of ids as string[]) {
    const n = await lireNote(kv, id);
    if (!n) continue;
    if (!n.obsidian) { await ecrireNote(kv, { ...n, obsidian: true }); copiees++; }
  }
  // Le Mac vient de ranger ces notes dans Obsidian : l'icône Obsidian s'allume.
  if (copiees) await ecrireEtat(kv, { agent: 'mafe', statut: 'termine', tache: `range ${copiees} note${copiees > 1 ? 's' : ''} dans Obsidian`, outil: 'Ob' });
  return { copiees };
}

export async function traiterActionMafe(
  kv: KV, action: string, corps: Record<string, unknown>, deps: DepsMafeApi, now: number = Date.now(),
): Promise<unknown> {
  switch (action) {
    case 'releve': return releve(kv, deps, now, 'relevé des projets');
    case 'rafraichir': return releve(kv, deps, now, 'relevé rafraîchi depuis le Mac', 'termine');
    case 'point': return point(kv, corps, now);
    case 'envoyer':
      try {
        return await envoyer(kv, corps, deps, now);
      } catch (e) {
        if (e instanceof Refus && e.code === 502) await etatSurEchec(kv, 'point Telegram non envoyé');
        throw e;
      }
    case 'note': return note(kv, corps, now);
    case 'notion': return notion(kv, corps);
    case 'a-copier': return aCopier(kv);
    case 'copie': return copie(kv, corps);
    default: throw new Refus('action inconnue', 404);
  }
}
