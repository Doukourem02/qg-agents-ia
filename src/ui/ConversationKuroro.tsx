'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { getEngine, useQG } from '@/store';
import { agentById, poleById } from '@/sim/routing';
import { ECHEC, confirmerChoix, decider } from '@/sim/kuroro';
import { corpsDataUrl, headDataUrl, type Frame } from '@/scene/sprites';
import { envoyerMission } from './useReel';
import { repondreIA, reveillerMac, type Tour } from './kuroro-ia';
import { MAX_TEXTE } from '@/sim/kuroro-ia';

// La barre de mission devient une conversation de bande dessinée avec Kuroro.
// Kuroro converse avec un modèle (src/ui/kuroro-ia.ts) : Claude si la clé existe, sinon le modèle local d'Ollama du Mac,
// par le QG (marche dans Safari et sur le téléphone tant que le Mac est allumé). Il répond aux questions avec les vrais faits
// et ne confie que les vraies missions ; sans modèle, ses règles (src/sim/kuroro.ts).
// × ferme la conversation sans l'oublier (jusqu'au rechargement) ; « Effacer » vide les bulles et coupe l'attente du Mac.
// /demo : jamais Claude, rien n'est déposé (comme avant), seule la simulation s'anime.

export type Message = {
  id: number;
  de: 'moi' | 'kuroro';
  lignes: string[];
  /** Kuroro écrit (« … »). */
  tape?: true;
  /** Le visage de l'agent à qui la mission est confiée. */
  visage?: string;
  /** Kuroro demande à qui confier la mission : les boutons des vrais agents. */
  choix?: { texte: string; ids: string[] };
};

/** Les limites de la route (src/server/kuroro.ts) : 12 tours, 300 caractères chacun. */
const MAX_TOURS = 12;
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_VISIBLES = 5;

/** L'état de la conversation : ouverte ou non, les bulles, l'envoi d'une phrase et le choix d'un agent. */
export function useConversation() {
  const [ouvert, setOuvert] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const session = useRef(0);
  /** Coupe l'attente de la réponse du Mac quand j'efface la conversation. */
  const annule = useRef<AbortController | null>(null);
  const ouvertRef = useRef(false);
  const prochain = useRef(0);
  /** La conversation telle qu'envoyée à Claude (texte seul). */
  const historique = useRef<Tour[]>([]);
  const version = useQG(s => s.version);

  // Kuroro salue à son bureau pendant la conversation (la simulation est recréée à chaque changement de moment)
  useEffect(() => { useQG.setState({ conversation: ouvert }); ouvertRef.current = ouvert; }, [ouvert]);
  useEffect(() => {
    if (!ouvert) return;
    const e = getEngine();
    e.saluer('kuroro');
    // un compte rendu ouvert entre-temps garde son salut
    return () => { if (e.salue('kuroro')) e.saluer(null); };
  }, [ouvert, version]);

  const ajouter = (m: Omit<Message, 'id'>) => {
    const id = prochain.current++;
    setMessages(ms => [...ms, { ...m, id }]);
    return id;
  };
  /** Remplace la bulle « … » par la réponse ; conversation fermée ou effacée entre-temps : un petit message en plus. */
  const dire = (s: number, id: number, m: Omit<Message, 'id'>) => {
    if (session.current !== s || !ouvertRef.current) useQG.getState().showToast(`Kuroro : ${m.lignes[0]}`);
    if (session.current !== s) return;
    setMessages(ms => ms.map(x => (x.id === id ? { ...m, id } : x)));
  };

  /** Ce que Kuroro a dit, pour la conversation envoyée à Claude. */
  const noter = (s: number, lignes: string[]) => { if (session.current === s && lignes.length) historique.current.push({ role: 'kuroro', texte: lignes.join(' ').slice(0, MAX_TEXTE) }); };

  const ouvrir = useCallback(() => {
    setOuvert(true);
    // le Mac se réveille pour répondre vite (jamais en /demo)
    if (!useQG.getState().demo) reveillerMac();
  }, []);
  /** Ferme sans oublier : la conversation revient à la prochaine ouverture (jusqu'au rechargement de la page). */
  const fermer = useCallback(() => setOuvert(false), []);
  /** Vide les bulles et coupe l'attente de la réponse du Mac. */
  const effacer = useCallback(() => {
    session.current++;
    annule.current?.abort();
    annule.current = null;
    historique.current = [];
    setMessages([]);
  }, []);

  /** Kuroro répond par ses règles simples (src/sim/kuroro.ts) : en /demo, ou quand Claude ne répond pas. */
  const parRegles = async (t: string, s: number, id: number) => {
    const { demo, vues } = useQG.getState();
    // les vrais faits de la boîte pour une réponse naturelle (absents en /demo)
    const boite = vues && !demo ? { agents: vues.agents, enAttente: vues.taches.enAttente } : null;
    const d = decider(t, { passages: vues?.agents, demo, boite });
    if (d.type === 'petit') {
      // un mot gentil n'est jamais déposé comme mission
      await attendre(450);
      noter(s, d.lignes);
      dire(s, id, { de: 'kuroro', lignes: d.lignes });
      return;
    }
    if (d.type === 'choix') {
      await attendre(700);
      noter(s, d.lignes);
      dire(s, id, { de: 'kuroro', lignes: d.lignes, choix: { texte: t, ids: d.choix } });
      return;
    }
    // la mission part vraiment au serveur ; Kuroro ne confirme qu'une fois le dépôt réussi
    const [ok] = await Promise.all([deposer(t), attendre(800 + Math.random() * 400)]);
    if (ok) getEngine().mission(t);
    noter(s, ok ? d.lignes : [ECHEC]);
    dire(s, id, ok ? { de: 'kuroro', lignes: d.lignes, visage: d.agent.id } : { de: 'kuroro', lignes: [ECHEC] });
  };

  const envoyer = async (t: string) => {
    const s = session.current;
    ajouter({ de: 'moi', lignes: [t] });
    historique.current.push({ role: 'moi', texte: t.slice(0, MAX_TEXTE) });
    const id = ajouter({ de: 'kuroro', lignes: [], tape: true });
    // /demo : jamais Claude, rien n'est déposé (les règles seulement)
    if (useQG.getState().demo) return parRegles(t, s, id);
    annule.current ??= new AbortController();
    const [r] = await Promise.all([repondreIA(historique.current.slice(-MAX_TOURS), fetch, { signal: annule.current.signal }), attendre(400)]);
    if (session.current === s && !r) return parRegles(t, s, id);
    if (!r) return;
    // Claude ou le Mac : la mission éventuelle a déjà été déposée et confirmée par le serveur ; la simulation la montre
    if (r.mission && session.current === s) getEngine().missionDirecte(r.mission.agent, t);
    noter(s, [r.texte]);
    dire(s, id, { de: 'kuroro', lignes: [r.texte], ...(r.mission ? { visage: r.mission.agent } : {}) });
  };

  const choisir = async (msgId: number, texte: string, agentId: string) => {
    const s = session.current;
    const agent = agentById(agentId)!, pole = poleById(agent.pole)!;
    setMessages(ms => ms.map(x => (x.id === msgId ? { ...x, choix: undefined } : x)));
    ajouter({ de: 'moi', lignes: [agent.nom] });
    const id = ajouter({ de: 'kuroro', lignes: [], tape: true });
    const [ok] = await Promise.all([deposer(texte, agentId), attendre(800 + Math.random() * 400)]);
    if (ok) getEngine().missionDirecte(agentId, texte);
    const { demo, vues } = useQG.getState();
    const lignes = confirmerChoix(agent, pole, { passages: vues?.agents, demo });
    historique.current.push({ role: 'moi', texte: agent.nom });
    noter(s, ok ? lignes : [ECHEC]);
    dire(s, id, ok ? { de: 'kuroro', lignes, visage: agentId } : { de: 'kuroro', lignes: [ECHEC] });
  };

  return { ouvert, messages, ouvrir, fermer, effacer, envoyer, choisir };
}

/** Le même dépôt qu'avant (/api/missions par envoyerMission) ; en /demo, rien ne part. */
async function deposer(texte: string, agent?: string): Promise<boolean> {
  const demo = useQG.getState().demo;
  return demo ? true : (await envoyerMission(texte, agent)) !== null;
}

/** Kuroro en grand, de la tête aux pieds : il salue une fois en arrivant, puis respire doucement. */
function KuroroGrand({ petit }: { petit: boolean }) {
  const reduit = useReducedMotion();
  const [frame, setFrame] = useState<Frame>(reduit ? 'idle' : 'wave0');
  useEffect(() => {
    if (reduit) return;
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (n >= 6) { setFrame('idle'); clearInterval(t); } else setFrame(n % 2 ? 'wave1' : 'wave0');
    }, 260);
    return () => clearInterval(t);
  }, [reduit]);
  const src = useMemo(() => corpsDataUrl('kuroro', frame), [frame]);
  const h = petit ? 84 : 140, w = Math.round(h * 24 / 28);
  return (
    <motion.img
      src={src} alt="Kuroro" width={w} height={h}
      style={{ width: w, height: h, imageRendering: 'pixelated' }}
      animate={reduit ? undefined : { y: [0, -3, 0] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

function Bulle({ m, haut, attenue, choisir }: { m: Message; haut: boolean; attenue: boolean; choisir: (msgId: number, texte: string, agentId: string) => void }) {
  const reduit = useReducedMotion();
  const moi = m.de === 'moi';
  return (
    <motion.div
      layout={reduit ? false : 'position'}
      initial={reduit ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.92 }}
      animate={{ opacity: attenue ? 0.75 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className={`qg-bd pointer-events-auto ${moi ? 'qg-bd-moi self-end px-[8px] py-[4px] text-[9px]' : `${haut ? 'qg-bd-kb' : 'qg-bd-k'} self-start px-[10px] py-[6px] text-[10.5px]`} max-w-[92%]`}
    >
      {m.tape ? (
        <span className="qg-points" aria-label="Kuroro écrit"><i /><i /><i /></span>
      ) : (
        <div className="flex items-start gap-[6px]">
          {m.visage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headDataUrl(m.visage)} alt="" width={16} height={16} className="mt-[1px] flex-none rounded-[3px] bg-[#f1f0f5]" style={{ imageRendering: 'pixelated' }} />
          )}
          <div className={moi ? 'font-medium' : 'font-semibold leading-[1.35]'}>
            {m.lignes.map((l, i) => <p key={i} className={i ? 'mt-[2px] font-normal text-[#4a475c]' : ''}>{l}</p>)}
          </div>
        </div>
      )}
      {m.choix && (
        <div className="mt-[5px] flex flex-wrap gap-[4px]">
          {m.choix.ids.map(id => (
            <button key={id} type="button" onClick={() => choisir(m.id, m.choix!.texte, id)}
              className="flex items-center gap-[4px] rounded-[999px] border-[1.5px] border-[#1d1b2e] bg-white py-[1px] pl-[2px] pr-[7px] text-[9px] font-bold hover:bg-[#f1f0f5]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={headDataUrl(id)} alt="" width={12} height={12} style={{ imageRendering: 'pixelated' }} />
              {agentById(id)?.nom ?? id}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** Au-dessus de la barre : Kuroro en grand et les bulles de la conversation (les 5 dernières). */
export function ConversationKuroro({ conv }: { conv: ReturnType<typeof useConversation> }) {
  const reduit = useReducedMotion();
  const haut = useQG(s => s.format === 'haut');
  const visibles = conv.messages.slice(-MAX_VISIBLES);
  const bulles = (
    <div className={`flex min-w-0 flex-col gap-[7px] ${haut ? 'w-full' : 'flex-1 pb-[22px]'}`}>
      <AnimatePresence initial={false} mode="popLayout">
        {visibles.map((m, i) => <Bulle key={m.id} m={m} haut={haut} attenue={visibles.length === MAX_VISIBLES && i === 0} choisir={conv.choisir} />)}
      </AnimatePresence>
    </div>
  );
  const kuroro = (
    <div className={`pointer-events-auto flex flex-none items-center ${haut ? 'flex-row gap-[6px]' : 'flex-col gap-[2px]'}`}>
      <KuroroGrand petit={haut} />
      <span className={`${haut ? '-ml-[16px]' : ''} whitespace-nowrap rounded-[999px] bg-[#1d1b2e] px-[7px] py-[2px] text-[8px] font-semibold text-white`}>Kuroro t’écoute…</span>
    </div>
  );
  const fermer = () => { conv.fermer(); (document.activeElement as HTMLElement | null)?.blur(); };
  const boutons = (
    <div className={`pointer-events-auto flex items-center gap-[4px] ${haut ? 'self-end' : 'absolute bottom-full right-0 mb-[4px]'}`}>
      {conv.messages.length > 0 && (
        <button type="button" onClick={conv.effacer} title="Vider la conversation"
          className="rounded-[999px] border-[1.5px] border-[#1d1b2e] bg-white px-[7px] py-[1px] text-[8.5px] font-bold hover:bg-[#f1f0f5]">Effacer</button>
      )}
      <button type="button" onClick={fermer} title="Fermer (Échap)" aria-label="Fermer la conversation"
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-[#1d1b2e] bg-white text-[11px] font-bold leading-none hover:bg-[#f1f0f5]">×</button>
    </div>
  );
  return (
    <AnimatePresence>
      {conv.ouvert && (
        <motion.div
          key="conversation"
          onPointerDown={e => e.stopPropagation()} // pas de déplacement du menu en cliquant dans la conversation
          initial={reduit ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduit ? { opacity: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={`pointer-events-none absolute bottom-[calc(100%+6px)] left-0 right-0 flex ${haut ? 'flex-col items-start gap-[8px]' : 'flex-row items-end gap-[8px]'}`}
        >
          {haut ? <>{boutons}{bulles}{kuroro}</> : <>{boutons}{kuroro}{bulles}</>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
