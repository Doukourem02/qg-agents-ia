// L'outil de la routine de Léa : la seule porte de Léa vers le QG.
// Usage : node scripts/lea.mjs a-relire > /tmp/lea.json   (puis lire /tmp/lea/index.md et les fichiers .diff)
//         node scripts/lea.mjs rapport /tmp/avis.json
// L'adresse vient de QG_URL (par défaut https://mon-qg.vercel.app).
// Aucun secret n'est écrit ici : dans une routine Claude Code, le proxy ajoute lui-même le laissez-passer
// (lancer avec NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1). Pour un essai depuis le Mac, QG_BYPASS est accepté.
//
// `a-relire` écrit aussi le lot sous une forme lisible par morceaux (un seul gros JSON ne se lit pas en entier) :
// /tmp/lea/index.md (le plan du lot) et un fichier .diff par différence, avec de vrais retours à la ligne.
// Le serveur a déjà masqué les secrets ; ce script ne fait que recopier ce qu'il a reçu.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAUT = 'https://mon-qg.vercel.app';
const LECTURES = ['a-relire'];
const ECRITURES = ['rapport'];
/** Le dossier de la forme lisible (LEA_DOSSIER seulement pour les tests ; il doit toujours s'appeler « lea »). */
export const DOSSIER = '/tmp/lea';
/** Au-delà, une ligne est coupée pour la lecture (l'outil de lecture tronque les lignes de plus de 2 000 caractères). */
const MAX_LIGNE = 1000;
const SUITE = '»» ';
const MAX_NOM = 200;

export function construireRequete(commande, corps, env = {}) {
  const lecture = LECTURES.includes(commande);
  if (!lecture && !ECRITURES.includes(commande)) throw new Error(`commande inconnue : ${commande}`);
  const base = (env.QG_URL || DEFAUT).replace(/\/$/, '');
  const headers = { ...(env.QG_BYPASS ? { 'x-vercel-protection-bypass': env.QG_BYPASS } : {}), ...(env.QG_CLE_AGENT ? { 'x-qg-agent-cle': env.QG_CLE_AGENT } : {}) };
  const init = { method: lecture ? 'GET' : 'POST', headers, redirect: 'manual' };
  if (!lecture) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(corps ?? {}); }
  return { url: `${base}/api/agents/lea/${commande}`, init };
}

// --- La forme lisible -------------------------------------------------------------------------

/** Un morceau de chemin sûr : jamais vide, jamais « . » ou « .. », sans caractère de contrôle. */
const segment = (s) => {
  const t = String(s).replace(/[\u0000-\u001f\u007f/\\]/g, '_');
  return t === '' || t === '.' || t === '..' ? '_' : t;
};

/** Le nom du fichier .diff d'un chemin du dépôt : « / » devient « __ », 200 octets au plus. */
export function nomDiff(chemin) {
  const nom = segment(String(chemin).split('/').join('__'));
  if (Buffer.byteLength(nom + '.diff') <= MAX_NOM) return nom + '.diff';
  let court = nom;
  while (Buffer.byteLength(court + '~.diff') > MAX_NOM) court = court.slice(1);
  return '~' + court + '.diff';
}

/** Vide le dossier de la forme lisible (refuse tout dossier qui ne s'appelle pas « lea »). */
export function viderDossier(base = DOSSIER) {
  if (basename(base) !== 'lea') throw new Error(`dossier refusé (${base}) : il doit s'appeler « lea »`);
  rmSync(base, { recursive: true, force: true });
}

const ENTETE_BLOC = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const MARGE = 7;
const vide = ' '.repeat(MARGE);

/**
 * Le patch prêt à lire : chaque ligne ajoutée (`+`) ou de contexte (` `) commence par son vrai numéro dans le nouveau
 * fichier (calculé depuis « @@ … +c … @@ ») ; les lignes retirées, les en-têtes de bloc et les suites n'ont pas de
 * numéro. Une ligne trop longue est coupée ; sa suite commence par « »» ».
 */
function lignesLisibles(patch) {
  let courante = null;
  return String(patch).split('\n').flatMap((l) => {
    const entete = ENTETE_BLOC.exec(l);
    let marge = vide;
    if (entete) courante = Number(entete[1]);
    else if (courante !== null && (l[0] === '+' || l[0] === ' ')) marge = String(courante++).padStart(MARGE - 1) + ' ';
    const morceaux = [];
    for (let i = 0; i < Math.max(l.length, 1); i += MAX_LIGNE) morceaux.push(i === 0 ? marge + l.slice(0, MAX_LIGNE) : vide + SUITE + l.slice(i, i + MAX_LIGNE));
    return morceaux;
  });
}

const dateUtc = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'date inconnue');
const nomFichier = (chemin) => (chemin === '…' ? 'liste coupée par GitHub' : chemin);

/**
 * Écrit la forme lisible de la réponse de `a-relire` : `index.md` et un `.diff` par différence
 * (`<base>/<compte>/<projet>/<sha court>/<chemin avec / → __>.diff`). Le dossier est vidé avant.
 */
export function ecrireLisible(reponse, base = DOSSIER) {
  viderDossier(base);
  mkdirSync(base, { recursive: true });
  const index = join(base, 'index.md');
  const lot = reponse?.lot;
  if (!lot) {
    writeFileSync(index, `# Lot de Léa\n\nAucun lot${reponse?.attente ? ' (un lot est déjà en cours de relecture)' : ''} : rien à relire. Arrête-toi.\n`);
    return { index, projets: 0, diffs: 0 };
  }
  const sortie = [
    `# Lot de Léa · ${lot.id}`,
    '',
    `Recopie \`${lot.id}\` tel quel dans \`lot\` du rapport.`,
    'Lis ce fichier en entier (par morceaux avec offset/limit s\'il est long), puis chaque fichier .diff en entier (de même).',
    'Dans un .diff, le nombre au début d\'une ligne est son numéro dans le fichier (c\'est lui, la « ligne » d\'un constat).',
    `Une ligne qui commence par « ${SUITE.trim()} » (après la marge) continue la ligne d'avant (ligne trop longue coupée).`,
  ];
  let diffs = 0;
  for (const p of lot.projets ?? []) {
    sortie.push('', `## ${p.depot}`, '', `Depuis : ${p.depuis}${p.reecrit ? ' · historique réécrit : relis normalement les commits donnés' : ''}`);
    const dossierProjet = join(base, ...String(p.depot).split('/').map(segment));
    (p.commits ?? []).forEach((c, i) => {
      const court = segment(String(c.sha).slice(0, 7));
      sortie.push('', `### Commit ${i + 1}/${p.commits.length} · ${court} · ${dateUtc(c.date)}`, '', `sha : ${c.sha}`, `message : ${c.message}`);
      if (c.rienACoder) sortie.push('rien de code à relire (images, fichiers générés…) : passe ce commit');
      for (const f of c.fichiers ?? []) {
        if (typeof f.patch === 'string') {
          const dossier = join(dossierProjet, court);
          mkdirSync(dossier, { recursive: true });
          let chemin = join(dossier, nomDiff(f.chemin));
          for (let n = 2; existsSync(chemin); n++) chemin = join(dossier, nomDiff(f.chemin).replace(/\.diff$/, `~${n}.diff`));
          const lignes = [`### ${p.depot} · ${c.sha} · ${f.chemin}`, ...lignesLisibles(f.patch)];
          writeFileSync(chemin, lignes.join('\n'));
          diffs += 1;
          sortie.push(`- \`${f.chemin}\` (${[f.statut, `${lignes.length} lignes dans le fichier`].filter(Boolean).join(', ')}) → ${chemin}`);
        } else {
          const pourquoi = f.note || f.enPartie || 'pas de différence';
          sortie.push(`- \`${nomFichier(f.chemin)}\`${f.statut ? ` (${f.statut})` : ''} : pas envoyé, ne dis rien dessus — ${pourquoi}`);
        }
        if (f.clesNonVerifiees) sortie.push('  (clés non vérifiées par le QG : sans rapport avec ton travail)');
      }
    });
  }
  writeFileSync(index, sortie.join('\n') + '\n');
  return { index, projets: (lot.projets ?? []).length, diffs };
}

// --- La commande ------------------------------------------------------------------------------

async function principal() {
  const [commande, fichier] = process.argv.slice(2);
  if (!commande) throw new Error('usage : node scripts/lea.mjs <a-relire|rapport> [fichier.json]');
  const dossier = process.env.LEA_DOSSIER || DOSSIER;
  let corps;
  if (commande === 'rapport') {
    if (!fichier) throw new Error('« rapport » demande un fichier JSON');
    try { corps = JSON.parse(readFileSync(fichier, 'utf8')); } catch (e) { throw new Error(`fichier illisible ou JSON invalide (${fichier}) : ${e.message}`); }
  }
  const { url, init } = construireRequete(commande, corps, process.env);
  // Un échec ne laisse jamais l'index d'un ancien lot.
  if (commande === 'a-relire') viderDossier(dossier);
  const r = await fetch(url, init);
  if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status}) : laissez-passer manquant ou faux (lancer avec NODE_USE_ENV_PROXY=1 dans la routine)`);
  if (r.status === 401) throw new Error('401 : laissez-passer manquant ou faux');
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${json.erreur ?? 'refusé'}`);
  if (commande === 'a-relire') {
    const l = ecrireLisible(json, dossier);
    console.error(json.lot ? `Lot ${json.lot.id} : ${l.projets} projet(s), ${l.diffs} différence(s). Lis ${l.index}` : `Aucun lot. (${l.index})`);
  }
  console.log(JSON.stringify(json, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(e => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
