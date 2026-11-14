import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { envoyerTelegram } from '@/server/telegram';
import { deposerStats, estTableur, lireTableur } from '@/server/l/stats';

// Le dépôt d'un export de statistiques depuis la page (multipart, champ « fichier »).
// 4 Mo : Vercel refuse les corps de requête au-delà d'environ 4,5 Mo
const MAX_OCTETS = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    let form: FormData;
    try { form = await req.formData(); } catch { throw new Refus('formulaire attendu (champ « fichier »)'); }
    const fichier = form.get('fichier');
    if (!(fichier instanceof File)) throw new Refus('champ « fichier » manquant');
    if (fichier.size > MAX_OCTETS) throw new Refus('fichier trop lourd (4 Mo au plus)', 413);
    if (!estTableur(fichier.name)) throw new Refus('ce fichier n\'est pas un tableur (.xlsx ou .csv)', 422);
    const feuilles = await lireTableur(fichier.name, new Uint8Array(await fichier.arrayBuffer()));
    const depot = await deposerStats(getKV().kv, fichier.name, feuilles);
    try {
      await envoyerTelegram(`Statistiques reçues depuis la page (${feuilles.length} feuilles). L prépare le bilan dans l'heure.`);
    } catch { /* le dépôt est rangé : une alerte ratée ne le bloque pas */ }
    return Response.json({ depot: { id: depot.id, nom: depot.nom, feuilles: feuilles.length } }, { status: 201 });
  } catch (e) {
    return reponseErreur(e);
  }
}
