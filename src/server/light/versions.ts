// Lecture des versions dans les manifestes (package.json, .nvmrc) : fonctions pures, sans réseau.

export const OUTILS_SUIVIS: readonly string[] = [
  'next', 'react', 'react-native', 'expo', 'expo-router', 'typescript', 'tailwindcss', 'prisma', '@prisma/client',
  'drizzle-orm', 'payload', 'sanity', '@supabase/supabase-js', '@clerk/nextjs', 'better-auth', 'express', 'fastify',
  'socket.io', 'three', 'zustand', '@tanstack/react-query', 'wxt', '@upstash/redis',
];

export type Version = { brut: string; parties: [number, number, number] };
export type Usage = { paquet: string; version: Version };

// Préfixe optionnel (^, ~, >=, >, =, v), puis le numéro ; le lookahead refuse « 4abc » et « 5.0.0-beta » reste lisible.
const BORNE = /^(?:\^|~|>=|>|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?=$|[\s\-+])/;

/** Plus basse version permise par une plage (`^55.0.12` → 55.0.12). Null si la plage est illisible. */
export function versionMin(plage: string): Version | null {
  const premiere = plage.split('||')[0].trim();
  const m = BORNE.exec(premiere);
  if (!m) return null;
  const n = (x: string | undefined) => (x && /^\d+$/.test(x) ? Number(x) : 0);
  const parties: [number, number, number] = [n(m[1]), n(m[2]), n(m[3])];
  return { brut: parties.join('.'), parties };
}

/** Série majeure : `55` pour 55.0.12, `0.83` pour 0.83.4, `0.0.7` pour 0.0.7. */
export function serieMajeure(v: Version): string {
  const [a, b, c] = v.parties;
  if (a > 0) return `${a}`;
  if (b > 0) return `0.${b}`;
  return `0.0.${c}`;
}

/** Nombre de majeurs entre la version utilisée et la dernière ; jamais négatif, au moins 1 si la série change. */
export function ecartMajeur(utilisee: Version, derniere: Version): number {
  const cle = (v: Version) => (v.parties[0] > 0 ? v.parties[0] : v.parties[1]);
  let ecart = Math.max(0, cle(derniere) - cle(utilisee));
  // Passage de la série 0.x à une série 1.x ou plus : au moins un majeur, même si les numéros ne s'y prêtent pas.
  if (utilisee.parties[0] === 0 && derniere.parties[0] > 0 && ecart === 0) ecart = 1;
  return ecart;
}

/** Lit un package.json (dependencies puis devDependencies) et le Node attendu. JSON invalide → aucun usage. */
export function lireManifeste(json: string, extra: { nvmrc?: string } = {}): { nom?: string; usages: Usage[] } {
  let racine: Record<string, unknown>;
  try {
    const lu: unknown = JSON.parse(json);
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return { usages: [] };
    racine = lu as Record<string, unknown>;
  } catch {
    return { usages: [] };
  }

  const usages: Usage[] = [];
  const vus = new Set<string>();
  const ajouter = (paquet: string, plage: unknown) => {
    if (typeof plage !== 'string' || vus.has(paquet)) return;
    const version = versionMin(plage);
    if (version) { vus.add(paquet); usages.push({ paquet, version }); }
  };

  for (const champ of ['dependencies', 'devDependencies'] as const) {
    const liste = racine[champ];
    if (!liste || typeof liste !== 'object') continue;
    for (const [paquet, plage] of Object.entries(liste)) {
      if (OUTILS_SUIVIS.includes(paquet)) ajouter(paquet, plage);
    }
  }

  // Le .nvmrc donne la version réellement utilisée ; engines.node sert de repli.
  const nvmrc = extra.nvmrc !== undefined ? versionMin(extra.nvmrc.trim()) : null;
  if (nvmrc) { vus.add('node'); usages.push({ paquet: 'node', version: nvmrc }); }
  else {
    const engines = racine.engines as Record<string, unknown> | undefined;
    if (engines && typeof engines === 'object') ajouter('node', engines.node);
  }

  const nom = typeof racine.name === 'string' ? racine.name : undefined;
  return { nom, usages };
}
