import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, pageSeulement } from '@/server/auth';
import { lireEcoute, type VueEcoute } from '@/server/spotify/ecoute';

// Ce que j'écoute sur mon Spotify, pour la page (menu « En écoute »). Derrière la protection Vercel, comme /api/l.
// Seule la vue sort d'ici : jamais de jeton.
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  const clientId = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  const entetes = { 'cache-control': 'no-store' };
  if (!clientId || !secret) return Response.json({ connecte: false, enCours: null } satisfies VueEcoute, { headers: entetes });
  try {
    return Response.json(await lireEcoute(getKV().kv, { clientId, secret }), { headers: entetes });
  } catch (e) {
    return reponseErreur(e);
  }
}
