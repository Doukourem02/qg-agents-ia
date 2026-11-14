import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { PDFDocument } from 'pdf-lib';
import { Refus } from '../qg';

// Les visuels de L dans la charte >_ : 4 modèles (carte, schéma, capture, carrousel),
// leur validation et leur rendu en PNG 1080 × 1350 (plus un PDF pour le carrousel).
// La mise en page transcrit la maquette validée : scripts/maquette-visuels.mjs.

export type Visuel =
  | { modele: 'carte'; rubrique: string; surtitre: string; lignes: string[]; accent: string; texte?: string; pied: [string, string] }
  | { modele: 'schema'; rubrique: string; titre: string; etapes: { titre: string; sous: string }[]; liens: string[]; encadre?: { titre: string; texte: string }; pied: [string, string] }
  | { modele: 'capture'; rubrique: string; lignes: string[]; accent: string; capture: string; barre: string; pied: [string, string] }
  | { modele: 'carrousel'; rubrique: string; titre: string[]; accent: string; etiquettes: string[]; pages: { titre: string; texte: string }[]; pied: [string, string] };

export const MODELES = ['carte', 'schema', 'capture', 'carrousel'] as const;
const DOSSIER_CAPTURES = 'public/l/captures';

// ---------- Validation ----------

type Objet = Record<string, unknown>;

function texte(v: unknown, nom: string, max: number): string;
function texte(v: unknown, nom: string, max: number, requis: false): string | undefined;
function texte(v: unknown, nom: string, max: number, requis = true): string | undefined {
  if (v != null && typeof v !== 'string') throw new Refus(`« ${nom} » doit être un texte`);
  const t = (v ?? '').trim();
  if (!t) { if (requis) throw new Refus(`« ${nom} » manquant`); return undefined; }
  if (t.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return t;
}

function liste(v: unknown, nom: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) throw new Refus(`« ${nom} » doit être une liste`);
  if (v.length < min || v.length > max) {
    throw new Refus(min === max ? `« ${nom} » : ${min} élément(s) attendu(s), reçu ${v.length}` : `« ${nom} » : de ${min} à ${max} éléments attendus, reçu ${v.length}`);
  }
  return v;
}

const textes = (v: unknown, nom: string, min: number, max: number, longueur: number) =>
  liste(v, nom, min, max).map((t, i) => texte(t, `${nom}[${i}]`, longueur));

function objet(v: unknown, nom: string): Objet {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new Refus(`« ${nom} » doit être un objet`);
  return v as Objet;
}

/** Vérifie une description de visuel écrite par L. Refus 400 au moindre écart : rien ne doit déborder de l'image. */
export function validerVisuel(v: unknown, captures: string[]): Visuel {
  const o = objet(v, 'visuel');
  const modele = o.modele;
  if (typeof modele !== 'string' || !(MODELES as readonly string[]).includes(modele)) {
    throw new Refus(`« modele » inconnu : ${String(modele).slice(0, 40)} (attendu : ${MODELES.join(', ')})`);
  }
  // La rubrique s'affiche « # rubrique » : un « # » écrit par L est retiré.
  const rubrique = texte(typeof o.rubrique === 'string' ? o.rubrique.trim().replace(/^#+\s*/, '') : o.rubrique, 'rubrique', 20);
  const [g, d] = textes(o.pied, 'pied', 2, 2, 30);
  const pied: [string, string] = [g, d];

  switch (modele) {
    case 'carte': {
      const t = texte(o.texte, 'texte', 140, false);
      return {
        modele, rubrique, surtitre: texte(o.surtitre, 'surtitre', 40),
        lignes: textes(o.lignes, 'lignes', 1, 3, 22), accent: texte(o.accent, 'accent', 22),
        ...(t ? { texte: t } : {}), pied,
      };
    }
    case 'schema': {
      const etapes = liste(o.etapes, 'etapes', 2, 4).map((e, i) => {
        const x = objet(e, `etapes[${i}]`);
        return { titre: texte(x.titre, `etapes[${i}].titre`, 24), sous: texte(x.sous, `etapes[${i}].sous`, 28) };
      });
      const n = etapes.length - 1;
      const liens = textes(o.liens, 'liens', n, n, 22);
      let encadre: { titre: string; texte: string } | undefined;
      if (o.encadre != null) {
        const x = objet(o.encadre, 'encadre');
        encadre = { titre: texte(x.titre, 'encadre.titre', 24), texte: texte(x.texte, 'encadre.texte', 110) };
      }
      return { modele, rubrique, titre: texte(o.titre, 'titre', 60), etapes, liens, ...(encadre ? { encadre } : {}), pied };
    }
    case 'capture': {
      // Une capture vient seulement de la bibliothèque : le nom exact, sans chemin ni extension.
      const nom = texte(o.capture, 'capture', 80);
      if (!captures.includes(nom)) {
        throw new Refus(`« capture » inconnue : ${nom.slice(0, 40)} (bibliothèque : ${captures.join(', ') || 'vide'})`);
      }
      return {
        modele, rubrique, lignes: textes(o.lignes, 'lignes', 1, 2, 26), accent: texte(o.accent, 'accent', 26),
        capture: nom, barre: texte(o.barre, 'barre', 30), pied,
      };
    }
    default: {
      const pages = liste(o.pages, 'pages', 2, 5).map((p, i) => {
        const x = objet(p, `pages[${i}]`);
        return { titre: texte(x.titre, `pages[${i}].titre`, 40), texte: texte(x.texte, `pages[${i}].texte`, 280) };
      });
      return {
        modele: 'carrousel', rubrique, titre: textes(o.titre, 'titre', 1, 2, 16), accent: texte(o.accent, 'accent', 16),
        etiquettes: o.etiquettes == null ? [] : textes(o.etiquettes, 'etiquettes', 0, 3, 20), pages, pied,
      };
    }
  }
}

/** Tous les textes du visuel, pour vérifier qu'aucun ne nomme un projet non autorisé. */
export function textesDuVisuel(v: Visuel): string {
  const t: (string | undefined)[] = [v.rubrique, ...v.pied];
  switch (v.modele) {
    case 'carte': t.push(v.surtitre, ...v.lignes, v.accent, v.texte); break;
    case 'schema': t.push(v.titre, ...v.etapes.flatMap(e => [e.titre, e.sous]), ...v.liens, v.encadre?.titre, v.encadre?.texte); break;
    case 'capture': t.push(...v.lignes, v.accent, v.capture, v.barre); break;
    case 'carrousel': t.push(...v.titre, v.accent, ...v.etiquettes, ...v.pages.flatMap(p => [p.titre, p.texte])); break;
  }
  return t.filter(Boolean).join('\n');
}

/** Les captures de la bibliothèque (public/l/captures), sans l'extension .png ; seuls les noms sûrs (lettres, chiffres, _ et -). */
export function listeCaptures(): string[] {
  try {
    return readdirSync(join(process.cwd(), DOSSIER_CAPTURES)).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).filter(n => /^[\w-]+$/.test(n)).sort();
  } catch {
    return [];
  }
}

// ---------- Mise en page (charte >_) ----------

const C = {
  fond: '#07070c', carte: '#14141c', bord: '#26263a', texte: '#f4f3fa', doux: '#9a98b0',
  violet: '#8b5cf6', magenta: '#d946ef', bleu: '#3b82f6',
  degrade: 'linear-gradient(90deg, #8b5cf6, #d946ef)',
};
const L = 1080, H = 1350, MARGE = 80, UTILE = L - 2 * MARGE;

/** Largeur estimée d'un texte en « em » (Geist gras), volontairement large : mieux vaut un titre un peu petit qu'un titre coupé. */
function largeurEm(t: string): number {
  let l = 0;
  for (const c of t) {
    if ('WMmw@%'.includes(c)) l += 0.98;
    else if (" '.,:;!|iljIftr()[]".includes(c)) l += 0.36;
    else if (/[A-Z0-9]/.test(c)) l += 0.74;
    else if (/[a-zà-ÿ]/.test(c)) l += 0.6;
    else if (c.codePointAt(0)! > 0x2000) l += 1.1; // émojis, flèches
    else l += 0.66;
  }
  return l;
}

/** Taille de police qui fait tenir la plus longue ligne (sans retour) dans `largeur`, `max` au plus. */
const ajuste = (max: number, lignes: string[], largeur: number) =>
  Math.min(max, Math.floor(largeur / Math.max(...lignes.map(largeurEm), 1)));

/** Pour les textes qui passent à la ligne : un mot trop long est coupé au lieu de sortir de l'image. */
const COUPE: CSSProperties = { wordBreak: 'break-word' };

/** Toujours un flex : Satori l'exige dès qu'un élément a plusieurs enfants. */
const Boite = ({ style, children }: { style?: CSSProperties; children?: ReactNode }) =>
  <div style={{ display: 'flex', ...style }}>{children}</div>;

const Degrade = ({ children, style }: { children: ReactNode; style?: CSSProperties }) =>
  <span style={{ backgroundImage: C.degrade, backgroundClip: 'text', color: 'transparent', ...style }}>{children}</span>;

const Lueur = ({ x, y, c, r = 520 }: { x: number; y: number; c: string; r?: number }) =>
  <Boite style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundImage: `radial-gradient(circle, ${c}33, ${c}00 70%)` }} />;

const Pastille = ({ c, taille }: { c: string; taille: number }) =>
  <Boite style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: c }} />;

function Entete({ rubrique }: { rubrique: string }) {
  return (
    <Boite style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <Boite style={{ alignItems: 'center', gap: 18 }}>
        <Boite style={{ width: 76, height: 76, borderRadius: 18, backgroundColor: '#2a2a31', position: 'relative', alignItems: 'flex-end', padding: '0 0 12px 12px', boxShadow: '0 6px 18px rgba(139,92,246,0.35)' }}>
          <Boite style={{ position: 'absolute', top: 10, right: 10, gap: 5 }}>
            <Pastille c={C.magenta} taille={8} />
            <Pastille c={C.bleu} taille={8} />
          </Boite>
          <Degrade style={{ fontFamily: 'Mono', fontWeight: 700, fontSize: 32, lineHeight: 1 }}>{'>_'}</Degrade>
        </Boite>
        <Boite style={{ flexDirection: 'column' }}>
          <span style={{ fontSize: 30, fontWeight: 700, color: C.texte }}>le patron</span>
          <span style={{ fontSize: 22, color: C.doux }}>Développeur Full Stack · Abidjan</span>
        </Boite>
      </Boite>
      <span style={{ fontFamily: 'Mono', fontSize: 22, color: C.bleu, border: `2px solid ${C.bleu}55`, borderRadius: 999, padding: '8px 20px' }}>{`# ${rubrique}`}</span>
    </Boite>
  );
}

function Pied({ gauche, droite }: { gauche: string; droite: string }) {
  return (
    <Boite style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%', borderTop: `2px solid ${C.bord}`, paddingTop: 28, gap: 40 }}>
      <span style={{ fontFamily: 'Mono', fontSize: 24, color: C.doux }}>{gauche}</span>
      <span style={{ fontFamily: 'Mono', fontSize: 24, color: C.magenta }}>{droite}</span>
    </Boite>
  );
}

function Cadre({ rubrique, pied, children }: { rubrique: string; pied: [string, string]; children: ReactNode }) {
  return (
    <Boite style={{ width: L, height: H, backgroundColor: C.fond, flexDirection: 'column', justifyContent: 'space-between', padding: MARGE, fontFamily: 'Geist', position: 'relative', overflow: 'hidden' }}>
      <Lueur x={980} y={120} c={C.magenta} />
      <Lueur x={80} y={1250} c={C.violet} />
      <Entete rubrique={rubrique} />
      {children}
      <Pied gauche={pied[0]} droite={pied[1]} />
    </Boite>
  );
}

/** Le grand titre : lignes blanches, puis la ligne en dégradé. */
function Titre({ lignes, accent, taille, interligne, espacement }: { lignes: string[]; accent: string; taille: number; interligne: number; espacement: number }) {
  return (
    <Boite style={{ flexDirection: 'column', fontSize: taille, fontWeight: 900, lineHeight: interligne, color: C.texte, letterSpacing: espacement }}>
      {lignes.map((l, i) => <span key={i}>{l}</span>)}
      <Degrade style={{ fontSize: taille }}>{accent}</Degrade>
    </Boite>
  );
}

const numero = (n: number, total: number) => `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

function Carte({ v }: { v: Extract<Visuel, { modele: 'carte' }> }) {
  const taille = ajuste(92, [...v.lignes, v.accent], UTILE);
  return (
    <Cadre rubrique={v.rubrique} pied={v.pied}>
      <Boite style={{ flexDirection: 'column', gap: 36 }}>
        <span style={{ fontFamily: 'Mono', fontSize: 30, color: C.violet }}>{v.surtitre}</span>
        <Titre lignes={v.lignes} accent={v.accent} taille={taille} interligne={1.05} espacement={-2} />
        {v.texte ? <span style={{ fontSize: 36, lineHeight: 1.4, color: C.doux, maxWidth: 860, ...COUPE }}>{v.texte}</span> : null}
      </Boite>
    </Cadre>
  );
}

const COULEURS_ETAPES = [C.violet, C.bleu, C.magenta, C.violet];

function Schema({ v }: { v: Extract<Visuel, { modele: 'schema' }> }) {
  const largeurBoite = 440;
  const tailleEtape = ajuste(36, v.etapes.map(e => e.titre), largeurBoite - 72);
  const hauteurFleche = v.etapes.length > 3 ? 64 : 96;
  return (
    <Cadre rubrique={v.rubrique} pied={v.pied}>
      <Boite style={{ flexDirection: 'column', gap: 18 }}>
        <span style={{ fontSize: 60, fontWeight: 900, color: C.texte, letterSpacing: -1, lineHeight: 1.1, ...COUPE }}>{v.titre}</span>
        <Boite style={{ gap: 40, marginTop: v.etapes.length > 3 ? 16 : 30 }}>
          <Boite style={{ flexDirection: 'column', width: largeurBoite }}>
            {v.etapes.flatMap((e, i) => [
              <Boite key={`e${i}`} style={{ flexDirection: 'column', gap: 8, backgroundColor: C.carte, border: `2px solid ${COULEURS_ETAPES[i]}`, borderRadius: 24, padding: '28px 34px', width: largeurBoite }}>
                <span style={{ fontSize: tailleEtape, fontWeight: 700, color: C.texte }}>{e.titre}</span>
                <span style={{ fontFamily: 'Mono', fontSize: 22, color: C.doux }}>{e.sous}</span>
              </Boite>,
              ...(i < v.liens.length ? [
                <Boite key={`l${i}`} style={{ alignItems: 'center', gap: 16, paddingLeft: 170, height: hauteurFleche }}>
                  <Boite style={{ width: 4, height: hauteurFleche, backgroundImage: 'linear-gradient(180deg, #8b5cf6, #d946ef)' }} />
                  <span style={{ fontFamily: 'Mono', fontSize: 22, color: C.magenta, whiteSpace: 'nowrap' }}>{v.liens[i]}</span>
                </Boite>,
              ] : []),
            ])}
          </Boite>
          {v.encadre ? (
            <Boite style={{ flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
              <Boite style={{ flexDirection: 'column', gap: 10, border: `2px dashed ${C.bord}`, borderRadius: 24, padding: 30 }}>
                <span style={{ fontSize: ajuste(30, [v.encadre.titre], 376), fontWeight: 700, color: C.texte }}>{v.encadre.titre}</span>
                <span style={{ fontSize: 26, color: C.doux, lineHeight: 1.4, ...COUPE }}>{v.encadre.texte}</span>
              </Boite>
            </Boite>
          ) : null}
        </Boite>
      </Boite>
    </Cadre>
  );
}

function Capture({ v, image }: { v: Extract<Visuel, { modele: 'capture' }>; image: string }) {
  const taille = ajuste(70, [...v.lignes, v.accent], UTILE);
  return (
    <Cadre rubrique={v.rubrique} pied={v.pied}>
      <Boite style={{ flexDirection: 'column', gap: 40 }}>
        <Titre lignes={v.lignes} accent={v.accent} taille={taille} interligne={1.08} espacement={-1.5} />
        <Boite style={{ flexDirection: 'column', borderRadius: 26, overflow: 'hidden', border: `2px solid ${C.bord}`, boxShadow: '0 30px 80px rgba(139,92,246,0.35)' }}>
          <Boite style={{ alignItems: 'center', gap: 12, backgroundColor: C.carte, padding: '18px 24px' }}>
            <Pastille c="#ff5f57" taille={18} />
            <Pastille c="#febc2e" taille={18} />
            <Pastille c="#28c840" taille={18} />
            <Boite style={{ marginLeft: 24, flex: 1, backgroundColor: C.fond, borderRadius: 10, padding: '6px 18px', fontFamily: 'Mono', fontSize: 20, color: C.doux }}>{v.barre}</Boite>
          </Boite>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori ne connaît que <img> */}
          <img src={image} alt="" width={916} height={515} style={{ width: 916, height: 515, objectFit: 'cover' }} />
        </Boite>
      </Boite>
    </Cadre>
  );
}

type Carrousel = Extract<Visuel, { modele: 'carrousel' }>;

function Couverture({ v }: { v: Carrousel }) {
  const taille = ajuste(104, [...v.titre, v.accent], UTILE);
  return (
    <Cadre rubrique={v.rubrique} pied={v.pied}>
      <Boite style={{ flexDirection: 'column', gap: 30 }}>
        <span style={{ fontFamily: 'Mono', fontSize: 34, color: C.bleu }}>{numero(1, v.pages.length + 1)}</span>
        <Titre lignes={v.titre} accent={v.accent} taille={taille} interligne={1.0} espacement={-3} />
        {v.etiquettes.length ? (
          <Boite style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            {v.etiquettes.map((t, i) => (
              <span key={i} style={{ fontFamily: 'Mono', fontSize: 24, color: C.texte, backgroundColor: C.carte, border: `2px solid ${C.bord}`, borderRadius: 14, padding: '10px 18px' }}>{t}</span>
            ))}
          </Boite>
        ) : null}
      </Boite>
    </Cadre>
  );
}

/** Une page intérieure du carrousel : même charte, numéro en bleu, titre en gras, texte doux. */
function PageCarrousel({ v, n }: { v: Carrousel; n: number }) {
  const page = v.pages[n - 2];
  const total = v.pages.length + 1;
  return (
    <Cadre rubrique={v.rubrique} pied={[v.pied[0], numero(n, total)]}>
      <Boite style={{ flexDirection: 'column', gap: 36 }}>
        <span style={{ fontFamily: 'Mono', fontSize: 34, color: C.bleu }}>{numero(n, total)}</span>
        <span style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, color: C.texte, letterSpacing: -1.5, ...COUPE }}>{page.titre}</span>
        <Boite style={{ width: 120, height: 6, borderRadius: 3, backgroundImage: C.degrade }} />
        <span style={{ fontSize: 38, lineHeight: 1.45, color: C.doux, ...COUPE }}>{page.texte}</span>
      </Boite>
    </Cadre>
  );
}

// ---------- Rendu ----------

type Police = { name: string; data: Buffer; weight: 400 | 700 | 900; style: 'normal' };
let polices: Promise<Police[]> | undefined;

/** Les polices Geist, lues une seule fois (et relues si la première lecture a échoué). */
function chargerPolices(): Promise<Police[]> {
  polices ??= (async () => {
    const lire = (f: string) => readFile(join(process.cwd(), 'assets/polices', f));
    const [r, b, k, mr, mb] = await Promise.all(['Geist-Regular.ttf', 'Geist-Bold.ttf', 'Geist-Black.ttf', 'GeistMono-Regular.ttf', 'GeistMono-Bold.ttf'].map(lire));
    return [
      { name: 'Geist', data: r, weight: 400, style: 'normal' },
      { name: 'Geist', data: b, weight: 700, style: 'normal' },
      { name: 'Geist', data: k, weight: 900, style: 'normal' },
      { name: 'Mono', data: mr, weight: 400, style: 'normal' },
      { name: 'Mono', data: mb, weight: 700, style: 'normal' },
    ] satisfies Police[];
  })().catch((e: unknown) => { polices = undefined; throw e; });
  return polices;
}

async function png(el: ReactElement): Promise<Uint8Array> {
  const fonts = await chargerPolices();
  return new Uint8Array(await new ImageResponse(el, { width: L, height: H, fonts }).arrayBuffer());
}

async function imageCapture(nom: string): Promise<string> {
  // Le nom est déjà validé contre la bibliothèque ; on refuse quand même tout ce qui ressemble à un chemin.
  if (!/^[\w-]+$/.test(nom)) throw new Refus(`« capture » invalide : ${nom.slice(0, 40)}`);
  const data = await readFile(join(process.cwd(), DOSSIER_CAPTURES, `${nom}.png`));
  return `data:image/png;base64,${data.toString('base64')}`;
}

/** Fabrique l'image du visuel (validé) ; pour un carrousel, aussi le PDF : couverture puis une page par élément. */
export async function rendreVisuel(v: Visuel): Promise<{ png: Uint8Array; pdf?: Uint8Array }> {
  switch (v.modele) {
    case 'carte': return { png: await png(<Carte v={v} />) };
    case 'schema': return { png: await png(<Schema v={v} />) };
    case 'capture': return { png: await png(<Capture v={v} image={await imageCapture(v.capture)} />) };
    case 'carrousel': {
      const images = [await png(<Couverture v={v} />)];
      for (let n = 2; n <= v.pages.length + 1; n++) images.push(await png(<PageCarrousel v={v} n={n} />));
      const doc = await PDFDocument.create();
      for (const image of images) {
        const p = await doc.embedPng(image);
        doc.addPage([L, H]).drawImage(p, { x: 0, y: 0, width: L, height: H });
      }
      return { png: images[0], pdf: await doc.save() };
    }
  }
}
