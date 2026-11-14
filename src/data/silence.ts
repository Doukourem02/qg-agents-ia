import { enMots, type GenreSujet, type Sujet } from './crise';

// « C'est connu, ignore » (décision du patron, 12 novembre 2026) : partagé par le serveur (src/server/silence.ts) et la
// page. Un problème ignoré est une vraie alerte que le patron connaît déjà : elle ne compte plus pour une réunion, ni dans
// les rappels, ni dans les messages de Luffy, Léa et Zoro, mais reste visible dans la page. Elle revient toute seule
// quand l'état change vraiment (nouvelle panne, nouveau point grave, nouvelle faille). Fonctions pures, sans réseau.

/** Un problème ignoré, gardé tel que le suivi l'a lu, avec l'heure où le patron l'a ignoré. */
export type Ignore = Sujet & { ignoreDepuis: number };

/** Ce que la page montre : un groupe ignoré (« API Livreo », « 13 failles critiques de Zoro ») et depuis quand. */
export type VueIgnore = { groupe: string; agent: string; libelle: string; depuis: number; reprendre: string };
export type VueSilence = { ignores: VueIgnore[]; /** La pause générale des alertes, jusqu'à cet instant ; null : pas de pause. */ pause: number | null };

/**
 * Un groupe de problèmes, celui d'un bouton « Ignorer » : `site:<id>` (un site de Luffy), `lea`, `zoro`, `routine`, ou
 * `*` (tout), éventuellement limité à un projet (`zoro@qg`). L'id tient dans les 64 octets d'un bouton Telegram.
 */
export type Groupe = { id: string; sujets: Sujet[] };

/** Minuscules, sans accents ni apostrophes : « Ne t’inquiète pas » → « ne t inquiete pas ». */
export const norme = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9?]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Le groupe naturel d'un problème : son site pour Luffy, son agent sinon. */
export const idGroupe = (s: Pick<Sujet, 'genre' | 'cle'>) => (s.genre === 'site' ? s.cle : s.genre);

/** Le problème fait-il partie du groupe ? */
export function dansGroupe(id: string, s: Pick<Sujet, 'genre' | 'cle' | 'projet'>): boolean {
  const [base, projet] = id.split('@');
  const ok = base === '*' || (base.startsWith('site:') ? s.cle === base : s.genre === base);
  return ok && (!projet || norme(s.projet) === projet);
}

/** Les groupes naturels des problèmes donnés, dans l'ordre où ils apparaissent. */
export function groupesDe(sujets: readonly Sujet[]): Groupe[] {
  const m = new Map<string, Sujet[]>();
  for (const s of sujets) m.set(idGroupe(s), [...(m.get(idGroupe(s)) ?? []), s]);
  return [...m].map(([id, l]) => ({ id, sujets: l }));
}

/** Un id de groupe limité à un projet ; sans le projet s'il ne tient pas dans un bouton. */
export const avecProjet = (base: string, projet: string) => {
  const id = `${base}@${norme(projet)}`;
  return new TextEncoder().encode(`ign:${id}`).length <= 64 ? id : base;
};

const projetsDe = (l: readonly Sujet[]) => [...new Set(l.map(s => s.projet))];
const dans = (l: readonly Sujet[]) => { const p = projetsDe(l); return p.length <= 2 ? ` dans ${enMots(p)}` : ''; };

/** Les deux sites qui ont un nom en propre ; les autres sont « le site X ». */
const SITES_NOMMES: Record<string, { de: string; elle: boolean }> = {
  'site:api-livreo': { de: 'de l\'API Livreo', elle: true },
  'site:admin-livreo': { de: 'de l\'admin de Livreo', elle: false },
};

/** Le nom court d'un groupe : « API Livreo », « point grave de Léa dans qg », « 13 failles critiques de Zoro ». */
export function libelle(g: Groupe): string {
  const l = g.sujets, n = l.length;
  const sites = l.filter(s => s.genre === 'site');
  const morceaux: string[] = [];
  if (sites.length) morceaux.push(enMots([...new Set(sites.map(s => s.nom))]));
  const lea = l.filter(s => s.genre === 'lea');
  if (lea.length) morceaux.push(`${lea.length > 1 ? `${lea.length} points graves` : 'point grave'} de Léa${dans(lea)}`);
  const zoro = l.filter(s => s.genre === 'zoro');
  if (zoro.length) morceaux.push(`${zoro.length > 1 ? `${zoro.length} failles critiques` : 'faille critique'} de Zoro${dans(zoro)}`);
  const routines = l.filter(s => s.genre === 'routine');
  if (routines.length) morceaux.push(routines.length > 1 ? `${routines.length} passages prévus ratés` : 'passage prévu raté');
  return n ? enMots(morceaux) : '';
}

/** Le texte d'un bouton : « Ignorer API Livreo », « Ignorer Léa », « Ignorer les failles de Zoro (qg) ». */
export function texteBouton(g: Groupe, verbe = 'Ignorer'): string {
  const [base, projet] = g.id.split('@');
  const p = projet ? ` (${g.sujets[0]?.projet ?? projet})` : '';
  if (base.startsWith('site:')) return `${verbe} ${g.sujets[0]?.nom ?? base.slice(5)}`;
  if (base === 'lea') return `${verbe} Léa${p}`;
  if (base === 'zoro') return `${verbe} les failles de Zoro${p}`;
  if (base === 'routine') return `${verbe} les passages ratés`;
  return `${verbe} tout ça${p}`;
}

/** Le mot à écrire pour reprendre : « Livreo » (le projet d'un site), « Léa », « Zoro », « les passages ». */
export function motReprendre(g: Pick<Groupe, 'id' | 'sujets'>): string {
  const [base] = g.id.split('@');
  if (base.startsWith('site:')) return g.sujets[0]?.projet ?? base.slice(5);
  if (base === 'lea') return 'Léa';
  if (base === 'zoro') return 'Zoro';
  if (base === 'routine') return 'les passages';
  return 'tout';
}

/** Ce que la confirmation dit d'un groupe : de quoi, jusqu'à quand, ce qui reste visible, ce qui reviendrait. */
function phrases(g: Groupe): { de: string; tant: string; visible: string; nouveau: string } {
  const [base] = g.id.split('@');
  const n = g.sujets.length;
  if (base.startsWith('site:')) {
    const nomme = SITES_NOMMES[base];
    const nom = g.sujets[0]?.nom ?? base.slice(5);
    const elle = nomme?.elle ?? false;
    return {
      de: nomme?.de ?? `du site ${nom}`, tant: ` tant qu'${elle ? 'elle' : 'il'} reste en panne`,
      visible: `${elle ? 'Elle' : 'Il'} reste visible dans la page.`, nouveau: '',
    };
  }
  const lib = libelle(g);
  const pluriel = n > 1;
  if (base === 'lea') {
    return { de: `d${pluriel ? 'es' : 'u'} ${lib}`, tant: '', visible: `${pluriel ? 'Ils restent visibles' : 'Il reste visible'} dans la page.`, nouveau: 'Un nouveau point grave te sera signalé.' };
  }
  if (base === 'zoro') {
    return { de: `d${pluriel ? 'es' : 'e la'} ${lib}`, tant: '', visible: `${pluriel ? 'Elles restent visibles' : 'Elle reste visible'} dans la page.`, nouveau: 'Une nouvelle faille critique te sera signalée.' };
  }
  return { de: `d${pluriel ? 'es' : 'u'} ${lib}`, tant: '', visible: `${pluriel ? 'Ils restent visibles' : 'Il reste visible'} dans la page.`, nouveau: '' };
}

/**
 * La confirmation d'un « ignore » : « D'accord : je ne te parle plus de l'API Livreo tant qu'elle reste en panne. Elle
 * reste visible dans la page. Écris « reprends Livreo » pour annuler. »
 */
export function confirmationIgnore(groupes: readonly Groupe[]): string {
  const p = groupes.map(phrases);
  const mots = [...new Set(groupes.map(motReprendre))].map(m => `« reprends ${m} »`);
  const ecris = `Écris ${mots.join(' ou ')} pour annuler.`;
  if (p.length === 1) return [`D'accord : je ne te parle plus ${p[0].de}${p[0].tant}.`, p[0].visible, p[0].nouveau, ecris].filter(Boolean).join(' ');
  const quoi = p.map(x => `${x.de}${x.tant ? ` (${x.tant.trim()})` : ''}`);
  return `D'accord : je ne te parle plus ${quoi.slice(0, -1).join(', ')} ni ${quoi[quoi.length - 1]}. Tout reste visible dans la page, et ce qui change vraiment te sera signalé. ${ecris}`;
}

/** La confirmation d'une reprise : « C'est reparti : je te reparle de l'API Livreo. » */
export function confirmationReprise(groupes: readonly Groupe[]): string {
  const p = groupes.map(g => phrases(g).de);
  return `C'est reparti : je te reparle ${p.length > 1 ? `${p.slice(0, -1).join(', ')} et ${p[p.length - 1]}` : p[0]}.`;
}

// ───────────── Reconnaître la cible ─────────────

/** Les mots qui désignent un agent (et donc ses alertes). */
const GENRES: [RegExp, GenreSujet][] = [
  [/\blea\b/, 'lea'],
  [/\b(zoro|failles?|securite|vulnerabilites?)\b/, 'zoro'],
  [/\b(luffy|sites?)\b/, 'site'],
  [/\b(passages?|routines?)\b/, 'routine'],
];

/** Les mots d'une commande, qui ne désignent rien : ce qui reste, s'il reste quelque chose, est une cible. */
const VIDES = new Set((
  'ignore ignores ignorer ignorez ignor ingore ingores igonre ignoe ne n t te tu toi inquiete inquietes inquiete pas plus '
  + 'pour les le la l de du des d un une ca cela c est cest normal connu c laisse tomber tais tait taire stp svp s il plait '
  + 'peux peut veux bien merci ok okay d accord daccord bon alors et aussi me m parle parler dis dire alertes alerte '
  + 'message messages en panne a au aux sur avec y oui je sais deja sujet probleme problemes truc ce cet cette rien '
  + 'reprends reprend reprendre reprenez repren reactive reactiver remets remettre surveille nouveau reparle moi '
  + 'arrete arreter de point points grave graves critique critiques tout tous toutes chose choses'
).split(' '));

export type Cible =
  | { quoi: 'groupes'; groupes: Groupe[] }
  /** Plusieurs genres d'alertes pour un même nom (« qg » : Léa et Zoro) : Kuroro demande avec des boutons. */
  | { quoi: 'doute'; groupes: Groupe[]; tout: Groupe }
  /** Une cible nommée qui ne correspond à rien d'ouvert. */
  | { quoi: 'rien'; mots: string }
  /** Aucune cible (« ignore ça », « ne t'inquiète pas ») : Kuroro demande avec des boutons. */
  | { quoi: 'vague' }
  | { quoi: 'tout' };

const mots = (t: string) => t.split(' ').filter(Boolean);
const contient = (t: string, phrase: string) => phrase !== '' && ` ${t} `.includes(` ${phrase} `);

/**
 * Ce que vise la phrase, parmi les problèmes donnés (ouverts pour « ignore », ignorés pour « reprends ») : un nom de
 * site, un agent (« Léa », « Zoro », « failles »), un nom de projet (« Livreo », « qg »), ou rien. Règles du code
 * seulement, jamais le modèle.
 */
export function cibler(texte: string, sujets: readonly Sujet[]): Cible {
  const t = norme(texte).replace(/\?/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(tout|tous|toutes)\b/.test(t) && !/\b(tout ca|tout cela)\b/.test(t) && !GENRES.some(([r]) => r.test(t))) {
    const nommes = sujets.filter(s => contient(t, norme(s.projet)) || contient(t, norme(s.nom)));
    if (!nommes.length) return { quoi: 'tout' };
  }
  const genres = new Set(GENRES.filter(([r]) => r.test(t)).map(([, g]) => g));
  // un site nommé (« api livreo », « boutique stores ») ou par son projet (« Livreo » : ses deux adresses) ; le nom d'un
  // site en panne passe avant le reste (« ignore Livreo » vise la panne, pas une faille d'un autre dépôt)
  const parSite = sujets.filter(s => s.genre === 'site'
    && (contient(t, norme(s.nom)) || contient(t, s.cle.slice(5).replace(/-/g, ' ')) || contient(t, norme(s.projet))));
  const parProjet = sujets.filter(s => contient(t, norme(s.projet)) || (s.genre !== 'site' && contient(t, norme(s.nom))));
  const siteVise = parSite.length > 0 && (!genres.size || genres.has('site'));
  const nommes = siteVise ? parSite : parProjet.filter(s => s.genre !== 'site' || genres.has('site'));
  let vises: Sujet[];
  if (nommes.length && genres.size) vises = nommes.filter(s => genres.has(s.genre));
  else if (nommes.length) vises = nommes;
  else if (genres.size) vises = sujets.filter(s => genres.has(s.genre));
  else vises = [];
  if (vises.length) {
    const g = groupesDe(vises);
    // un même nom pour plusieurs genres d'alertes, sans agent nommé : on demande
    const types = new Set(vises.map(s => s.genre));
    if (!genres.size && !siteVise && types.size > 1) {
      const projet = vises[0].projet;
      const restreints = [...types].map(genre => {
        const l = vises.filter(s => s.genre === genre);
        return { id: genre === 'site' ? (l.length === 1 ? l[0].cle : 'site') : avecProjet(genre, projet), sujets: l };
      });
      return { quoi: 'doute', groupes: restreints, tout: { id: avecProjet('*', projet), sujets: vises } };
    }
    // un agent limité à un projet (« les failles de qg ») : le groupe le dit, pour que le bouton vise juste
    if (nommes.length && genres.size && !siteVise) {
      const projet = vises[0].projet;
      return { quoi: 'groupes', groupes: g.map(x => (x.id.startsWith('site:') ? x : { id: avecProjet(x.id, projet), sujets: x.sujets })) };
    }
    return { quoi: 'groupes', groupes: g };
  }
  const reste = mots(t).filter(m => !VIDES.has(m) && m.length > 1);
  if (genres.size) return { quoi: 'rien', mots: [...genres].map(g => ({ site: 'les sites', lea: 'Léa', zoro: 'Zoro', routine: 'les passages' })[g]).join(', ') };
  return reste.length ? { quoi: 'rien', mots: reste.join(' ') } : { quoi: 'vague' };
}

/** Les ignorés pour la page et le compte rendu : un groupe par site, par agent, avec depuis quand. */
export function vueIgnores(ignores: readonly Ignore[]): VueIgnore[] {
  return groupesDe(ignores).map(g => ({
    groupe: g.id, agent: g.sujets[0].agent, libelle: libelle(g),
    depuis: Math.min(...(g.sujets as Ignore[]).map(s => s.ignoreDepuis)), reprendre: motReprendre(g),
  }));
}
