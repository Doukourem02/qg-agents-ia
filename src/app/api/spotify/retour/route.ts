import { pageSeulement } from '@/server/auth';
import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { traiterRetour, URL_CONNEXION } from '@/server/spotify/connexion';

const page = (corps: string, status: number) =>
  new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify</title><body style="font-family:system-ui;padding:2rem"><p>${corps}</p></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

// Spotify me renvoie ici avec un code (ou une erreur) ; les jetons n'apparaissent jamais dans la page.
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  const clientId = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !secret) return page('La connexion n\'a pas abouti : Spotify n\'est pas configuré côté QG.', 503);
  const p = new URL(req.url).searchParams;
  const r = await traiterRetour(getKV().kv, { code: p.get('code'), state: p.get('state'), error: p.get('error') }, { clientId, secret });
  if (!r.ok) return page(`La connexion n'a pas abouti : ${r.raison}. Recommence depuis ${URL_CONNEXION}.`, 400);
  return page('Spotify est connecté au QG. Tu peux fermer cette page.', 200);
}
