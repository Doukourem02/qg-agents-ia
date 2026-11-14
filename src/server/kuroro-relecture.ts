import { AGENTS } from '@/sim/routing';
import { QUE_FAIRE, estJourPourSalut, petitMot, repondrePetitMot } from '@/sim/kuroro';
import { ceQuiACloche, estFlou } from '@/sim/kuroro-ia';
import { humeurDe } from './humeur';
import { corrigerHeures, sujetsDe, type Controle } from './kuroro-faits';

// La réponse d'un modèle (le modèle local du Mac, ou Claude) relue par le code avant d'être montrée au patron.
// Un petit modèle recopie des gabarits : ici, ce qu'il ne doit jamais dire est retiré ou remplacé, et ce que le code
// sait mieux que lui (une salutation, une excuse) est écrit par le code. Fonctions pures, testées à part.
// Heure d'Abidjan = UTC.

type Tour = { role: 'moi' | 'kuroro'; texte: string };

const norme = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const phrasesDe = (t: string) => t.match(/[^.!?…]+[.!?…]*/g) ?? [t];
// l'espace avant « ? », « ! » et « : » reste (la typographie française)
const nettoyer = (t: string) => t.replace(/\s+([,.…])/g, '$1').replace(/^[\s,;:]+/, '').replace(/\s+/g, ' ').trim();
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** « frère » et ses cousins (avec la virgule qui les précède) ; « mon frère » compte pour un. */
const FRERE = /(,\s*)?\b(?:mon |petit |grand )?(?:fr[eèé]r(?:e|es|ot|o)|bro|mon pote|mon reuf)(?![a-zà-ÿ])/gi;
/** « je t'ai appelé frère », « « frère » » : Kuroro parle du mot, il ne l'appelle pas ainsi. */
const PARLE_DU_MOT = /(appel\S*|dit|«)\s*$/i;

/** le patron est le patron : un « frère » devient « patron » (une fois), les suivants sont retirés. */
export function sansFrere(texte: string): string {
  let patron = /\bpatron\b/i.test(texte);
  const t = texte.replace(FRERE, (m: string, virgule: string | undefined, i: number, tout: string) => {
    if (PARLE_DU_MOT.test(tout.slice(Math.max(0, i - 14), i + (virgule?.length ?? 0)))) return m;
    if (patron) return '';
    patron = true;
    // en tête de phrase : « Patron, … »
    return `${virgule ?? ''}${/(^|[.!?…]\s*)$/.test(tout.slice(0, i)) ? 'Patron' : 'patron'}`;
  });
  return majuscule(nettoyer(t));
}

/** Ce qui n'est jamais vrai (« j'ai pas vu ton message » : Kuroro les voit tous) ou jamais demandé (un résumé proposé). */
const JAMAIS = [
  /\b(pas|jamais) (vu|lu|recu|eu|capte) (ton|tes|le|ce|son) (dernier )?messages?\b/,
  // « j'ai pas vu les propositions de Paul » : Kuroro voit tout ce que disent les faits
  /\bj ai pas (vu|remarque|capte)\b|\bje n ai pas (vu|remarque|capte)\b/,
  /\btu veux (que je te|un) \w* ?resum|\bveux tu (que je te|un) \w* ?resum|\bje (peux|pourrais) te (le |la |les )?resumer\b/,
];
/** Le réveil, le matin : seulement le matin (de 4 h à 11 h). */
const REVEIL = /\breveill\w*|\bbien dormi\b|\bbonne matinee\b|\bbon matin\b|\bbonne nuit\b/;
/** Une phrase de faits (un agent, une heure, un chiffre, un canal) : rien à faire dans une excuse sans sujet. */
const NOMS = AGENTS.filter(a => a.id !== 'kuroro' && a.id !== 'L').map(a => norme(a.nom));
const UN_FAIT = (p: string) => /\d/.test(p) || /(^|[\s,(])L($|[\s,.!?)])/.test(p)
  || NOMS.some(n => new RegExp(`\\b${n}\\b`).test(norme(p))) || /\b(telegram|sites?|mails?|posts?|linkedin|releve|point du matin|compte rendu|en panne)\b/.test(norme(p));
/** « D'accord, patron. » en tête d'une réponse sans mission : l'accroche d'une mission, recopiée hors de propos. */
const ACCROCHE_SEULE = /^(d accord|entendu|compris|ok|okay|tres bien|bien recu|parfait)( patron)?$/;
/** La question d'une demande floue, quand le modèle n'en a pas posé. */
export const PRECISER = 'Tu peux me préciser ce que tu attends exactement ?';
const S_EXCUSE = /\b(pardon|desole|excuse|navre)\b/;
const DEMANDE_CE_QU_IL_VEUT = /\b(faire pour toi|attends de moi|je peux t aider|besoin de moi|peux faire pour)\b/;

/**
 * La réponse du modèle (sans mission), relue : `null` s'il n'en reste rien (la page reprend ses règles).
 * - une salutation pure (« salut ça va ? ») : la réponse est écrite par le code (le salut de l'heure, puis ce qu'il attend) ;
 * - jamais « frère » ; jamais « j'ai pas vu ton message », ni un résumé proposé, ni le réveil hors du matin ;
 * - une heure que les faits ne donnent pas est corrigée (corrigerHeures) ;
 * - une phrase déjà dite mot pour mot dans un tour d'avant est retirée ;
 * - « Bonjour » / « Bonsoir » selon l'heure ;
 * - agacé : une excuse, aucun fait collé s'il ne parle d'aucun agent, puis « qu'est-ce que je peux faire pour toi ? ».
 */
export function relire(texte: string, { tours, now, controle }: { tours: Tour[]; now: number; controle?: Controle | null }): string | null {
  const dernier = tours.filter(t => t.role === 'moi').at(-1)?.texte ?? '';
  const p = petitMot(dernier);
  if (p) return repondrePetitMot(p, now).join(' ');

  let t = sansFrere(texte);
  if (controle) t = corrigerHeures(t, controle);
  const h = new Date(now).getUTCHours(), matin = h >= 4 && h < 11;
  const dejaDit = new Set(tours.filter(x => x.role === 'kuroro').flatMap(x => phrasesDe(x.texte)).map(norme).filter(x => x.length >= 12));
  const humeur = humeurDe(dernier), agace = humeur.humeur === 'agacé';
  const sansSujet = !sujetsDe(dernier).some(id => id !== 'kuroro');
  const salut = estJourPourSalut(now) ? 'Bonjour' : 'Bonsoir';

  const gardees = phrasesDe(t).filter((ph, i, toutes) => {
    const n = norme(ph);
    if (!n) return false;
    if (i === 0 && toutes.length > 1 && ACCROCHE_SEULE.test(n)) return false;
    if (JAMAIS.some(r => r.test(n)) || (!matin && REVEIL.test(n))) return false;
    if (dejaDit.has(n) && !DEMANDE_CE_QU_IL_VEUT.test(n)) return false;
    // une excuse ne colle pas des faits qu'il n'a pas demandés
    if (agace && sansSujet && UN_FAIT(ph)) return false;
    return true;
  }).map(ph => ph.replace(/^(\s*)(bonjour|bonsoir)\b/i, `$1${salut}`));

  let r = nettoyer(gardees.join(' '));
  if (estFlou(dernier) && !r.includes('?')) r = nettoyer(`${r} ${PRECISER}`);
  if (agace) {
    const cloche = ceQuiACloche(tours);
    let phrases = phrasesDe(r).map(x => x.trim()).filter(Boolean);
    // le code sait ce qui a cloché (« frère ») : une excuse vague (« j'ai mal réagi ») laisse la place à la juste
    if (cloche && !/\bfrer/.test(norme(r))) phrases = phrases.filter(ph => !S_EXCUSE.test(norme(ph)));
    // sa question (« qu'est-ce que je peux faire pour toi ? ») vient toujours en dernier
    const question = phrases.find(ph => DEMANDE_CE_QU_IL_VEUT.test(norme(ph)));
    phrases = phrases.filter(ph => ph !== question);
    // un reproche sur un agent, sans aucun fait dans la réponse : sa journée, telle que le QG la connaît (écrite par le code)
    if (!sansSujet && controle && !phrases.some(UN_FAIT)) {
      const noms = sujetsDe(dernier).map(id => AGENTS.find(x => x.id === id)?.nom);
      phrases.push(...controle.agents.filter(x => noms.includes(x.nom) && x.journee.length).map(x => `${x.nom} : ${x.journee[0]}`));
    }
    if (!phrases.some(ph => S_EXCUSE.test(norme(ph)))) phrases.unshift(cloche ? 'Pardon patron, je t’ai appelé frère, ça ne se reproduira pas.' : 'Pardon patron.');
    const fin = question ?? (sansSujet || !phrases.some(ph => ph.includes('?')) ? QUE_FAIRE : '');
    r = nettoyer([...phrases, fin].join(' '));
  }
  return r ? majuscule(r) : null;
}
