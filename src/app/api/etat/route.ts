import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireEtat } from '@/server/qg';
import { reponseErreur } from '@/server/auth';
import { sceneCrise } from '@/server/crise/vue';

// La page lit ici l'état des agents, le journal et la réunion de crise en cours (la salle de réunion la suit).
// Protégée comme toute la page (Vercel Authentication) ; jamais lue depuis /demo.
export async function GET() {
  await connection(); // toujours lu au moment de la requête, jamais figé à la compilation
  try {
    const { kv, source } = getKV();
    const reunion = await sceneCrise(kv).catch(() => null);
    return Response.json({ source, ...(await lireEtat(kv)), reunion }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
