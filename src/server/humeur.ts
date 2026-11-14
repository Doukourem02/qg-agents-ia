// L'humeur du patron dans son dernier message, repérée par des règles simples (sans IA, testées à part) et donnée
// à Kuroro (`humeur_de_patron`) : agacé, pressé, fatigué, content ou neutre, et s'il parle familier (« frère »).
// Le registre familier détend un peu Kuroro, jamais au point de l'appeler « frère » : Le patron est son patron.
// Rien n'est gardé ni journalisé : seulement le mot de l'humeur, et les mots qui l'ont trahie, pour le prompt.

export type Humeur = 'agacé' | 'pressé' | 'fatigué' | 'content' | 'neutre';
export type Lecture = { humeur: Humeur; familier: boolean; indices: string[] };

const norme = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, ' ').replace(/\s+/g, ' ').trim();

/** Les tournures d'un reproche ou d'un agacement (texte sans accents, en minuscules). */
const AGACE: [RegExp, string][] = [
  [/\b(je ne|je|j) (tolererai|accepterai|supporterai)\b/, 'je ne tolérerai plus'],
  [/\bfai(s|tes?) gaffe\b|\bfais attention\b|\bfaites attention\b/, 'fais gaffe'],
  [/\bla prochaine fois\b/, 'la prochaine fois'],
  [/\b(c est|ce n est|c etait) (pas|plus) (normal|possible|serieux|acceptable)\b|\bpas normal\b/, 'c’est pas normal'],
  [/\bon est (deja )?(a )?\d{1,2} ?(h|heures?)\s?\d{0,2}\b/, 'il te rappelle l’heure'],
  [/\btoujours pas\b|\bencore (en )?retard\b|\bdes retards\b|\bles retards\b/, 'toujours pas, des retards'],
  [/\bm (enerv|agac|saoul|soul)\w*|\b(ca|cela) (m )?(enerv|agac|saoul)\w*|\bj en ai marre\b|\bmarre\b|\bras le bol\b|\bgonfle\b/, 'ça m’énerve'],
  [/\bn importe quoi\b|\binadmissible\b|\binacceptable\b|\bc est quoi ce\b|\bse fout\b|\bfoutez\b/, 'n’importe quoi'],
  [/\bputain\b|\bmerde\b|\bbordel\b|\bpff+\b|\bwtf\b/, 'un juron'],
  [/\bpas content\b|\bdecu\b|\bdecoit\b/, 'pas content'],
  [/\bserieux ?\?|\bserieusement\b|\btu te moques\b|\btu rigoles\b/, 'sérieux ?'],
  [/\bpersonne ne\b.*\b(dit|previent|previenu|prevenu|envoye)\b|\bpersonne m a\b/, 'personne ne m’a rien dit'],
  [/\bimbeciles?\b|\bidiots?\b|\bcons?\b|\bconnards?\b|\bdebiles?\b|\bcretins?\b|\babrutis?\b|\bstupides?\b|\bnuls?\b|\bincapables?\b/, 'une insulte'],
  [/\b(je suis )?pas ton (frere|pote|ami|reuf)\b/, 'pas ton frère'],
];
const PRESSE: RegExp = /\bvite\b|\brapide(ment)?\b|\burgent\b|\basap\b|\bdepeche\b|\bpas le temps\b|\ben (deux|2) mots\b|\bvite fait\b|\bfais court\b/;
const FATIGUE: RegExp = /\bfatigue\b|\bcreve\b|\bepuise\b|\bclaque\b|\bnaze\b|\bk\.?o\b|\bdure journee\b|\bjournee de fou\b|\bpas dormi\b|\bla flemme\b|\bje suis mort\b|\bcrame\b/;
const CONTENT: RegExp = /\bmerci+\b|\btop\b|\bgenial\b|\bsuper\b|\bparfait\b|\bbravo\b|\bbien joue\b|\bexcellent\b|\btrop bien\b|\bnickel\b|\bcool\b|\bcontent\b|\bgg\b|\bchapeau\b|\bmagnifique\b|\bje kiffe\b/;
const CONTENT_NIE: RegExp = /\bpas (top|cool|super|genial|parfait|content|terrible)\b|\bmerci de\b/;
/** Les mots familiers (Abidjan, entre potes) : Kuroro se détend. */
const FAMILIER: RegExp = /\bfreres?\b|\bfrerot\b|\bfrero\b|\bgars\b|\bmon pote\b|\bmon reuf\b|\bbro\b|\bwesh\b|\bmon vieux\b|\bon dit quoi\b|\bc est comment\b|\by a quoi\b|\bmon boss\b|\bdjo\b/;

/** Les lettres en majuscules : un message crié (au moins 8 lettres, plus des deux tiers en majuscules). */
function crie(texte: string) {
  const lettres = texte.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (lettres.length < 8) return false;
  return lettres.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length / lettres.length > 2 / 3;
}

/** L'humeur d'un message du patron. L'agacement l'emporte sur tout (« merci, mais c'est pas normal ») ; puis pressé, fatigué, content. */
export function humeurDe(texte: string): Lecture {
  const t = norme(texte);
  const familier = FAMILIER.test(t);
  const indices = AGACE.filter(([r]) => r.test(t)).map(([, i]) => i);
  const content = CONTENT.test(t) && !CONTENT_NIE.test(t);
  // les majuscules et les « !!! » seuls, sur un merci, c'est de la joie (« MERCI FRÈRE !!! »)
  const ton = [...(crie(texte) ? ['il écrit en majuscules'] : []), ...(/!{3,}|\?!|!\?/.test(texte) ? ['« !!! »'] : [])];
  if (indices.length || (ton.length && !content)) return { humeur: 'agacé', familier, indices: [...indices, ...ton] };
  if (PRESSE.test(t)) return { humeur: 'pressé', familier, indices: [] };
  if (FATIGUE.test(t)) return { humeur: 'fatigué', familier, indices: [] };
  if (content) return { humeur: 'content', familier, indices: [] };
  return { humeur: 'neutre', familier, indices: [] };
}

/** Ce que Kuroro fait de chaque humeur (dit juste après elle, à la fin du prompt : un petit modèle suit mieux ce qu'il lit en dernier). */
export const CONSIGNES: Record<Humeur, string> = {
  agacé: 'Excuse-toi en une phrase, franchement, de ce qui a cloché dans l’échange, sans te justifier ni rejeter la faute. S’il reproche quelque chose à un agent, dis seulement ce qui s’est vraiment passé (les faits) ; sinon, aucun fait. Puis demande-lui ce que tu peux faire pour lui. Un reproche n’est pas une mission.',
  pressé: 'Une seule phrase, l’essentiel.',
  fatigué: 'Doux et bref : rassure-le avec les faits, ne lui donne pas de travail.',
  content: 'Partage sa joie, simplement, avec les faits.',
  neutre: 'Naturel.',
};

/**
 * La fin du prompt (elle change à chaque message ; tout ce qui la précède reste lu) : l'humeur du dernier message et
 * sa consigne, et « familier » si l'un des derniers messages l'est (le registre dure plus qu'un message).
 */
export function ligneHumeur(messages: string[]): string {
  const dernier = messages.at(-1) ?? '';
  const l = humeurDe(dernier);
  const familier = l.familier || messages.slice(-3).some(m => humeurDe(m).familier);
  const pourquoi = l.indices.length ? ` (${l.indices.slice(0, 3).join(', ')})` : '';
  return `humeur_de_patron (son dernier message) : ${l.humeur}${pourquoi}. ${CONSIGNES[l.humeur]}${familier ? ' Il te parle familier : tu peux être un peu plus détendu, mais reste respectueux, et ne l’appelle jamais « frère » : il est ton patron.' : ''}`;
}
