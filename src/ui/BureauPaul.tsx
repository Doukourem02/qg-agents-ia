'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { LigneDiff } from '@/server/paul/types';
import { lignePassage, NOM_STATUT, nomCourt, type PropositionVue, type VuePaul } from '@/server/paul/etiquette';
import { BureauAgent, Section } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Paul (modèle commun : BureauAgent.tsx). « Son travail » : ses propositions pour les README et le bloc
// « Où on s'est arrêté » des CLAUDE.md, avec ce qui change ligne par ligne, et les boutons Valider / Refuser (comme sur
// Telegram) ; puis ce que le QG a refusé, et ce qui a été écrit (lien vers le commit). Page privée (vrais noms de
// projets), absent de /demo. Le client n'importe que `etiquette.ts` et des types (aucun code serveur).
// Il lit /api/paul à l'ouverture puis toutes les 60 secondes ; un bouton fait un POST { valider | refuser: id }.

const ROUGE = '#d23b3b';
const VERT = '#2f9c5a';
const jourHeure = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

function useVuePaul() {
  const [vue, setVue] = useState<VuePaul | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [derniere] = useState(() => derniereSeule());
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/paul', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VuePaul;
        if (arret || !encore()) return;
        setVue(v);
        setHorsLigne(false);
      } catch {
        if (!arret && encore()) setHorsLigne(true);
      }
    };
    void lire();
    const t = setInterval(() => { void lire(); }, 60_000);
    return () => { arret = true; clearInterval(t); };
  }, [derniere]);
  return { vue, setVue, horsLigne, derniere };
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;

/** Ce qui change, en clair : lignes ajoutées en vert, retirées en rouge, « … » pour les lignes gardées. */
function Changements({ lignes }: { lignes: LigneDiff[] }) {
  return (
    <pre className="mt-[3px] max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-white px-[6px] py-[4px] font-mono text-[7.5px] leading-snug">
      {lignes.map((l, i) => (
        <div key={i} style={{ color: l.sorte === '+' ? VERT : l.sorte === '-' ? ROUGE : '#6b6880', background: l.sorte === '+' ? '#eef8f1' : l.sorte === '-' ? '#fdecec' : undefined }}>
          {l.sorte === '…' ? (l.texte ? `… ${l.texte}` : '…') : `${l.sorte} ${l.texte}`}
        </div>
      ))}
    </pre>
  );
}

function CarteProposition({ p, decider, enCours }: { p: PropositionVue; decider: (id: string, valider: boolean) => void; enCours: boolean }) {
  const quoi = p.fichier === 'CLAUDE.md' ? 'CLAUDE.md · « Où on s’est arrêté »' : p.base === null ? 'README.md (nouveau)' : 'README.md';
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ boxShadow: 'inset 2.5px 0 0 #7c5a3c' }}>
      <div className="flex items-baseline gap-[6px]">
        <span className="min-w-0 flex-1 truncate"><b>{nomCourt(p.depot)}</b> · {quoi}</span>
        <span className="shrink-0 text-[8px] tabular-nums"><span style={{ color: VERT }}>+{p.ajoutees}</span> <span style={{ color: ROUGE }}>−{p.retirees}</span></span>
        <button onClick={() => decider(p.id, true)} disabled={enCours}
          className="shrink-0 rounded-[6px] bg-[#1d1b2e] px-[8px] py-[2px] text-[8px] font-semibold text-white disabled:opacity-50">Valider</button>
        <button onClick={() => decider(p.id, false)} disabled={enCours}
          className="shrink-0 rounded-[6px] bg-[#f1f0f5] px-[8px] py-[2px] text-[8px] font-semibold text-[#2a2740] disabled:opacity-50">Refuser</button>
      </div>
      <ul className="mt-[3px] space-y-[1px]">
        {p.raisons.map((r, i) => <li key={i}>• {r.texte} <code className="text-[#6b6880]">{r.source}</code></li>)}
      </ul>
      {p.bloc !== undefined && (
        <>
          <div className="mt-[3px] text-[7.5px] font-semibold text-[#6b6880]">Le bloc tel qu’il sera écrit (le reste de CLAUDE.md ne change pas) :</div>
          <pre className="mt-[2px] whitespace-pre-wrap break-words rounded-[4px] bg-white px-[6px] py-[4px] font-mono text-[7.5px] leading-snug">{p.bloc}</pre>
        </>
      )}
      <Changements lignes={p.diff} />
      <div className="mt-[2px] text-[7.5px] text-[#6b6880]">Proposé le {jourHeure(p.quand)} · expire au bout de 8 jours sans réponse</div>
    </div>
  );
}

function Panneau() {
  const { vue, setVue, horsLigne, derniere } = useVuePaul();
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);

  const decider = async (id: string, valider: boolean) => {
    setEnCours(true);
    setMessage(null);
    const encore = derniere.prendre();
    try {
      const r = await fetch('/api/paul', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(valider ? { valider: id } : { refuser: id }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as { message: string; vue: VuePaul };
      setMessage({ texte: j.message, erreur: false });
      if (encore()) setVue(j.vue);
    } catch {
      setMessage({ texte: 'La réponse n’a pas pu être notée.', erreur: true });
    } finally {
      setEnCours(false);
    }
  };

  const etat = horsLigne ? <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur.</span> : undefined;
  const appliquees = vue ? vue.recentes.filter(p => p.statut === 'appliquee') : [];
  const autres = vue ? vue.recentes.filter(p => p.statut !== 'appliquee') : [];
  return (
    <BureauAgent agent="paul" cle="bureau-paul" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <p className="text-[8px] text-[#6b6880]">
            {vue.passage === null ? 'Paul n’a encore fait aucun passage complet.' : <>{lignePassage(vue.passage)[0].toUpperCase() + lignePassage(vue.passage).slice(1)}.</>}
            {vue.passage && vue.passage.illisibles.length > 0 && <> Pas relus : {vue.passage.illisibles.join(', ')}.</>}
          </p>
          {vue.echec && (
            <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Dernier passage raté ({jourHeure(vue.echec.quand)}) : aucun projet lu, GitHub n’a pas répondu pour {vue.echec.illisibles.join(', ')}.</p>
          )}
          {vue.rate !== null && !vue.echec && (
            <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Le passage de {jourCourt(vue.rate)} n’a pas eu lieu (rien reçu deux heures après 18:00).</p>
          )}
          {message && <p className="text-[8px] font-semibold" style={{ color: message.erreur ? ROUGE : VERT }}>{message.texte}</p>}
          <Section titre="À valider" n={vue.attente.length}>
            {vue.attente.length ? (
              <div className="space-y-[4px]">{vue.attente.map(p => <CarteProposition key={p.id} p={p} decider={(id, v) => { void decider(id, v); }} enCours={enCours} />)}</div>
            ) : <Gris>Aucune proposition en attente.</Gris>}
          </Section>
          <Section titre="Appliquées récemment" n={appliquees.length}>
            {appliquees.length ? (
              <ul className="space-y-[2px] text-[8px]">
                {appliquees.map(p => (
                  <li key={p.id}>
                    <b>{nomCourt(p.depot)}</b> · {p.fichier} · {jourHeure(p.decide ?? p.quand)}
                    {p.commit?.url && <> · <a href={p.commit.url} target="_blank" rel="noreferrer" className="underline">commit {p.commit.sha.slice(0, 7)}</a></>}
                  </li>
                ))}
              </ul>
            ) : <Gris>Rien d’écrit depuis 30 jours.</Gris>}
          </Section>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">
              Refusées par le QG <span className="font-normal text-[#6b6880]">({vue.refusQG.length})</span>
            </summary>
            <ul className="mt-[5px] space-y-[2px] text-[8px]">
              {vue.refusQG.length ? vue.refusQG.map((r, i) => (
                <li key={i}><b>{nomCourt(r.depot)}</b> · {r.fichier} · proposition refusée par le QG : {r.raison} <span className="text-[#6b6880]">({jourHeure(r.quand)})</span></li>
              )) : <Gris>Aucune.</Gris>}
            </ul>
          </details>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">
              Autres réponses <span className="font-normal text-[#6b6880]">({autres.length})</span>
            </summary>
            <ul className="mt-[5px] space-y-[2px] text-[8px]">
              {autres.length ? autres.map(p => (
                <li key={p.id}><b>{nomCourt(p.depot)}</b> · {p.fichier} · {NOM_STATUT[p.statut]} <span className="text-[#6b6880]">({jourHeure(p.decide ?? p.quand)})</span></li>
              )) : <Gris>Aucune.</Gris>}
            </ul>
          </details>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauPaul() {
  const ouvert = useQG(s => s.volet?.type === 'bureauPaul');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-paul" />}</AnimatePresence>;
}
