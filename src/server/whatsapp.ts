import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Refus } from './qg';

// Le bot WhatsApp (API Cloud de Meta). Il n'envoie que deux choses : mes demandes d'accord et les alertes urgentes.
// Réglages (dans Vercel, jamais dans le code) :
//   WHATSAPP_TOKEN        jeton d'accès (utilisateur système Meta)
//   WHATSAPP_PHONE_ID     identifiant du numéro qui envoie (le numéro de test au début)
//   WHATSAPP_APP_SECRET   secret de l'app Meta, pour vérifier que les messages reçus viennent bien de Meta
//   WHATSAPP_VERIFY_TOKEN mot choisi pour l'abonnement du webhook
//   WHATSAPP_MON_NUMERO   mon numéro, chiffres seulement (le seul que le bot écoute et à qui il écrit)

const GRAPH = 'https://graph.facebook.com/v25.0';
export const chiffres = (n: string) => n.replace(/\D/g, '');

/**
 * Mes identités WhatsApp possibles. En Côte d'Ivoire, WhatsApp désigne encore souvent un numéro à 10 chiffres
 * (225 07 78 …) par son ancienne forme à 8 chiffres (225 78 …) : on accepte les deux.
 */
export function mesNumeros(brut: string): Set<string> {
  const out = new Set<string>();
  for (const n of brut.split(',').map(chiffres).filter(Boolean)) {
    out.add(n);
    const ci = n.match(/^225(0[1579])(\d{8})$/);
    if (ci) out.add(`225${ci[2]}`);
  }
  return out;
}

function reglage(nom: string) {
  const v = process.env[nom];
  if (!v) throw new Refus(`WhatsApp non configuré (${nom} manquant)`, 503);
  return v;
}

/** Envoie un message texte à mon numéro. Hors de la fenêtre de 24 h, Meta exige un modèle approuvé. */
export async function envoyerTexte(texte: string) {
  const r = await fetch(`${GRAPH}/${reglage('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${reglage('WHATSAPP_TOKEN')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: chiffres(reglage('WHATSAPP_MON_NUMERO').split(',')[0]), type: 'text', text: { body: texte.slice(0, 4000) } }),
  });
  const corps = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = corps?.error?.code;
    // 131047 : plus de 24 h depuis mon dernier message → il faudra un modèle approuvé
    throw new Refus(code === 131047 ? 'fenêtre de 24 h fermée : écris un message au bot pour la rouvrir' : `envoi WhatsApp refusé (${code ?? r.status})`, 502);
  }
  return corps?.messages?.[0]?.id as string | undefined;
}

/** Vérifie la signature X-Hub-Signature-256 que Meta joint à chaque message reçu. */
export function signatureValide(corpsBrut: string, entete: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !entete?.startsWith('sha256=')) return false;
  const attendu = Buffer.from(createHmac('sha256', secret).update(corpsBrut).digest('hex'));
  const recu = Buffer.from(entete.slice(7));
  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

export type MessageRecu = { id: string; de: string; texte: string };

/** Extrait les messages texte d'une notification Meta (on ignore accusés de lecture, statuts, images…). */
export function messagesRecus(notif: unknown): MessageRecu[] {
  const out: MessageRecu[] = [];
  const n = notif as { entry?: { changes?: { value?: { messages?: { id: string; from: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[] } }[] }[] };
  for (const e of n?.entry ?? []) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) {
    const texte = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title;
    if (texte) out.push({ id: m.id, de: chiffres(m.from), texte });
  }
  return out;
}
