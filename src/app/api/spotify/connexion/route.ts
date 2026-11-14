import { pageSeulement } from '@/server/auth';
import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { nouvelEtat, urlAutorisation } from '@/server/spotify/connexion';

// Je l'ouvre dans le navigateur : le QG m'envoie chez Spotify pour autoriser la lecture de ce que j'écoute.
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return new Response('Spotify : SPOTIFY_CLIENT_ID manque', { status: 503 });
  const { kv } = getKV();
  return Response.redirect(urlAutorisation(clientId, await nouvelEtat(kv)), 302);
}
