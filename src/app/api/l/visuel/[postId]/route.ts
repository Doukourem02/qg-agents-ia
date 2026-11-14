import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, pageSeulement } from '@/server/auth';
import { Refus } from '@/server/qg';
import { lirePost } from '@/server/l/posts';
import { rendreVisuel } from '@/server/l/visuels';

// Le visuel d'un post, rendu en PNG pour la page.
export async function GET(req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  try {
    const { postId } = await params;
    const post = await lirePost(getKV().kv, postId);
    if (!post?.visuel) throw new Refus('post ou visuel inconnu', 404);
    let png: Uint8Array<ArrayBuffer>;
    try {
      png = (await rendreVisuel(post.visuel)).png as Uint8Array<ArrayBuffer>;
    } catch (e) {
      console.error(e);
      throw new Refus('rendu du visuel impossible', 500);
    }
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
