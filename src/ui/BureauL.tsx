'use client';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueL } from '@/server/l/vue';
import { Puce, Titre } from './Panels';
import { BureauAgent } from './BureauAgent';

// Le bureau de L (modèle commun : BureauAgent.tsx). « Son travail » : ses trois sujets de la semaine, ses posts
// et le bilan de ses statistiques LinkedIn ; il lit /api/l à l'ouverture puis toutes les 20 secondes.

type Post = VueL['posts'][number];

const ORANGE = '#e0753f'; // la couleur du pôle Communication

const FORMATS: Record<string, string> = { texte: 'texte', carte: 'carte', schema: 'schéma', capture: 'capture', carrousel: 'carrousel' };

const STATUTS: Record<Post['statut'], { nom: string; c: string; t: string }> = {
  brouillon: { nom: 'brouillon', c: '#f1f0f5', t: '#6b6880' },
  'en accord': { nom: 'en accord', c: '#e0a42a', t: '#fff' },
  pret: { nom: 'prêt', c: '#4a7bd9', t: '#fff' },
  publie: { nom: 'publié', c: '#2fbf5b', t: '#fff' },
  abandonne: { nom: 'abandonné', c: '#f1f0f5', t: '#6b6880' },
};

const jour = (ms: number, mois: 'short' | 'long' = 'short') => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: mois });

const erreurDe = async (r: Response) => {
  try { return ((await r.json()) as { erreur?: string }).erreur ?? `erreur ${r.status}`; } catch { return `erreur ${r.status}`; }
};

/**
 * La vue de L, relue toutes les 20 secondes tant que le panneau est ouvert.
 * Le panneau est remonté à chaque ouverture : la vue et l'état « hors ligne » repartent de zéro.
 */
function useVueL() {
  const [vue, setVue] = useState<VueL | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  // numéro de la dernière lecture : une réponse plus ancienne n'écrase jamais un état plus frais
  const derniere = useRef(0);
  const lire = useCallback(async () => {
    const n = ++derniere.current;
    try {
      const r = await fetch('/api/l', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VueL;
      if (n !== derniere.current) return;
      setVue(v);
      setHorsLigne(false);
    } catch {
      if (n === derniere.current) setHorsLigne(true);
    }
  }, []);
  /** Applique tout de suite la proposition renvoyée par le serveur ; les lectures en cours sont périmées. */
  const appliquerProposition = useCallback((p: NonNullable<VueL['proposition']>) => {
    derniere.current++;
    setVue(v => (v ? { ...v, proposition: p } : v));
  }, []);
  useEffect(() => {
    let arret = false;
    const tour = () => { if (!arret) void lire(); };
    tour();
    const t = setInterval(tour, 20_000);
    return () => { arret = true; clearInterval(t); };
  }, [lire]);
  return { vue, horsLigne, relire: lire, appliquerProposition };
}

function LigneLinkedIn({ vue, horsLigne }: { vue: VueL | null; horsLigne: boolean }) {
  if (horsLigne) return <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>;
  if (!vue) return null;
  const { connecte, expire } = vue.linkedin;
  if (connecte) {
    return (
      <span className="flex items-center gap-[4px] text-[8px] font-semibold text-[#2f9c5a]">
        <span className="h-[5px] w-[5px] rounded-full bg-[#2fbf5b]" />
        {expire ? `LinkedIn connecté · jusqu'au ${jour(expire, 'long')}` : 'LinkedIn connecté'}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[4px] text-[8px] text-[#6b6880]">
      <span className="h-[5px] w-[5px] rounded-full bg-[#c9c6d6]" />
      LinkedIn non connecté · <a href="https://mon-qg.vercel.app/api/linkedin/connexion" target="_blank" rel="noreferrer" className="font-semibold text-[#1d1b2e] underline">se connecter</a>
    </span>
  );
}

function Sujets({ vue, appliquer }: { vue: VueL; appliquer: (p: NonNullable<VueL['proposition']>) => void }) {
  const showToast = useQG(s => s.showToast);
  const [envoi, setEnvoi] = useState(false);
  const p = vue.proposition;
  if (!p) return <p className="text-[8px] leading-snug text-[#6b6880]">Les sujets arrivent le lundi matin.</p>;
  const choisir = async (index: number) => {
    if (envoi) return;
    setEnvoi(true);
    try {
      const r = await fetch('/api/l/sujet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propositionId: p.id, index }) });
      if (!r.ok) { showToast(await erreurDe(r)); return; }
      const { proposition } = await r.json() as { proposition: { id: string; semaine: string; sujets: { titre: string; angle: string; format: string }[]; choix?: number } };
      const choix = proposition.choix ?? index;
      const titre = proposition.sujets[choix]?.titre ?? p.sujets[index].titre;
      showToast(choix !== index ? `Déjà choisi sur Telegram : « ${titre} »` : `Noté : L rédige « ${titre} »`);
      appliquer({
        id: proposition.id, semaine: proposition.semaine, choix, rediges: p.rediges,
        sujets: proposition.sujets.map(s => ({ titre: s.titre, angle: s.angle, format: s.format })),
      });
    } catch {
      showToast('Pas de connexion au serveur.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="space-y-[5px]">
      {p.sujets.map((s, i) => (
        <div key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[5px]" style={i === p.choix ? { boxShadow: `inset 2.5px 0 0 ${ORANGE}` } : undefined}>
          <div className="text-[8.5px] font-bold leading-tight">{s.titre}</div>
          <p className="mt-[2px] text-[7.5px] leading-snug text-[#6b6880]">{s.angle}</p>
          <div className="mt-[4px] flex flex-wrap items-center gap-[3px]">
            <Puce>{FORMATS[s.format] ?? s.format}</Puce>
            {i === p.choix && <Puce c={ORANGE} t="#fff">choisi</Puce>}
            {p.rediges.includes(i) && <Puce c="#2fbf5b" t="#fff">rédigé</Puce>}
            {p.choix === undefined && (
              <button onClick={() => choisir(i)} disabled={envoi} className="ml-auto rounded-[4px] bg-[#1d1b2e] px-[6px] py-[2px] text-[7px] font-semibold text-white hover:bg-[#35324a] disabled:opacity-50">
                Choisir
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PostLigne({ post }: { post: Post }) {
  const [ouvert, setOuvert] = useState(false);
  const [image, setImage] = useState(true);
  const st = STATUTS[post.statut];
  return (
    <div className="rounded-[6px] bg-[#faf9fc]">
      <button onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} className="flex w-full items-start gap-[5px] rounded-[6px] px-[6px] py-[5px] text-left hover:bg-[#f4f3f8]">
        <span className="min-w-0 flex-1">
          <span className="block text-[6.5px] text-[#6b6880]">{jour(post.quand)}</span>
          <span className="block text-[8px] font-semibold leading-tight">{post.sujet}</span>
        </span>
        <Puce c={st.c} t={st.t}>{st.nom}</Puce>
      </button>
      {ouvert && (
        <div className="px-[6px] pb-[6px]">
          <p className="whitespace-pre-line break-words text-[7.5px] leading-snug">{post.texte}</p>
          {post.hashtags.length > 0 && <p className="mt-[3px] break-words text-[7px] font-semibold text-[#4a7bd9]">{post.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
          {post.aVisuel && image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/l/visuel/${encodeURIComponent(post.id)}?v=${post.quand}`} alt={`Visuel du post « ${post.sujet} »`} onError={() => setImage(false)} className="mt-[5px] w-full rounded-[5px] border border-[#ecebf2]" />
          )}
          {post.statut === 'publie' && post.url && (
            <a href={post.url} target="_blank" rel="noreferrer" className="mt-[4px] inline-block text-[7.5px] font-semibold text-[#1d1b2e] underline">voir sur LinkedIn</a>
          )}
        </div>
      )}
    </div>
  );
}

function Liste({ titre, elements }: { titre: string; elements: string[] }) {
  if (!elements.length) return null;
  return (<>
    <Titre><span className="uppercase">{titre}</span></Titre>
    <ul className="space-y-[3px]">
      {elements.map((e, i) => <li key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[3px] text-[7.5px] leading-snug">{e}</li>)}
    </ul>
  </>);
}

function Bilan({ vue, relire }: { vue: VueL; relire: () => Promise<void> }) {
  const showToast = useQG(s => s.showToast);
  const champ = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState(false);
  const b = vue.bilan;
  const deposer = async (e: ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setEnvoi(true);
    try {
      const form = new FormData();
      form.append('fichier', fichier);
      const r = await fetch('/api/l/stats', { method: 'POST', body: form });
      if (r.status === 413) { showToast('Fichier trop lourd (4 Mo au plus)'); return; }
      if (!r.ok) { showToast(`Statistiques refusées : ${await erreurDe(r)}`); return; }
      showToast('Statistiques reçues · L prépare le bilan dans l’heure');
      await relire();
    } catch {
      showToast('Pas de connexion au serveur.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div>
      {b ? (<>
        <div className="grid grid-cols-2 gap-[4px]">
          {b.chiffres.map((c, i) => (
            <div key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[4px]">
              <div className="truncate text-[6.5px] text-[#6b6880]" title={c.nom}>{c.nom}</div>
              <div className="text-[11px] font-bold leading-tight">{c.valeur}</div>
              {c.evolution && <div className={`truncate text-[6.5px] font-semibold ${c.evolution.trim().startsWith('-') || c.evolution.trim().startsWith('−') ? 'text-[#d23b3b]' : 'text-[#2f9c5a]'}`}>{c.evolution}</div>}
            </div>
          ))}
        </div>
        <p className="mt-[6px] font-serif text-[8.5px] italic leading-snug">{b.resume}</p>
        <Liste titre="Ce qui a marché" elements={b.marche} />
        <Liste titre="Qui me lit" elements={b.lecteurs} />
        <Liste titre="Ce que L ajuste" elements={b.ajustements} />
      </>) : (
        <p className="text-[8px] leading-snug text-[#6b6880]">{"Dépose l'export de tes statistiques LinkedIn (Statistiques → Exporter) pour le premier bilan."}</p>
      )}
      <input ref={champ} type="file" accept=".xlsx,.csv" onChange={deposer} className="hidden" aria-label="Fichier de statistiques" />
      <button onClick={() => champ.current?.click()} disabled={envoi} className="mt-[8px] w-full rounded-[6px] bg-[#1d1b2e] px-[6px] py-[4px] text-[8px] font-semibold text-white hover:bg-[#35324a] disabled:opacity-50">
        Déposer mes statistiques
      </button>
      {vue.statsEnAttente > 0 && (
        <p className="mt-[4px] text-center text-[7px] text-[#6b6880]">{vue.statsEnAttente} fichier(s) en attente de bilan</p>
      )}
    </div>
  );
}

function Panneau() {
  const haut = useQG(s => s.format === 'haut');
  const { vue, horsLigne, relire, appliquerProposition } = useVueL();
  return (
    <BureauAgent agent="L" cle="bureau-l" etat={<LigneLinkedIn vue={vue} horsLigne={horsLigne} />}>
      {!vue ? <p className="text-[8px] text-[#6b6880]">{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</p> : (
        <div className={`grid gap-[14px] ${haut ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <section className="min-w-0">
            <h4 className="mb-[4px] text-[8.5px] font-bold">Sujets de la semaine {vue.proposition && <span className="font-normal text-[#6b6880]">· {vue.proposition.semaine}</span>}</h4>
            <Sujets vue={vue} appliquer={appliquerProposition} />
          </section>
          <section className="min-w-0">
            <h4 className="mb-[4px] text-[8.5px] font-bold">Posts <span className="text-[#6b6880]">({vue.posts.length})</span></h4>
            {vue.posts.length
              ? <div className="space-y-[4px]">{vue.posts.map(p => <PostLigne key={p.id} post={p} />)}</div>
              : <p className="text-[8px] leading-snug text-[#6b6880]">Aucun post pour l’instant.</p>}
          </section>
          <section className="min-w-0">
            <h4 className="mb-[4px] text-[8.5px] font-bold">Bilan {vue.bilan && <span className="font-normal text-[#6b6880]">· {vue.bilan.semaine}</span>}</h4>
            <Bilan vue={vue} relire={relire} />
          </section>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauL() {
  const ouvert = useQG(s => s.volet?.type === 'bureauL');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-l" />}</AnimatePresence>;
}
