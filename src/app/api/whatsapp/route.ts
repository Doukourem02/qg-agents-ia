import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { CLES_ACCORDS, repondreAccord, texteConfirmation } from '@/server/accords';
import { envoyerTexte, messagesRecus, mesNumeros, signatureValide } from '@/server/whatsapp';

// Le webhook WhatsApp : Meta y vérifie l'abonnement (GET) puis y livre mes réponses (POST).

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const attendu = process.env.WHATSAPP_VERIFY_TOKEN;
  if (attendu && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === attendu) {
    return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('interdit', { status: 403 });
}

export async function POST(req: Request) {
  const brut = await req.text();
  if (!signatureValide(brut, req.headers.get('x-hub-signature-256'))) return new Response('signature invalide', { status: 401 });
  let notif: unknown;
  try { notif = JSON.parse(brut); } catch { return new Response('ok'); }
  const moi = mesNumeros(process.env.WHATSAPP_MON_NUMERO ?? '');
  const { kv } = getKV();
  for (const m of messagesRecus(notif)) {
    if (!moi.has(m.de)) continue; // le bot n'écoute que mon numéro
    if (!(await kv.setnx(CLES_ACCORDS.message(m.id), '1', 7 * 24 * 3600))) continue; // Meta peut livrer deux fois
    const r = await repondreAccord(kv, m.texte);
    try {
      if (!r.compris) await envoyerTexte('QG · je n’ai pas compris. Réponds OK, non, ou « modifie : … » (ajoute #code pour viser une demande précise).');
      else if (!r.accord) await envoyerTexte('QG · aucune demande d’accord en attente.');
      else if ('deja' in r && r.deja) await envoyerTexte(`QG · #${r.accord.id} est déjà traité (${r.accord.statut}).`);
      else await envoyerTexte(texteConfirmation(r.accord));
    } catch (e) { console.error(e); }
  }
  // Meta attend toujours un 200 rapide, sinon il renvoie la notification
  return new Response('ok');
}
