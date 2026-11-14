import type { KV } from './memoire';
import { CLES, type Entree } from './qg';
import { idsEnAttente, CLES_ACCORDS, type Accord } from './accords';
import { CLE_PROPOSITIONS, type Proposition as Sujets } from './l/posts';
import { vueClara } from './clara/vue';
import { vueMafe } from './mafe/vue';
import { vueLuffy } from './luffy/vue';
import { duree } from './luffy/vigie';
import { vueIsaac, goEntier } from './isaac/vue';
import { vueLight } from './light/vue';
import type { Panneau } from './vues';

// Ce que chaque agent a de nouveau pour le patron quand il arrive (menu « comptes rendus »).
// Seulement des données réelles, en mots simples : jamais de code d'erreur, de chemin ni d'adresse.
// « Nouveau » = daté après la dernière visite ; mais un état urgent encore vrai (site en panne, question,
// proposition, sujet ou brouillon en attente) reste toujours, quelle que soit sa date.

export type CompteRendu = { agent: string; nom: string; urgent: boolean; titre: string; phrases: string[]; quand: number; ouvre?: Panneau };

/** La dernière visite du patron : un simple horodatage dans la table `qg:visite`. */
export const CLE_VISITE = 'qg:visite';
const GO = 1024 ** 3;
const SEUIL_PLACE = 20 * GO;
const TITRE_MAX = 40, PHRASE_MAX = 140, PHRASES_MAX = 3;
/** Ordre des urgents : ce qui coûte le plus cher d'attendre. */
const ORDRE_URGENTS = ['luffy', 'clara', 'isaac', 'L', 'light', 'mafe'];
const NOMS: Record<string, string> = { L: 'L', light: 'Light', clara: 'Clara', mafe: 'Mafe', luffy: 'Luffy', isaac: 'Isaac' };

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Une phrase affichable : sans adresse ni barre oblique, coupée proprement sous 140 caractères. */
function propre(texte: string, max = PHRASE_MAX): string {
  const t = texte.replace(/https?:\/\/\S+/g, '').replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:—-]+$/, '');
  return `${coupe}…`;
}
const phrases2 = (texte: string) => texte.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).slice(0, 2).map(s => propre(s));

type Brouillon = Omit<CompteRendu, 'nom'>;

async function lireVisite(kv: KV): Promise<number | null> {
  const v = Number((await kv.hmget(CLE_VISITE, ['quand'])).quand);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function json<T>(brut: string | undefined): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

/** La visite est notée à `now`, ou à `jusqua` (l'heure de la liste que le patron a vue) si elle est plus ancienne : rien d'arrivé entre-temps n'est perdu. */
export async function marquerVisite(kv: KV, now = Date.now(), jusqua?: number): Promise<void> {
  const t = typeof jusqua === 'number' && Number.isFinite(jusqua) && jusqua > 0 ? Math.min(jusqua, now) : now;
  await kv.hset(CLE_VISITE, 'quand', String(t));
}

export async function comptesRendus(kv: KV, now = Date.now()): Promise<{ depuis: number | null; now: number; liste: CompteRendu[] }> {
  const depuis = await lireVisite(kv).catch(() => null);
  const nouveau = (t: number) => depuis === null || t > depuis;

  const sources: (() => Promise<Brouillon | null>)[] = [
    async () => {
      const v = await vueLuffy(kv, now);
      const lignes: string[] = [];
      // jamais passé : rien à dire ; endormi : on n'affirme pas l'état des sites (comme vuesQG), on le dit
      if (v.dernier === null) return null;
      const enPanne = v.endormi ? [] : v.sites.filter(s => !s.enLigne && typeof s.depuis === 'number');
      if (v.endormi) lignes.push('Luffy ne vérifie plus tes sites.');
      for (const s of enPanne) lignes.push(`${s.nom} est en panne depuis ${duree(now - (s.depuis as number))}.`);
      const revenus = v.pannes7j.filter(p => p.fin !== undefined && nouveau(p.fin));
      for (const p of revenus) lignes.push(`${p.nom} est revenu après ${p.duree} de panne.`);
      if (!lignes.length) return null;
      const phrases = lignes.length > PHRASES_MAX ? [...lignes.slice(0, PHRASES_MAX - 1), `Et ${lignes.length - PHRASES_MAX + 1} autres nouvelles de tes sites.`] : lignes;
      const titre = v.endormi ? 'Luffy ne surveille plus' : enPanne.length ? (enPanne.length > 1 ? 'Des sites sont en panne' : 'Un site est en panne') : (revenus.length > 1 ? 'Des sites sont revenus' : 'Un site est revenu');
      const quand = Math.max(v.endormi ? v.dernier : 0, ...enPanne.map(s => s.depuis as number), ...revenus.map(p => p.fin as number));
      return { agent: 'luffy', urgent: enPanne.length > 0, titre, phrases, quand, ouvre: 'bureauLuffy' };
    },
    async () => {
      const v = await vueClara(kv);
      const phrases: string[] = [];
      const q = v.questions.length;
      if (q) phrases.push(q > 1 ? `${q} questions sur tes mails t'attendent.` : "Une question sur tes mails t'attend.");
      // les mails des bannis partis à la corbeille depuis la visite : somme des entrées du journal dont le résultat se lit sans doute
      // (rien sans visite connue : le journal est coupé, le total serait faux)
      let corbeille = 0, derniereCorbeille = 0;
      if (depuis !== null) {
        for (const brut of await kv.lrange(CLES.journal, 0, -1)) {
          const e = json<Entree>(brut);
          const n = e && e.agent === 'clara' && e.texte === 'mails mis à la corbeille' && e.quand > depuis && e.quand <= now ? /^(\d+) mails? /.exec(e.resultat ?? '') : null;
          if (n && e) { corbeille += Number(n[1]); derniereCorbeille = Math.max(derniereCorbeille, e.quand); }
        }
      }
      if (corbeille > 0) phrases.push(`${pluriel(corbeille, 'mail', 'mails')} de tes bannis ${corbeille > 1 ? 'sont partis' : 'est parti'} à la corbeille.`);
      if (!phrases.length) return null;
      return { agent: 'clara', urgent: q > 0, titre: q ? 'Des questions sur tes mails' : 'Ménage dans tes mails', phrases, quand: derniereCorbeille, ouvre: 'bureauClara' };
    },
    async () => {
      const v = await vueIsaac(kv, now);
      const phrases: string[] = [];
      const valides = v.propositions.filter(p => !p.expiree);
      if (valides.length) {
        const go = goEntier(valides.reduce((s, p) => s + p.taille, 0));
        const libere = go > 0 ? ` pour libérer ${go} Go` : '';
        phrases.push(valides.length > 1 ? `${valides.length} propositions${libere} t'attendent sur Telegram.` : `Une proposition${libere} t'attend sur Telegram.`);
      }
      const liberes = v.liberes.liste.filter(x => nouveau(x.quand)).reduce((s, x) => s + x.libere, 0);
      if (liberes >= GO / 2) phrases.push(`Isaac a libéré ${goEntier(liberes)} Go depuis ta dernière visite.`);
      if (v.place && nouveau(v.place.quand) && (v.place.libre < SEUIL_PLACE || liberes > 0)) {
        phrases.push(v.place.libre < SEUIL_PLACE ? `Ton Mac n'a plus que ${goEntier(v.place.libre)} Go libres.` : `Ton Mac a ${goEntier(v.place.libre)} Go libres.`);
      }
      if (!phrases.length) return null;
      const quand = Math.max(0, ...valides.map(p => p.quand), v.place?.quand ?? 0, ...v.liberes.liste.map(x => x.quand));
      return { agent: 'isaac', urgent: valides.length > 0, titre: valides.length ? 'Des propositions t\'attendent' : 'Place sur ton Mac', phrases: phrases.slice(0, PHRASES_MAX), quand, ouvre: 'bureauIsaac' };
    },
    async () => {
      const { releve } = await vueMafe(kv, now);
      if (!releve || releve.pasAJour || !nouveau(releve.quand)) return null;
      const texte = releve.phrase?.trim() || (releve.priorite ? `Commence par ${releve.priorite.nom} — ${releve.priorite.raison.replace(/[.\s]+$/, '')}.` : '');
      if (!texte) return null;
      return { agent: 'mafe', urgent: false, titre: 'Le point sur tes projets', phrases: [propre(texte)], quand: releve.quand, ouvre: 'bureauMafe' };
    },
    async () => {
      const v = await vueLight(kv, now);
      if (!v.jour || v.quand === undefined || !nouveau(v.quand)) return null;
      const phrases = v.resume ? phrases2(v.resume) : [];
      if (!phrases.length) return null;
      return { agent: 'light', urgent: v.message.etat === 'envoye' || v.message.etat === 'relance', titre: 'Le relevé de tes outils', phrases, quand: v.quand, ouvre: 'releveLight' };
    },
    async () => {
      const [attente, accords, brutesSujets] = await Promise.all([idsEnAttente(kv), kv.hgetall(CLES_ACCORDS.tous), kv.hgetall(CLE_PROPOSITIONS)]);
      const brouillons = attente.filter(id => json<Accord>(accords[id])?.agent === 'L').length;
      const courante = Object.values(brutesSujets).flatMap(b => { const p = json<Sujets>(b); return p ? [p] : []; }).sort((a, b) => b.quand - a.quand)[0];
      const sujets = courante && courante.choix === undefined && Array.isArray(courante.sujets) ? courante.sujets.length : 0;
      const phrases: string[] = [];
      if (brouillons) phrases.push(brouillons > 1 ? `${brouillons} brouillons attendent ton accord.` : 'Un brouillon attend ton accord.');
      if (sujets) phrases.push(sujets > 1 ? `${sujets} sujets de post attendent ton choix.` : 'Un sujet de post attend ton choix.');
      if (!phrases.length) return null;
      return { agent: 'L', urgent: true, titre: 'Il y a un post à décider', phrases, quand: Math.max(0, courante?.quand ?? 0, ...attente.map(id => json<Accord>(accords[id])?.demande ?? 0)), ouvre: 'bureauL' };
    },
  ];

  const resultats = await Promise.all(sources.map(s => s().catch(() => null)));
  const liste = resultats.flatMap((b): CompteRendu[] => {
    if (!b || !b.phrases.length) return [];
    return [{ ...b, nom: NOMS[b.agent] ?? b.agent, titre: propre(b.titre, TITRE_MAX), phrases: b.phrases.slice(0, PHRASES_MAX).map(p => propre(p)) }];
  });
  liste.sort((a, b) => Number(b.urgent) - Number(a.urgent)
    || (a.urgent ? ORDRE_URGENTS.indexOf(a.agent) - ORDRE_URGENTS.indexOf(b.agent) : b.quand - a.quand));
  return { depuis, now, liste };
}
