'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BUREAU_PAR_AGENT, getEngine, useQG } from '@/store';
import type { CompteRendu } from '@/server/comptes-rendus';
import { Fermer, Tete } from './Panels';
import { phraseNombre, salutation } from './comptes-rendus-texte';
import { corpsDataUrl } from '@/scene/sprites';

// Le menu d'arrivée : à l'arrivée du patron, chaque agent qui a du nouveau vient faire son compte rendu.
// Page privée (vrais agents), jamais montée dans /demo. Rien de technique à l'écran.
// Fermer le menu enregistre la visite : le prochain menu ne reparle que de ce qui est arrivé depuis.

/** Le personnage entier qui salue de la main (deux images qui alternent). */
function PersonnageQuiSalue({ id }: { id: string }) {
  const [main, setMain] = useState(0);
  useEffect(() => { const t = setInterval(() => setMain(m => 1 - m), 380); return () => clearInterval(t); }, []);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={corpsDataUrl(id, main ? 'wave1' : 'wave0')} alt="" width={72} height={84} className="flex-none rounded-[8px] bg-[#f1f0f5]" style={{ width: 72, height: 84, imageRendering: 'pixelated', objectFit: 'contain' }} />;
}

type Liste = { depuis: number | null; now: number; liste: CompteRendu[] };

async function lire(): Promise<Liste | null> {
  try {
    const r = await fetch('/api/qg/comptes-rendus', { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json() as Liste;
  } catch {
    return null;
  }
}

/** Note la visite jusqu'à l'heure de la liste que le patron a vue (rien d'arrivé depuis n'est perdu), puis relit le nombre. */
async function marquerVu(jusqua: number | null) {
  try {
    const res = await fetch('/api/qg/comptes-rendus', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vu: true, ...(jusqua !== null ? { jusqua } : {}) }),
    });
    if (!res.ok) return false;
    return true;
  } catch {
    return false;
  }
}

export function ComptesRendus() {
  const ouvert = useQG(s => s.arrivee);
  return <AnimatePresence>{ouvert && <Menu key="comptes-rendus" />}</AnimatePresence>;
}

function Menu() {
  const haut = useQG(s => s.format === 'haut');
  const version = useQG(s => s.version);
  const setArrivee = useQG(s => s.setArrivee), setNb = useQG(s => s.setNbComptesRendus);
  const [lu, setLu] = useState<Liste | null>(null);
  const [courant, setCourant] = useState<number | null>(null); // l'indice du compte rendu ouvert
  const [salut] = useState(() => salutation());
  const [vus, setVus] = useState<ReadonlySet<number>>(new Set());
  const nowLu = useRef<number | null>(null);

  useEffect(() => {
    let arret = false;
    void lire().then(l => {
      if (arret) return;
      if (l) { nowLu.current = l.now; setLu(l); setNb(l.liste.length); } else setArrivee(false); // rien de faux : sans réponse, pas de menu
    });
    return () => { arret = true; };
  }, [setArrivee, setNb]);

  // Fermer note la visite (jusqu'à la liste vue), attend la réponse, puis relit le nombre. Sans `marquer`, on ferme sans rien noter.
  const fermer = useCallback((marquer = true) => {
    setArrivee(false);
    if (!marquer) return;
    void (async () => {
      await marquerVu(nowLu.current);
      const l = await lire();
      if (l) setNb(l.liste.length);
    })();
  }, [setArrivee, setNb]);

  // rien de nouveau : une seule ligne douce, qui se ferme seule après 4 s
  const vide = !!lu && lu.liste.length === 0;
  useEffect(() => {
    if (!vide) return;
    const t = setTimeout(() => fermer(true), 4000);
    return () => clearTimeout(t);
  }, [vide, fermer]);

  // l'agent dont le compte rendu est ouvert salue à sa place (la simulation est recréée à chaque changement de moment)
  const agent = lu && courant !== null ? lu.liste[courant]?.agent ?? null : null;
  useEffect(() => {
    getEngine().saluer(agent);
    return () => getEngine().saluer(null);
  }, [agent, version]);

  // ouvrir un compte rendu le compte comme vu
  const voir = (i: number) => { setCourant(i); setVus(v => (v.has(i) ? v : new Set(v).add(i))); };
  if (!lu) return null;
  const tousVus = lu.liste.length > 0 && lu.liste.every((_, i) => vus.has(i));
  const place = haut ? 'left-[8px] right-[8px] top-[96px]' : 'left-[12px] top-[56px] w-[310px]';
  const entree = { initial: { x: -40, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: -40, opacity: 0 }, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } };

  if (vide) {
    return (
      <motion.div {...entree} role="status" className={`qg-panel absolute z-20 px-[12px] py-[8px] text-[10px] font-semibold text-[#6b6880] ${haut ? 'left-[8px] right-[8px] top-[96px]' : 'left-[12px] top-[56px]'}`}>
        Rien de nouveau, tout tourne.
      </motion.div>
    );
  }

  const cr = courant !== null ? lu.liste[courant] : null;
  return (
    <motion.div {...entree} role="dialog" aria-label="Comptes rendus" className={`qg-panel absolute z-20 px-[10px] pb-[9px] pt-[9px] ${place}`}>
      {!cr ? (
        <>
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.3 }} className="flex items-start gap-[6px]">
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-[14px] italic leading-tight">{salut}</h3>
              <p className="mt-[1px] text-[9px] text-[#6b6880]">{phraseNombre(lu.liste.length)}</p>
            </div>
            <Fermer onClick={() => fermer(true)} />
          </motion.div>
          <ul className="mt-[7px] flex flex-col gap-[3px]">
            {lu.liste.map((c, i) => (
              // les annonces arrivent une par une, lentement
              <motion.li key={c.agent} initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 1 + i * 0.6, ease: [0.22, 1, 0.36, 1] }}>
                <button onClick={() => voir(i)} className="flex w-full items-center gap-[7px] rounded-[7px] bg-[#faf9fc] px-[6px] py-[5px] text-left hover:bg-[#f1f0f5]">
                  <Tete id={c.agent} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9.5px] font-bold">{c.nom}</span>
                    <span className="block truncate text-[8.5px] text-[#6b6880]">{c.titre}</span>
                  </span>
                  {c.urgent && <span aria-label="Urgent" title="Urgent" className="text-[10px]">⚠️</span>}
                </button>
              </motion.li>
            ))}
          </ul>
        </>
      ) : (
        <motion.div key={courant} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-[6px]">
            <button onClick={() => setCourant(null)} className="rounded-[6px] px-[6px] py-[4px] text-[10px] font-semibold text-[#6b6880] hover:bg-[#f4f3f8]">← Tous</button>
            <span className="flex-1 text-center text-[9px] font-semibold text-[#6b6880]">{(courant ?? 0) + 1} / {lu.liste.length}</span>
            <Fermer onClick={() => fermer(true)} />
          </div>
          <div className="mt-[6px] flex items-start gap-[10px]">
            <PersonnageQuiSalue id={cr.agent} />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold text-[#6b6880]">{cr.nom}{cr.urgent ? ' ⚠️' : ''}</p>
              <h3 className="text-[12px] font-bold leading-snug">{cr.titre}</h3>
              <div className="mt-[5px] flex flex-col gap-[3px]">
                {cr.phrases.map((p, i) => <p key={i} className="text-[10px] leading-snug">{p}</p>)}
              </div>
            </div>
          </div>
          <div className="mt-[10px] flex items-center gap-[6px]">
            <button disabled={courant === 0} onClick={() => voir((courant ?? 0) - 1)} className="rounded-[7px] bg-[#f1f0f5] px-[10px] py-[6px] text-[11px] font-semibold disabled:opacity-30">← Précédent</button>
            {cr.ouvre && Object.values(BUREAU_PAR_AGENT).includes(cr.ouvre) && (
              <button onClick={() => { useQG.getState().ouvrir({ type: cr.ouvre! }); fermer(tousVus); }} className="rounded-[7px] bg-[#f1f0f5] px-[10px] py-[6px] text-[11px] font-semibold">Son bureau</button>
            )}
            {(courant ?? 0) < lu.liste.length - 1
              ? <button onClick={() => voir((courant ?? 0) + 1)} className="ml-auto rounded-[7px] bg-[#1d1b2e] px-[10px] py-[6px] text-[11px] font-semibold text-white">Suivant →</button>
              : <button onClick={() => fermer(true)} className="ml-auto rounded-[7px] bg-[#1d1b2e] px-[10px] py-[6px] text-[11px] font-semibold text-white">Terminer</button>}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
