import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { urlAutorisation } from '@/server/linkedin/api';
import { nouvelEtat } from '@/server/linkedin/connexion';

// Je l'ouvre dans le navigateur : le QG m'envoie chez LinkedIn pour autoriser la publication.
export async function GET() {
  await connection();
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return new Response('LinkedIn : LINKEDIN_CLIENT_ID manque', { status: 503 });
  const { kv } = getKV();
  return Response.redirect(urlAutorisation(clientId, await nouvelEtat(kv)), 302);
}
