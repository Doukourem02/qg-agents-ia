import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { Refus } from './qg';

// Le bot Telegram (plan B de WhatsApp, Meta exigeant une vérification d'entreprise).
// Il n'envoie que mes demandes d'accord, les alertes urgentes et le compte rendu du matin de Kuroro, et n'écoute que moi.
// Réglages (dans Vercel, jamais dans le code) :
//   TELEGRAM_TOKEN    le jeton du bot (donné par @BotFather)
//   TELEGRAM_CHAT_ID  mon identifiant Telegram (le seul que le bot écoute et à qui il écrit)
//   TELEGRAM_SECRET   le mot que Telegram joint à chaque appel du webhook

const API = 'https://api.telegram.org';

function reglage(nom: string) {
  const v = process.env[nom];
  if (!v) throw new Refus(`Telegram non configuré (${nom} manquant)`, 503);
  return v;
}

async function poster(methode: string, init: RequestInit) {
  let r: Response;
  // l'adresse contient le jeton : une erreur réseau n'est jamais transmise telle quelle
  try { r = await fetch(`${API}/bot${reglage('TELEGRAM_TOKEN')}/${methode}`, { method: 'POST', ...init }); }
  catch { throw new Refus('Telegram injoignable', 502); }
  const d = await r.json().catch(() => ({}));
  // 429 : Telegram demande de ralentir ; gardé tel quel pour que l'appelant s'arrête proprement
  if (!r.ok || !d.ok) throw new Refus(`Telegram a refusé (${d.error_code ?? r.status})`, (d.error_code ?? r.status) === 429 ? 429 : 502);
  return d.result;
}

const appel = (methode: string, corps: Record<string, unknown>) =>
  poster(methode, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });

/** Un envoi de fichier (multipart) : le content-type, avec sa frontière, est posé par fetch lui-même. */
function appelFichier(methode: string, champ: string, contenu: Uint8Array, nom: string, type: string, legende?: string) {
  const f = new FormData();
  f.append('chat_id', reglage('TELEGRAM_CHAT_ID'));
  if (legende) f.append('caption', legende.slice(0, 1024));
  f.append(champ, new Blob([contenu as Uint8Array<ArrayBuffer>], { type }), nom);
  return poster(methode, { body: f });
}

const TAILLE_MAX = 5 * 1024 * 1024;

/** Télécharge un fichier reçu (5 Mo au plus). Le jeton n'apparaît dans aucun message d'erreur. */
export async function telechargerFichier(fileId: string): Promise<{ contenu: Uint8Array; nom?: string }> {
  const infos = await appel('getFile', { file_id: fileId }) as { file_path?: string; file_size?: number };
  if ((infos.file_size ?? 0) > TAILLE_MAX) throw new Refus('fichier trop gros (5 Mo au plus)', 413);
  if (!infos.file_path) throw new Refus('Telegram n\'a pas donné le fichier', 502);
  let r: Response;
  try {
    r = await fetch(`${API}/file/bot${reglage('TELEGRAM_TOKEN')}/${infos.file_path}`);
  } catch {
    throw new Refus('téléchargement du fichier impossible', 502); // pas de détail : l'URL contient le jeton
  }
  if (!r.ok) throw new Refus(`Telegram a refusé le téléchargement (${r.status})`, 502);
  const contenu = new Uint8Array(await r.arrayBuffer());
  if (contenu.length > TAILLE_MAX) throw new Refus('fichier trop gros (5 Mo au plus)', 413);
  return { contenu, nom: infos.file_path.split('/').pop() };
}

export type Bouton = { texte: string; donnee: string };

/** Envoie un message à moi seul, avec éventuellement une rangée de boutons (`Bouton[]`) ou plusieurs (`Bouton[][]`). */
export async function envoyerTelegram(texte: string, boutons?: Bouton[] | Bouton[][]) {
  const rangees = !boutons ? [] : Array.isArray(boutons[0]) ? boutons as Bouton[][] : [boutons as Bouton[]];
  return appel('sendMessage', {
    chat_id: reglage('TELEGRAM_CHAT_ID'),
    text: texte.slice(0, 4000),
    ...(boutons ? { reply_markup: { inline_keyboard: rangees.map(r => r.map(b => ({ text: b.texte, callback_data: b.donnee }))) } } : {}),
  });
}

/** Envoie une image PNG à moi seul, avec une légende éventuelle (1 024 caractères au plus). */
export async function envoyerImage(png: Uint8Array, legende?: string) {
  return appelFichier('sendPhoto', 'photo', png, 'visuel.png', 'image/png', legende);
}

/** Envoie un fichier (un PDF de carrousel) à moi seul. */
export async function envoyerFichier(contenu: Uint8Array, nom: string, legende?: string) {
  return appelFichier('sendDocument', 'document', contenu, nom, nom.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', legende);
}

/** Accuse réception d'un clic tout de suite (sinon le bouton tourne jusqu'à la fin du travail). Au mieux. */
export async function accuserClic(callbackId: string, info?: string) {
  await appel('answerCallbackQuery', { callback_query_id: callbackId, ...(info ? { text: info.slice(0, 190) } : {}) }).catch(() => {});
}

/** Retire les boutons d'un message déjà traité. Au mieux. */
export async function retirerBoutons(chatId: number | string, messageId: number) {
  await appel('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
}

/** Vérifie l'en-tête secret que Telegram joint à chaque appel du webhook. */
export function secretValide(entete: string | null) {
  const attendu = process.env.TELEGRAM_SECRET;
  if (!attendu || !entete) return false;
  const a = Buffer.from(entete), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Recu =
  | { type: 'texte'; id: string; de: string; texte: string }
  | { type: 'fichier'; id: string; de: string; fileId: string; nom: string }
  | { type: 'bouton'; id: string; de: string; donnee: string; chat: number; message: number };

/** Ce que contient une mise à jour Telegram : un message texte, ou un clic sur un bouton. */
export function lireMiseAJour(u: unknown): Recu | null {
  const x = u as {
    update_id?: number;
    message?: { message_id: number; from?: { id: number }; text?: string; document?: { file_id: string; file_name?: string } };
    callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
  };
  if (x?.message?.text && x.message.from) {
    return { type: 'texte', id: `m${x.update_id}`, de: String(x.message.from.id), texte: x.message.text };
  }
  if (x?.message?.document && x.message.from) {
    const d = x.message.document;
    return { type: 'fichier', id: `m${x.update_id}`, de: String(x.message.from.id), fileId: d.file_id, nom: d.file_name ?? 'fichier' };
  }
  const c = x?.callback_query;
  if (c?.data && c.message) {
    return { type: 'bouton', id: `c${c.id}`, de: String(c.from.id), donnee: c.data, chat: c.message.chat.id, message: c.message.message_id };
  }
  return null;
}
