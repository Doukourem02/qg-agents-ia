'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueClara } from '@/server/clara/vue';
import { Puce } from './Panels';
import { BureauAgent } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Clara (modèle commun : BureauAgent.tsx). « Son travail » : VIP, bannis, gardés, questions en attente
// et ménage réalisé (page privée, absent de /demo).
// Il lit /api/clara à l'ouverture puis toutes les 20 secondes.

const BLEU = '#4a7bd9';

const jour = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const nombre = (n: number) => n.toLocaleString('fr-FR');

const erreurDe = async (r: Response) => {
  try { return ((await r.json()) as { erreur?: string }).erreur ?? `erreur ${r.status}`; } catch { return `erreur ${r.status}`; }
};

function useVueClara() {
  const [vue, setVue] = useState<VueClara | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  // un seul compteur pour les lectures et les actions : une réponse plus ancienne n'écrase jamais un état plus frais
  const derniere = useRef(derniereSeule());
  const lire = useCallback(async () => {
    const encore = derniere.current.prendre();
    try {
      const r = await fetch('/api/clara', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VueClara;
      if (!encore()) return;
      setVue(v);
      setHorsLigne(false);
    } catch {
      if (encore()) setHorsLigne(true);
    }
  }, []);
  /** Une action : son numéro est pris avant l'envoi ; sa vue ne s'applique que si rien de plus récent n'est parti. */
  const commencer = useCallback(() => {
    const encore = derniere.current.prendre();
    return (v: VueClara) => { if (encore()) { setVue(v); setHorsLigne(false); } };
  }, []);
  useEffect(() => {
    let arret = false;
    const tour = () => { if (!arret) void lire(); };
    tour();
    const t = setInterval(tour, 20_000);
    return () => { arret = true; clearInterval(t); };
  }, [lire]);
  return { vue, horsLigne, commencer };
}

const Rubrique = ({ titre, n, children }: { titre: string; n?: number; children: ReactNode }) => (
  <section className="min-w-0">
    <h4 className="mb-[4px] text-[8.5px] font-bold">{titre}{n !== undefined && <span className="font-normal text-[#6b6880]"> ({n})</span>}</h4>
    {children}
  </section>
);
const Vide = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;
const Ligne = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-[5px] rounded-[6px] bg-[#faf9fc] px-[6px] py-[3px] text-[7.5px] leading-snug">{children}</div>
);

function Vip({ vue, agir }: { vue: VueClara; agir: (corps: Record<string, unknown>) => Promise<boolean> }) {
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    const v = saisie.trim();
    if (!v || envoi) return;
    setEnvoi(true);
    if (await agir({ vip: v, ajout: true })) setSaisie('');
    setEnvoi(false);
  };
  return (
    <Rubrique titre="VIP · jamais touchés" n={vue.vip.length}>
      <div className="max-h-[110px] space-y-[3px] overflow-y-auto pr-[3px]">
        {vue.vip.length ? vue.vip.map(v => (
          <Ligne key={v}>
            <span className="min-w-0 flex-1 truncate" title={v}>{v}</span>
            <button onClick={() => void agir({ vip: v, ajout: false })} aria-label={`Retirer ${v} des VIP`} className="text-[8px] text-[#6b6880] hover:text-[#d23b3b]">✕</button>
          </Ligne>
        )) : <Vide>Aucun VIP pour l’instant.</Vide>}
      </div>
      <form onSubmit={ajouter} className="mt-[5px] flex items-center gap-[4px] rounded-[6px] bg-[#f1f0f5] p-[3px]">
        <input value={saisie} onChange={e => setSaisie(e.target.value)} placeholder="adresse ou @domaine.com" aria-label="Ajouter un VIP" className="min-w-0 flex-1 bg-transparent px-[4px] text-[7.5px] outline-none" />
        <button disabled={envoi} className="rounded-[4px] bg-[#1d1b2e] px-[6px] py-[2px] text-[7px] font-semibold text-white hover:bg-[#35324a] disabled:opacity-50">Ajouter</button>
      </form>
      <h4 className="mb-[3px] mt-[8px] text-[7.5px] font-semibold text-[#6b6880]">Contacts à protéger ? (tes destinataires les plus fréquents)</h4>
      <div className="max-h-[150px] space-y-[2px] overflow-y-auto pr-[3px]">
        {vue.candidatsVip.length ? vue.candidatsVip.map(c => (
          <label key={c.adresse} className="flex cursor-pointer items-center gap-[5px] rounded-[6px] bg-[#faf9fc] px-[6px] py-[3px] text-[7.5px]">
            <input type="checkbox" checked={c.coche} onChange={e => void agir({ vip: c.adresse, ajout: e.target.checked })} />
            <span className="min-w-0 flex-1 truncate" title={c.adresse}>{c.adresse}</span>
          </label>
        )) : <Vide>La liste arrive quand Clara a lu tes mails envoyés.</Vide>}
      </div>
    </Rubrique>
  );
}

function Bannis({ vue, agir }: { vue: VueClara; agir: (corps: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <Rubrique titre="Bannis · à la corbeille" n={vue.bannis.length}>
      <div className="max-h-[150px] space-y-[3px] overflow-y-auto pr-[3px]">
        {vue.bannis.length ? vue.bannis.map(b => (
          <Ligne key={b.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold" title={b.adresse}>{b.adresse}</span>
              <span className="text-[6.5px] text-[#6b6880]">depuis le {jour(b.depuis)} · {nombre(b.deplaces)} mail{b.deplaces > 1 ? 's' : ''} déplacé{b.deplaces > 1 ? 's' : ''}</span>
              {b.desabo && (
                <a href={b.desabo} target="_blank" rel="noopener noreferrer" className="ml-[4px] text-[6.5px] font-semibold text-[#4a7bd9] underline hover:text-[#2f5fb8]">se désabonner</a>
              )}
            </span>
            <button onClick={() => void agir({ debannir: b.id })} className="rounded-[4px] bg-[#1d1b2e] px-[6px] py-[2px] text-[7px] font-semibold text-white hover:bg-[#35324a]">débannir</button>
          </Ligne>
        )) : <Vide>Personne n’est banni.</Vide>}
      </div>
    </Rubrique>
  );
}

function Panneau() {
  const showToast = useQG(s => s.showToast);
  const haut = useQG(s => s.format === 'haut');
  const { vue, horsLigne, commencer } = useVueClara();
  const agir = async (corps: Record<string, unknown>) => {
    const appliquer = commencer();
    try {
      const r = await fetch('/api/clara', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
      if (!r.ok) { showToast(await erreurDe(r)); return false; }
      appliquer(await r.json() as VueClara);
      return true;
    } catch {
      showToast('Pas de connexion au serveur.');
      return false;
    }
  };
  const av = vue?.statsAvancement;
  const gmail = horsLigne ? <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>
    : vue && (
      <span className={`flex items-center gap-[4px] text-[8px] ${vue.connecte ? 'font-semibold text-[#2f9c5a]' : 'text-[#6b6880]'}`}>
        <span className={`h-[5px] w-[5px] rounded-full ${vue.connecte ? 'bg-[#2fbf5b]' : 'bg-[#c9c6d6]'}`} />
        {vue.connecte ? 'Gmail connecté' : 'Gmail non connecté'}
        {av && av.lus > 0 && <span className="font-normal text-[#6b6880]"> · {nombre(av.lus)}{av.total ? ` / ${nombre(av.total)}` : ''} mails analysés</span>}
      </span>
    );
  return (
    <BureauAgent agent="clara" cle="bureau-clara" etat={gmail}>
      {!vue ? <Vide>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Vide> : (
        <div className={`grid gap-[14px] ${haut ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className="min-w-0 space-y-[12px]">
            <Vip vue={vue} agir={agir} />
            <Rubrique titre="Gardés · jamais reproposés" n={vue.gardes.length}>
              {vue.gardes.length
                ? <div className="flex max-h-[70px] flex-wrap gap-[3px] overflow-y-auto">{vue.gardes.map(g => <Puce key={g}>{g}</Puce>)}</div>
                : <Vide>Aucun expéditeur gardé.</Vide>}
            </Rubrique>
          </div>
          <div className="min-w-0 space-y-[12px]">
            <Bannis vue={vue} agir={agir} />
            <Rubrique titre="Questions en attente" n={vue.questions.length}>
              <div className="max-h-[110px] space-y-[3px] overflow-y-auto pr-[3px]">
                {vue.questions.length ? vue.questions.map(q => (
                  <Ligne key={q.id}>
                    <span className="min-w-0 flex-1 truncate" title={q.adresse}>{q.adresse}</span>
                    <Puce c={BLEU} t="#fff">question {q.etape}/2</Puce>
                  </Ligne>
                )) : <Vide>Aucune question en attente sur Telegram.</Vide>}
              </div>
            </Rubrique>
            <Rubrique titre="Ménage réalisé">
              <p className="mb-[4px] text-[8px]"><span className="text-[11px] font-bold">{nombre(vue.nettoye.mails)}</span> mails mis à la corbeille</p>
              <div className="max-h-[110px] space-y-[3px] overflow-y-auto pr-[3px]">
                {vue.nettoye.derniers.map((d, i) => (
                  <Ligne key={i}>
                    <span className="w-[34px] shrink-0 text-[6.5px] text-[#6b6880]">{jour(d.quand)}</span>
                    <span className="min-w-0 flex-1 truncate" title={d.adresse}>{d.adresse}</span>
                    <span className="font-semibold">{nombre(d.n)}</span>
                  </Ligne>
                ))}
              </div>
            </Rubrique>
          </div>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauClara() {
  const ouvert = useQG(s => s.volet?.type === 'bureauClara');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-clara" />}</AnimatePresence>;
}
