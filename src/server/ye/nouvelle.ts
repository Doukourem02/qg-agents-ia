// Ye : « Ajouter » / « Pas maintenant » / « Jamais » pour un projet absent du portfolio (Telegram ou la page).
// Ajouter = l'unique création de Ye : les images choisies sont lues dans le dépôt (au commit lu par Ye) et envoyées à
// Sanity, puis la fiche est créée avec `create` (jamais createOrReplace : rien n'est écrasé), à la fin de la liste.
// Sans image, la fiche est créée en brouillon (invisible sur le site) : Le patron ajoute une image dans le Studio et publie.
// Le dépôt de la fiche est noté dans le QG (`ye:depots`), jamais dans Sanity (le dataset est public). Une compétence
// n'est jamais créée ici.
import type { KV } from '../memoire';
import { ecrireEtat } from '../qg';
import { encoderChemin } from '../light/sources';
import { creerDocument, dernierOrdre, STUDIO, televerserImage, titreExistant } from './sanity';
import { ecrireNouvelle, expiree, lireNouvelle, noterDepotFiche, noterReponseAbsent, sousVerrou } from './stockage';
import { idCourt } from './rapport';
import type { NouvelleYe } from './types';

export type ChoixNouvelle = 'ajouter' | 'plus-tard' | 'jamais';
export type DepsCreation = {
  fetch: typeof fetch;
  /** SANITY_ECRITURE_PORTFOLIO. */
  jeton: string | undefined;
  /** GITHUB_LECTURE_PERSO : lire les images du dépôt (privé ou non). */
  github: string | undefined;
};

const MAX_OCTETS = 10 * 1024 * 1024;
const DELAI_GITHUB_MS = 30_000;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const nom = (n: NouvelleYe) => `« ${n.champs.title} »`;
const DEJA: Record<Exclude<NouvelleYe['statut'], 'attente'>, (n: NouvelleYe) => string> = {
  ajoutee: n => `Déjà noté : ${nom(n)} est déjà dans ton portfolio.`,
  brouillon: n => `Déjà noté : ${nom(n)} est déjà créée en brouillon dans le Studio (${STUDIO}).`,
  'plus-tard': n => `Déjà noté : je te reparlerai de ${nom(n)} dans 4 semaines.`,
  jamais: n => `Déjà noté : je ne te proposerai plus ${nom(n)}.`,
  expiree: n => `Déjà noté : la proposition pour ${nom(n)} a expiré, Ye la reproposera vendredi.`,
  remplacee: n => `Déjà noté : cette proposition pour ${nom(n)} a été remplacée.`,
};

/** Une image du dépôt au commit lu par Ye ; null si absente, trop lourde ou illisible. */
async function lireImage(f: typeof fetch, jeton: string, depot: string, chemin: string, ref: string): Promise<{ octets: ArrayBuffer; type: string } | null> {
  const type = TYPES[chemin.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return null;
  try {
    const r = await f(`https://api.github.com/repos/${depot}/contents/${encoderChemin(chemin)}?ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(DELAI_GITHUB_MS),
    });
    if (!r.ok) return null;
    if (Number(r.headers.get('content-length') ?? 0) > MAX_OCTETS) return null;
    const octets = await r.arrayBuffer();
    return octets.byteLength > 0 && octets.byteLength <= MAX_OCTETS ? { octets, type } : null;
  } catch {
    return null;
  }
}

const image = (asset: string, cle?: string) => ({ _type: 'image', ...(cle ? { _key: cle } : {}), asset: { _type: 'reference', _ref: asset } });

/** Le clic. Rend la réponse en une ligne. Un clic à la fois ; seule une création réussie marque « ajoutée » ou « brouillon ». */
export async function deciderNouvelle(kv: KV, id: string, choix: ChoixNouvelle, deps: DepsCreation, now: number = Date.now()): Promise<string> {
  const vu = await lireNouvelle(kv, id);
  if (!vu) return 'Cette proposition de Ye est inconnue.';
  if (vu.statut !== 'attente') return DEJA[vu.statut](vu);
  const r = await sousVerrou(kv, id, async () => {
    const n = await lireNouvelle(kv, id);
    if (!n) return 'Cette proposition de Ye est inconnue.';
    if (n.statut !== 'attente') return DEJA[n.statut](n);
    if (expiree(n, now)) {
      await ecrireNouvelle(kv, { ...n, statut: 'expiree' });
      return `Cette proposition pour ${nom(n)} a plus de 8 jours : rien n'est créé, Ye la reproposera vendredi.`;
    }
    if (choix !== 'ajouter') {
      await noterReponseAbsent(kv, n.depot, { statut: choix, quand: now });
      await ecrireNouvelle(kv, { ...n, statut: choix, decide: now });
      await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: `laisse ${nom(n)} hors du portfolio`.slice(0, 140) }, now);
      return choix === 'jamais' ? `Noté : je ne te proposerai plus ${nom(n)}.` : `Noté : je te reparlerai de ${nom(n)} dans 4 semaines.`;
    }
    return ajouter(kv, n, deps, now);
  });
  return r ?? `Ye s'occupe déjà de ${nom(vu)} : patiente un instant.`;
}

async function ajouter(kv: KV, n: NouvelleYe, deps: DepsCreation, now: number): Promise<string> {
  const jeton = deps.jeton;
  if (!jeton) return 'La clé d\'écriture Sanity manque sur le serveur : rien n\'est créé.';

  // L'identifiant : celui prévu, ou « -2 », « -3 » s'il est pris par une autre fiche. Un document qui porte déjà notre
  // titre à l'identifiant d'un essai précédent (réponse perdue) : c'est notre création, rien n'est recréé.
  let docId: string | null = null;
  for (const essai of [n.docId, `${n.docId}-2`, `${n.docId}-3`]) {
    const titre = await titreExistant(deps.fetch, jeton, essai);
    if (titre === null) return 'Sanity ne répond pas : rien n\'est créé, réessaie dans un moment.';
    if (titre === undefined) { docId = essai; break; }
    if (titre === n.champs.title && n.tentee?.docId === essai) {
      await noterDepotFiche(kv, essai, n.depot);
      await ecrireNouvelle(kv, { ...n, statut: n.tentee.brouillon ? 'brouillon' : 'ajoutee', decide: now });
      return n.tentee.brouillon ? `${nom(n)} est déjà créée en brouillon : ajoute une image dans le Studio (${STUDIO}), puis Publier.` : `${nom(n)} est déjà dans ton portfolio.`;
    }
  }
  if (!docId) return `Trois fiches portent déjà ce nom dans Sanity : rien n'est créé, regarde le Studio (${STUDIO}).`;

  const assets: string[] = [];
  let ratees = 0;
  for (const chemin of n.images) {
    const img = deps.github ? await lireImage(deps.fetch, deps.github, n.depot, chemin, n.tete) : null;
    const asset = img ? await televerserImage(deps.fetch, jeton, chemin.split('/').pop() ?? 'capture.png', img.octets, img.type) : null;
    if (asset) assets.push(asset); else ratees++;
  }
  const brouillon = assets.length === 0;
  const c = n.champs;
  const ordre = ((await dernierOrdre(deps.fetch, jeton)) ?? 99) + 1;
  const doc: Record<string, unknown> = {
    _id: brouillon ? `drafts.${docId}` : docId, _type: 'project',
    title: c.title, kind: c.kind, kindEn: c.kindEn, status: c.status, description: c.description, descriptionEn: c.descriptionEn,
    ...(c.liveUrl ? { liveUrl: c.liveUrl } : {}),
    technologies: c.technologies.map(t => ({ _type: 'reference', _ref: t.id, _key: idCourt(n.id, t.id) })),
    ...(assets.length ? { mainImage: image(assets[0]) } : {}),
    ...(assets.length > 1 ? { gallery: assets.slice(1).map(a => image(a, idCourt(n.id, a))) } : {}),
    order: ordre,
  };
  // noté avant l'envoi : si la réponse se perd, le prochain clic reconnaît la fiche créée
  await ecrireNouvelle(kv, { ...n, tentee: { docId, brouillon } });
  const e = await creerDocument(deps.fetch, jeton, doc);
  if (e.etat === 'erreur') return 'Sanity a refusé la création : rien n\'est créé, réessaie dans un moment.';
  if (e.etat === 'inconnu') return `Résultat inconnu pour ${nom(n)} : Sanity n'a pas répondu à temps, retouche « Ajouter » (rien ne sera créé deux fois).`;
  if (e.etat === 'conflit') return `Une fiche vient d'être créée avec le même identifiant : rien n'est écrasé, retouche « Ajouter ».`;
  await noterDepotFiche(kv, docId, n.depot);
  await ecrireNouvelle(kv, { ...n, tentee: { docId, brouillon }, statut: brouillon ? 'brouillon' : 'ajoutee', decide: now });
  await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: `a ajouté ${nom(n)} au portfolio${brouillon ? ' (brouillon)' : ''}`.slice(0, 140), outil: 'Sa' }, now);
  const manque = ratees ? ` (${ratees} image${ratees > 1 ? 's' : ''} n'${ratees > 1 ? 'ont' : 'a'} pas pu être lue${ratees > 1 ? 's' : ''} dans le dépôt)` : '';
  return brouillon
    ? `${nom(n)} est créée en brouillon, invisible sur le site${manque} : ajoute une image dans le Studio (${STUDIO}), puis Publier.`
    : `C'est fait : ${nom(n)} est sur ton portfolio, à la fin de la liste, avec ${assets.length} image${assets.length > 1 ? 's' : ''}${manque}. Tu peux changer l'ordre ou les images dans le Studio.`;
}
