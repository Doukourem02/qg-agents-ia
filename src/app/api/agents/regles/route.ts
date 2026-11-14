import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { textesRegles } from '@/server/regles';

// Les règles du patron, lues par L, Light, Clara et Mafe au début de chaque passage (scripts/regles.mjs). Lecture seule.
export async function GET(req: Request) {
  await connection();
  try {
    verifierAgent(req);
    return Response.json({ regles: await textesRegles(getKV().kv) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
