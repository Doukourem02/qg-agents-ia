// La mémoire du coffre Obsidian, mise à jour une fois par jour par le relais Mac.
// Lit les dépôts git de ~/Desktop/Code (toutes branches), ajoute les commits, journées et documents nouveaux,
// puis reconstruit l'arbre : Mon Mac → Code → Projet → (Séances → mois → jours → commits | Docs → dossiers → documents | technos).
// Ne touche jamais mastack/ ; n'écrase jamais une séance ni un commit déjà présents ; ne recopie jamais le contenu d'un document.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, dirname, relative, resolve, sep } from 'node:path';

/** Noms affichés des dépôts connus ; un nouveau dépôt prend le nom de son dossier. */
export const NOMS = {
  BotTrading: 'Trading', APP_PRO: 'App Pro', PROJET_TERRA: 'Terra', qg: 'QG', mon_portfolio: 'Portfolio',
  app_livraison: 'Livreo', 'boutique-shop': 'Boutique Shop',
};
const OUTILS = {
  next: 'Next.js', react: 'React', 'react-native': 'React Native', expo: 'Expo', 'expo-router': 'Expo Router',
  typescript: 'TypeScript', tailwindcss: 'Tailwind CSS', prisma: 'Prisma', '@prisma/client': 'Prisma', 'drizzle-orm': 'Drizzle',
  payload: 'Payload', sanity: 'Sanity', '@supabase/supabase-js': 'Supabase', '@clerk/nextjs': 'Clerk', '@clerk/clerk-expo': 'Clerk',
  'better-auth': 'Better Auth', express: 'Express', fastify: 'Fastify', 'socket.io': 'Socket.IO', three: 'Three.js',
  zustand: 'Zustand', '@tanstack/react-query': 'TanStack Query', wxt: 'WXT', '@upstash/redis': 'Upstash',
  pandas: 'pandas', numpy: 'NumPy', ccxt: 'CCXT', fastapi: 'FastAPI', flask: 'Flask', openai: 'OpenAI', anthropic: 'Anthropic',
  'python-telegram-bot': 'Telegram Bot', 'scikit-learn': 'scikit-learn', torch: 'PyTorch', sqlalchemy: 'SQLAlchemy', streamlit: 'Streamlit',
};
const IGNORES = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', '.expo', 'Pods', '.turbo', 'coverage']);
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const propre = s => String(s).replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
export const nomProjet = dossier => NOMS[basename(dossier)] ?? propre(basename(dossier));
export const titreDoc = (nom, rel) => `${nom} – ${propre(rel.replace(/\.md$/, '').replace(/\//g, ' › '))}`;
/** Regroupe des titres « AAAA-MM-JJ — Nom » par mois « AAAA-MM ». */
export function parMois(jours) {
  const r = {};
  for (const j of [...jours].sort()) (r[j.slice(0, 7)] ??= []).push(j);
  return r;
}

function fichiers(racine) {
  const out = [];
  (function parcourir(d) {
    let noms; try { noms = readdirSync(d); } catch { return; }
    for (const n of noms) {
      if (IGNORES.has(n)) continue;
      const p = join(d, n);
      let s; try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) parcourir(p); else out.push(p);
    }
  })(racine);
  return out;
}

/** Les dépôts git sous `code` (3 niveaux au plus). */
export function trouverDepots(code) {
  const depots = [];
  (function chercher(d, niveau) {
    if (existsSync(join(d, '.git'))) { depots.push(d); return; }
    if (niveau >= 3) return;
    let noms; try { noms = readdirSync(d); } catch { return; }
    for (const n of noms) {
      if (IGNORES.has(n) || n.startsWith('.')) continue;
      const p = join(d, n);
      try { if (statSync(p).isDirectory()) chercher(p, niveau + 1); } catch { /* illisible */ }
    }
  })(code, 0);
  return depots;
}

function technos(racine) {
  const t = new Set();
  for (const f of fichiers(racine)) {
    const n = basename(f);
    try {
      if (n === 'package.json') {
        const p = JSON.parse(readFileSync(f, 'utf8'));
        for (const dep of Object.keys({ ...p.dependencies, ...p.devDependencies })) if (OUTILS[dep]) t.add(OUTILS[dep]);
      } else if (n === 'requirements.txt' || n === 'pyproject.toml') {
        const texte = readFileSync(f, 'utf8').toLowerCase();
        for (const [lib, nom] of Object.entries(OUTILS)) if (new RegExp(`(^|[\\s"'])${lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s=<>~!\\[;"']|$)`, 'm').test(texte)) t.add(nom);
      }
    } catch { /* illisible : ignoré */ }
  }
  return t;
}

function lienGithub(racine) {
  try {
    const url = execFileSync('git', ['-C', racine, 'remote', 'get-url', 'origin']).toString().trim();
    const m = url.match(/github\.com[:/](.+?)(\.git)?$/);
    return m ? `https://github.com/${m[1]}` : null;
  } catch { return null; }
}

const lister = d => (existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.md')).map(f => basename(f, '.md')) : []);

export function mettreAJour(coffre, code) {
  const sur = p => {
    const r = resolve(p);
    if (!r.startsWith(resolve(coffre) + sep) || r.startsWith(resolve(coffre, 'mastack') + sep)) throw new Error('chemin refusé');
    return r;
  };
  const creer = (p, md) => { const r = sur(p); if (existsSync(r)) return false; writeFileSync(r, md); return true; };
  const remplacer = (p, md) => { const r = sur(p); if (existsSync(r) && readFileSync(r, 'utf8') === md) return; writeFileSync(r, md); };
  for (const d of ['Séances', 'Projets', 'Docs', 'Stack', 'Commits', 'Carte']) mkdirSync(join(coffre, d), { recursive: true });
  const bilan = { commits: 0, seances: 0, docs: 0, projets: 0 };

  // 1. Les dépôts du Mac : commits, journées, documents, technos
  const technosDe = {};
  for (const racine of trouverDepots(code)) {
    const nom = nomProjet(racine);
    const lien = lienGithub(racine);
    if (!existsSync(join(coffre, 'Projets', nom + '.md'))) bilan.projets++;
    let log = '';
    try { log = execFileSync('git', ['-C', racine, 'log', '--all', '--format=%H%x09%cI%x09%s'], { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch { continue; }
    const jours = {};
    for (const l of log.trim().split('\n').filter(Boolean)) {
      const [sha, date, ...m] = l.split('\t');
      (jours[date.slice(0, 10)] ??= []).push({ sha, message: m.join('\t').trim() });
    }
    mkdirSync(join(coffre, 'Commits', nom), { recursive: true });
    for (const [jour, cs] of Object.entries(jours)) {
      const titreJour = `${jour} — ${nom}`;
      const messages = [...new Set(cs.map(c => c.message))];
      if (creer(join(coffre, 'Séances', titreJour + '.md'), ['---', `date: ${jour}`, `projet: ${nom}`, 'auteur: historique', '---', `# ${titreJour}`, '',
        `## Ce qu'on a fait (${cs.length} commit${cs.length > 1 ? 's' : ''})`, ...messages.slice(0, 15).map(m => `- ${m}`),
        ...(messages.length > 15 ? [`- … et ${messages.length - 15} autres`] : []), ''].join('\n'))) bilan.seances++;
      for (const c of cs) {
        if (creer(join(coffre, 'Commits', nom, `${nom} ${c.sha.slice(0, 7)}.md`),
          `---\ndate: ${jour}\nprojet: ${nom}\n---\n${c.message}\n\n${lien ? `${lien}/commit/${c.sha}\n\n` : ''}[[${titreJour}]]\n`)) bilan.commits++;
      }
    }
    mkdirSync(join(coffre, 'Docs', nom), { recursive: true });
    for (const f of fichiers(racine).filter(f => f.endsWith('.md'))) {
      const rel = relative(racine, f);
      if (rel.startsWith('docs/seances/')) continue;
      if (creer(join(coffre, 'Docs', nom, titreDoc(nom, rel) + '.md'),
        `---\nprojet: ${nom}\nsource: ${rel}\n---\n# ${rel}\n\nDocument du projet ${nom}${lien ? ` : ${lien}/blob/HEAD/${rel}` : ' (sur le Mac)'}\n`)) bilan.docs++;
    }
    technosDe[nom] = technos(racine);
  }

  // 2. Les technos : celles du Mac, plus celles déjà connues (projets seulement sur GitHub)
  const mastack = [];
  (function parcourir(d) { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) parcourir(p); else if (n.endsWith('.md')) mastack.push(basename(n, '.md')); } })(join(coffre, 'mastack'));
  const usage = {};
  for (const t of lister(join(coffre, 'Stack'))) {
    for (const m of readFileSync(join(coffre, 'Stack', t + '.md'), 'utf8').matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (!(m[1] in technosDe)) (usage[t] ??= new Set()).add(m[1]);
    }
  }
  for (const [nom, ts] of Object.entries(technosDe)) for (const t of ts) (usage[t] ??= new Set()).add(nom);
  for (const [t, ps] of Object.entries(usage)) {
    if (mastack.includes(t) || !ps.size) continue;
    remplacer(join(coffre, 'Stack', propre(t) + '.md'), `# ${t}\n\nUtilisé par : ${[...ps].sort().map(p => `[[${p}]]`).join(', ')}\n`);
  }

  // 3. L'arbre, reconstruit depuis le coffre (projets du Mac et projets seulement sur GitHub)
  const projets = [...new Set([...lister(join(coffre, 'Projets')), ...Object.keys(technosDe)])].sort();
  const seances = lister(join(coffre, 'Séances'));
  for (const P of projets) {
    const jours = seances.filter(s => s.endsWith(` — ${P}`) || new RegExp(` — ${P.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)$`).test(s));
    const mois = parMois(jours);
    for (const [m, js] of Object.entries(mois)) {
      const [a, mm] = m.split('-');
      remplacer(join(coffre, 'Carte', `${P} · ${m}.md`), `# ${P} · ${MOIS[+mm - 1]} ${a}\n\n${js.length} jour${js.length > 1 ? 's' : ''} de travail.\n\n${js.map(j => `- [[${j}]]`).join('\n')}\n`);
    }
    remplacer(join(coffre, 'Carte', `${P} · Séances.md`), `# ${P} · Séances\n\n${jours.length} jours de travail, du plus ancien au plus récent.\n\n${Object.keys(mois).sort().map(m => `- [[${P} · ${m}]]`).join('\n')}\n`);
    const dossiers = {};
    for (const d of lister(join(coffre, 'Docs', P))) {
      const source = (readFileSync(join(coffre, 'Docs', P, d + '.md'), 'utf8').match(/^source: (.+)$/m) ?? [])[1] ?? '';
      const dossier = dirname(source) === '.' ? '' : dirname(source).split('/')[0];
      (dossiers[dossier] ??= []).push(d);
    }
    const lignes = [];
    for (const [dossier, docs] of Object.entries(dossiers).sort()) {
      if (!dossier) { lignes.push(...docs.sort().map(d => `- [[${d}]]`)); continue; }
      const hub = `${P} › ${propre(dossier)}`;
      remplacer(join(coffre, 'Carte', hub + '.md'), `# ${P} › ${dossier}/\n\n${docs.sort().map(d => `- [[${d}]]`).join('\n')}\n`);
      lignes.push(`- [[${hub}]]`);
    }
    remplacer(join(coffre, 'Carte', `${P} · Docs.md`), `# ${P} · Docs\n\n${lignes.join('\n')}\n`);
    const ts = Object.entries(usage).filter(([, ps]) => ps.has(P)).map(([t]) => t).sort();
    const ou = P in technosDe ? 'Projet dans ~/Desktop/Code.' : 'Projet sur GitHub (pas de copie sur le Mac).';
    remplacer(join(coffre, 'Projets', P + '.md'), [`# ${P}`, '', ou, '', '## Branches', `- [[${P} · Séances]] : jour par jour, avec les commits`,
      `- [[${P} · Docs]] : les documents du projet`, '', '## Technos', ...ts.map(t => `- [[${t}]]`), ''].join('\n'));
  }
  remplacer(join(coffre, 'Carte', 'Code.md'), `# Code\n\nMes projets (~/Desktop/Code et GitHub).\n\n${projets.map(p => `- [[${p}]]`).join('\n')}\n`);
  remplacer(join(coffre, 'Carte', 'Technos.md'), `# Technos\n\nLes outils que mes projets utilisent vraiment.\n\n${lister(join(coffre, 'Stack')).sort().map(t => `- [[${t}]]`).join('\n')}\n`);
  remplacer(join(coffre, 'Carte', 'Ma stack.md'), `# Ma stack\n\nMa façon de démarrer un projet, ma structure et mes notes d'apprentissage (dossier mastack).\n\n${mastack.sort().map(n => `- [[${n}]]`).join('\n')}\n`);
  // Les trois sauvegardes de Claude Code (écrites par ~/.claude/scripts/sauvegarde-obsidian.py) restent reliées.
  remplacer(join(coffre, 'Carte', 'Mon Mac.md'), `# Mon Mac\n\nLa racine de ma mémoire.\n\n- [[Code]] : mes projets\n- [[Technos]] : les outils qu'ils utilisent\n- [[Ma stack]] : ma façon de démarrer un projet et ce que j'apprends\n- [[Façon de travailler]] : comment Claude travaille avec moi\n- [[Compétence seance]] : comment Claude écrit les notes de séance\n- [[Mémoire de Claude]] : ce que Claude retient de moi\n`);
  return bilan;
}
