'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Lock, Moon, Plus } from 'lucide-react';
import { useQG } from '@/store';
import { POLES, agentById, poleById } from '@/sim/routing';
import type { CerveauAgent, VuesQG } from '@/server/vues';
import { majCerveau } from './OngletsReels';
import { roleCourt } from './organigramme';
import { OMBRE_CARTE, Puce, Tete } from './Panels';
import { BandeauPause, ListeIgnores } from './Silence';

// L'onglet Cerveau : les règles de base (garanties par le code, fixes), mes règles (lues par L, Light, Clara et Mafe
// au début de chaque passage, modifiables ici), et ce que chaque agent a retenu (les leçons de L sont modifiables).
// Les écritures passent par /api/qg/regles et /api/qg/l-regles ; jamais dans /demo (l'onglet n'y existe pas, et tout y
// resterait en lecture seule).

const MAX_TEXTE = 200;
const MAX_REGLES = 30;
const GRIS = '#6b6880', ROUGE = '#d23b3b';

type Reponse<T> = { regles: T };

/** Une écriture de la page ; jamais de détail technique à l'écran. */
async function ecrire<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', corps: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps), cache: 'no-store' });
  } catch {
    throw new Error('Pas de connexion au serveur.');
  }
  if (r.status === 409) throw new Error(`${MAX_REGLES} règles au plus.`);
  if (r.status === 404) throw new Error('Cette règle n’existe plus.');
  if (!r.ok) throw new Error('Pas enregistré, réessaie.');
  return ((await r.json()) as Reponse<T>).regles;
}

/** Apparition douce, l'une après l'autre (rien si l'animation est réduite). */
function useApparition() {
  const reduit = useReducedMotion();
  return (rang: number) => reduit ? {} : {
    initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 },
    transition: { delay: 0.04 + rang * 0.05, duration: 0.3, ease: 'easeOut' as const },
  };
}

/** Une zone de texte qui grandit avec son contenu. */
function ZoneTexte({ valeur, changer, touche, quitter, focus, invite, auto, lignes = 1 }: {
  valeur: string; changer: (v: string) => void; touche: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  quitter?: () => void; focus?: () => void; invite?: string; auto?: boolean; lignes?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [valeur, lignes]);
  useEffect(() => {
    if (auto && ref.current) { const t = ref.current; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }, [auto]);
  return (
    <textarea ref={ref} value={valeur} rows={lignes} maxLength={MAX_TEXTE} placeholder={invite}
      onChange={e => changer(e.target.value.replace(/\n/g, ' '))} onKeyDown={touche} onBlur={quitter} onFocus={focus}
      className="block w-full resize-none overflow-hidden bg-transparent text-[9px] leading-[1.45] text-[#1d1b2e] outline-none placeholder:text-[#9b98ab]" />
  );
}

type Item = { cle: string; texte: string };

/** Une règle modifiable : un clic pour la changer sur place, une croix pour la retirer (avec confirmation). */
function RegleModifiable({ item, modifier, retirer, lecture, petit }: {
  item: Item; modifier: (texte: string) => Promise<void>; retirer: () => Promise<void>; lecture: boolean; petit?: boolean;
}) {
  const [mode, setMode] = useState<'voir' | 'modifier' | 'supprimer'>('voir');
  const [brouillon, setBrouillon] = useState(item.texte);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Entrée puis la perte du focus : une seule écriture
  const enCours = useRef(false);
  const agir = async (f: () => Promise<void>) => {
    if (enCours.current) return;
    enCours.current = true; setOccupe(true); setErreur(null);
    try { await f(); setMode('voir'); } catch (e) { setErreur((e as Error).message); } finally { enCours.current = false; setOccupe(false); }
  };
  const garder = () => {
    const t = brouillon.trim().replace(/\s+/g, ' ');
    if (!t || t === item.texte) { setBrouillon(item.texte); setMode('voir'); return; }
    void agir(() => modifier(t));
  };
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); garder(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBrouillon(item.texte); setMode('voir'); }
  };
  const fond = petit ? 'bg-[#faf9fc]' : `bg-white ${OMBRE_CARTE}`;
  return (
    <div className={`group relative rounded-[9px] border ${mode === 'modifier' ? 'border-[#c9d4fb] ring-[2px] ring-[#e4eaff]' : 'border-[#ecebf2]'} ${fond} ${occupe ? 'opacity-60' : ''} ${petit ? 'px-[8px] py-[5px]' : 'px-[10px] py-[7px]'} transition-[border-color,box-shadow]`}>
      {mode === 'modifier' ? (
        <>
          <ZoneTexte valeur={brouillon} changer={setBrouillon} touche={touche} quitter={garder} auto />
          <div className="mt-[3px] flex justify-between text-[6.5px] text-[#9b98ab]">
            <span>Entrée pour garder · Échap pour annuler</span><span>{brouillon.length}/{MAX_TEXTE}</span>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-[6px]">
          {lecture ? <p className={`min-w-0 flex-1 ${petit ? 'text-[8.5px]' : 'text-[9px]'} leading-[1.45]`}>{item.texte}</p> : (
            <button onClick={() => { setBrouillon(item.texte); setMode('modifier'); }} title="Modifier"
              className={`min-w-0 flex-1 cursor-text text-left ${petit ? 'text-[8.5px]' : 'text-[9px]'} leading-[1.45] ${mode === 'supprimer' ? 'text-[#9b98ab] line-through decoration-[#d23b3b]/50' : ''}`}>
              {item.texte}
            </button>
          )}
          {!lecture && mode === 'voir' && (
            <button onClick={() => setMode('supprimer')} aria-label="Supprimer"
              className="-mr-[2px] -mt-[1px] flex h-[14px] w-[14px] flex-none items-center justify-center rounded-full text-[11px] leading-none text-[#b4b1c3] opacity-60 transition hover:bg-[#fbe1e1] hover:text-[#d23b3b] group-hover:opacity-100">
              ×
            </button>
          )}
        </div>
      )}
      {mode === 'supprimer' && (
        <div className="mt-[4px] flex items-center gap-[6px] text-[7.5px]">
          <span className="font-semibold text-[#d23b3b]">Supprimer ?</span>
          <button onClick={() => void agir(retirer)} disabled={occupe} className="rounded-[5px] bg-[#d23b3b] px-[7px] py-[1.5px] font-semibold text-white hover:bg-[#b93030]">Oui</button>
          <button onClick={() => setMode('voir')} className="rounded-[5px] bg-[#f1f0f5] px-[7px] py-[1.5px] font-semibold text-[#6b6880] hover:bg-[#e6e4ee]">Non</button>
        </div>
      )}
      {erreur && <p className="mt-[3px] text-[7px] font-semibold" style={{ color: ROUGE }}>{erreur}</p>}
    </div>
  );
}

/** « + Ajouter une règle » : une ligne qui s'ouvre au clic. */
function Ajout({ ajouter, plein, invite, petit }: { ajouter: (texte: string) => Promise<void>; plein: boolean; invite: string; petit?: boolean }) {
  const [texte, setTexte] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  if (plein) return <p className="px-[2px] text-[7.5px] text-[#9b98ab]">{MAX_REGLES} règles au plus : retire-en une pour en ajouter.</p>;
  const envoyer = async () => {
    const t = texte.trim().replace(/\s+/g, ' ');
    if (!t || occupe) return;
    setOccupe(true); setErreur(null);
    try { await ajouter(t); setTexte(''); } catch (e) { setErreur((e as Error).message); } finally { setOccupe(false); }
  };
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void envoyer(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTexte(''); (e.target as HTMLTextAreaElement).blur(); }
  };
  return (
    <div className={`rounded-[9px] border border-dashed transition-colors ${ouvert ? 'border-[#c9d4fb] bg-white' : 'border-[#d4d1e2] bg-[#fcfcfe] hover:border-[#bdbacd]'} ${petit ? 'px-[8px] py-[5px]' : 'px-[10px] py-[7px]'} ${occupe ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-[5px]">
        {!ouvert && !texte && <Plus size={10} strokeWidth={2.5} className="mt-[2px] flex-none text-[#9b98ab]" />}
        <ZoneTexte valeur={texte} changer={setTexte} touche={touche} invite={invite} lignes={ouvert ? 2 : 1}
          focus={() => setOuvert(true)} quitter={() => { if (!texte.trim()) setOuvert(false); }} />
      </div>
      {ouvert && (
        <div className="mt-[4px] flex items-center justify-between gap-[6px]">
          <span className="text-[6.5px] text-[#9b98ab]">Entrée pour ajouter · {texte.length}/{MAX_TEXTE}</span>
          <button onMouseDown={e => e.preventDefault()} onClick={() => void envoyer()} disabled={!texte.trim() || occupe}
            className="rounded-[6px] bg-[#1d1b2e] px-[8px] py-[2px] text-[7.5px] font-semibold text-white transition hover:bg-[#34314d] disabled:bg-[#c9c6d6]">
            Ajouter
          </button>
        </div>
      )}
      {erreur && <p className="mt-[3px] text-[7px] font-semibold" style={{ color: ROUGE }}>{erreur}</p>}
    </div>
  );
}

/** Une liste de règles modifiables, avec son ajout en bas. */
function ListeModifiable({ items, ajouter, modifier, retirer, lecture, invite, max, vide, petit }: {
  items: Item[]; ajouter: (t: string) => Promise<void>; modifier: (cle: string, t: string) => Promise<void>; retirer: (cle: string) => Promise<void>;
  lecture: boolean; invite: string; max: number; vide: ReactNode; petit?: boolean;
}) {
  const reduit = useReducedMotion();
  const anim = reduit ? {} : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, height: 0, marginTop: 0 }, transition: { duration: 0.2 } };
  return (
    <div className={petit ? 'space-y-[4px]' : 'space-y-[6px]'}>
      {!items.length && lecture && vide}
      <AnimatePresence initial={false}>
        {items.map(it => (
          <motion.div key={it.cle} {...anim}>
            <RegleModifiable item={it} lecture={lecture} petit={petit} modifier={t => modifier(it.cle, t)} retirer={() => retirer(it.cle)} />
          </motion.div>
        ))}
      </AnimatePresence>
      {!items.length && !lecture && vide}
      {!lecture && <Ajout ajouter={ajouter} plein={items.length >= max} invite={invite} petit={petit} />}
    </div>
  );
}

function Titre({ children, sous, droite }: { children: ReactNode; sous?: ReactNode; droite?: ReactNode }) {
  return (
    <div className="mb-[8px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <h3 className="text-[10.5px] font-bold tracking-[-0.01em]">{children}</h3>
        {droite}
      </div>
      {sous && <p className="mt-[1px] text-[7.5px] leading-snug text-[#6b6880]">{sous}</p>}
    </div>
  );
}

/** Une règle de base : une pastille avec un cadenas ; au survol, « garantie par le code ». */
function RegleBase({ texte }: { texte: string }) {
  return (
    <li className="group relative" tabIndex={0} aria-label={`${texte} (garantie par le code)`}>
      <span className="flex items-start gap-[5px] rounded-[8px] bg-[#f4f3f8] px-[8px] py-[4.5px] text-[8.5px] leading-[1.4] text-[#3a3750]">
        <Lock size={8.5} strokeWidth={2.4} className="mt-[2px] flex-none text-[#8a879c]" aria-hidden />
        <span>{texte}</span>
      </span>
      <span role="tooltip" className="pointer-events-none absolute left-[8px] top-full z-10 mt-[3px] whitespace-nowrap rounded-[5px] bg-[#1d1b2e] px-[6px] py-[2px] text-[7px] font-semibold text-white opacity-0 shadow-[0_2px_8px_rgba(0,0,0,.18)] transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
        garantie par le code
      </span>
    </li>
  );
}

/** La couleur d'un agent : celle du pôle qu'il dirige, sinon de son pôle. */
function couleurDe(id: string) {
  const a = agentById(id);
  const dirige = POLES.find(p => p.chef === id && p.id !== 'direction');
  return dirige?.couleur ?? poleById(a?.pole ?? '')?.couleur ?? GRIS;
}

/** La carte d'un agent : visage, nom, ce qu'il sait (des faits), le lien vers son bureau. */
function CarteCerveau({ a, rang, lecons, lecture }: { a: CerveauAgent; rang: number; lecons?: string[]; lecture: boolean }) {
  const ouvrir = useQG(s => s.ouvrir);
  const apparait = useApparition();
  const agent = agentById(a.agent);
  const couleur = couleurDe(a.agent);
  const ecrireL = async (method: 'POST' | 'PATCH' | 'DELETE', corps: Record<string, unknown>) => {
    majCerveau({ lecons: await ecrire<string[]>('/api/qg/l-regles', method, corps) });
  };
  return (
    <motion.article {...apparait(rang)}
      className={`relative overflow-hidden rounded-[12px] border border-[#ecebf2] bg-white px-[12px] pb-[10px] pt-[11px] ${OMBRE_CARTE}`}>
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: couleur }} />
      <header className="mb-[6px] flex items-center gap-[8px]">
        <Tete id={a.agent} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[5px]">
            <b className="text-[11px] leading-tight">{a.nom}</b>
            {a.nouveau && <Puce c="#2fbf5b" t="#fff">nouveau</Puce>}
          </div>
          {agent && <span className="block truncate text-[7.5px] text-[#6b6880]">{roleCourt(agent.role)}</span>}
        </div>
        <button onClick={() => ouvrir({ type: a.ouvre })} className="flex-none self-start text-[7.5px] font-semibold text-[#4a6bd9] hover:underline">son bureau →</button>
      </header>
      <ul className="space-y-[2px]">
        {a.phrases.map((f, i) => (
          <li key={i} className="flex items-start gap-[6px] text-[8.5px] leading-[1.45] text-[#3a3750]">
            <span className="mt-[5px] h-[3.5px] w-[3.5px] flex-none rounded-full" style={{ background: couleur }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {lecons && (
        <div className="mt-[8px] border-t border-[#f1f0f5] pt-[7px]">
          <p className="mb-[4px] text-[7.5px] font-semibold uppercase tracking-[0.06em] text-[#8a879c]">Ce qu’il a retenu</p>
          <ListeModifiable petit lecture={lecture} max={100}
            items={lecons.map(t => ({ cle: t, texte: t }))}
            invite="Ajouter une leçon pour L"
            vide={<p className="text-[8px] text-[#9b98ab]">Rien encore : L retient tes préférences d’écriture au fil des posts.</p>}
            ajouter={t => ecrireL('POST', { regle: t })}
            modifier={(ancienne, t) => ecrireL('PATCH', { ancienne, regle: t })}
            retirer={t => ecrireL('DELETE', { regle: t })} />
        </div>
      )}
      {a.agent === 'clara' && (
        <button onClick={() => ouvrir({ type: 'bureauClara' })}
          className="mt-[8px] rounded-[7px] border border-[#ecebf2] bg-[#faf9fc] px-[9px] py-[3px] text-[8px] font-semibold text-[#1d1b2e] transition hover:border-[#d4d1e2] hover:bg-[#f1f0f5]">
          Gérer VIP et bannis
        </button>
      )}
    </motion.article>
  );
}

export function Cerveau() {
  const vues = useQG(s => s.vues);
  const horsLigne = useQG(s => s.vuesHorsLigne);
  const haut = useQG(s => s.format === 'haut');
  // /demo n'a pas cet onglet ; s'il s'y montrait, rien n'y serait modifiable
  const lecture = useQG(s => s.demo);
  const apparait = useApparition();
  if (!vues) return <p className="text-[8px] text-[#6b6880]">{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</p>;
  const c: VuesQG['cerveau'] = vues.cerveau;
  const ecrireMes = async (method: 'POST' | 'PATCH' | 'DELETE', corps: Record<string, unknown>) => {
    majCerveau({ mesRegles: await ecrire<VuesQG['cerveau']['mesRegles']>('/api/qg/regles', method, corps) });
  };
  const colonne = haut ? '' : 'min-h-0 overflow-y-auto pb-[6px] pr-[6px]';
  return (
    <div className={haut ? 'space-y-[18px]' : 'grid h-full grid-cols-[1fr_1fr] gap-[22px]'}>
      <div className={`${colonne} space-y-[18px]`}>
        <motion.section {...apparait(0)}>
          <Titre sous="Garanties par le code : elles ne se changent pas ici.">Règles de base</Titre>
          <ul className="flex flex-wrap gap-[5px]">
            {c.regles.map(r => <RegleBase key={r} texte={r} />)}
          </ul>
          <p className="mt-[8px] flex items-center gap-[6px] rounded-[8px] bg-[#eef0fa] px-[8px] py-[5px] text-[8.5px] text-[#2d3a66]">
            <Moon size={9} strokeWidth={2.4} className="flex-none text-[#5566a8]" aria-hidden />
            {c.nuit}
          </p>
          {vues.silence && (vues.silence.pause || vues.silence.ignores.length > 0) && (
            <div className="mt-[6px] space-y-[4px]">
              <BandeauPause silence={vues.silence} now={vues.maintenant} />
              {vues.silence.ignores.length > 0 && (<>
                <p className="text-[8px] text-[#6b6880]">Ce que tu m’as dit d’ignorer (revient tout seul si l’état change vraiment) :</p>
                <ListeIgnores ignores={vues.silence.ignores} now={vues.maintenant} />
              </>)}
            </div>
          )}
        </motion.section>
        <motion.section {...apparait(1)}>
          <Titre sous="Lues par L, Light, Clara et Mafe à chaque passage."
            droite={<span className="text-[7.5px] text-[#9b98ab]">{c.mesRegles.length}/{MAX_REGLES}</span>}>
            Mes règles
          </Titre>
          <ListeModifiable lecture={lecture} max={MAX_REGLES}
            items={c.mesRegles.map(r => ({ cle: r.id, texte: r.texte }))}
            invite="Ajouter une règle"
            vide={<p className="rounded-[9px] bg-[#faf9fc] px-[10px] py-[8px] text-[8.5px] leading-snug text-[#8a879c]">Aucune règle pour l’instant. Écris ce que tes agents doivent toujours respecter, par exemple « Jamais de message le dimanche ».</p>}
            ajouter={t => ecrireMes('POST', { texte: t })}
            modifier={(id, t) => ecrireMes('PATCH', { id, texte: t })}
            retirer={id => ecrireMes('DELETE', { id })} />
        </motion.section>
      </div>
      <section className={colonne}>
        <motion.div {...apparait(0.5)}>
          <Titre sous="Ce qu’ils savent de toi et de ton travail. Le détail est dans leur bureau.">Ce que chaque agent a retenu</Titre>
        </motion.div>
        <div className="space-y-[9px]">
          {c.agents.map((a, i) => (
            <CarteCerveau key={a.agent} a={a} rang={1 + i} lecture={lecture} lecons={a.agent === 'L' ? c.lecons : undefined} />
          ))}
        </div>
      </section>
    </div>
  );
}
