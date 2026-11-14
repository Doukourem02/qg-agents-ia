import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { echangerCode, lireProfil } from '@/server/linkedin/api';
import { traiterRetour, URL_CONNEXION } from '@/server/linkedin/connexion';
import { envoyerTelegram } from '@/server/telegram';

const page = (corps: string, status: number) =>
  new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn</title><body style="font-family:system-ui;padding:2rem"><p>${corps}</p></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

const jjmmaaaa = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

// LinkedIn me renvoie ici avec un code (ou une erreur) ; le jeton n'apparaît jamais dans la page.
export async function GET(req: Request) {
  await connection();
  const clientId = process.env.LINKEDIN_CLIENT_ID, secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !secret) return page('La connexion n\'a pas abouti : LinkedIn n\'est pas configuré côté QG.', 503);
  const p = new URL(req.url).searchParams;
  const r = await traiterRetour(getKV().kv, { code: p.get('code'), state: p.get('state'), error: p.get('error') }, { clientId, secret, echanger: echangerCode, profil: lireProfil });
  if (!r.ok) return page(`La connexion n'a pas abouti : ${r.raison}. Recommence depuis ${URL_CONNEXION}.`, 400);
  try { await envoyerTelegram(`LinkedIn connecté (${r.connexion.nom}), valable jusqu'au ${jjmmaaaa(r.connexion.expire)}.`); }
  catch { /* l'avis Telegram est un plus : la connexion est déjà enregistrée */ }
  return page('LinkedIn est connecté au QG. Tu peux fermer cette page.', 200);
}
