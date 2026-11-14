'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { NouvelleYe, PropositionYe, QuestionYe } from '@/server/ye/types';
import { lignePassage, NOM_STATUT, NOM_STATUT_NOUVELLE, NOMS_CHAMPS, PORTFOLIO_EN_LIGNE, type VueYe } from '@/server/ye/etiquette';
import { BureauAgent, Section } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Ye (modèle commun : BureauAgent.tsx). « Son travail » : ses propositions pour les fiches du portfolio,
// chaque champ avant/après en entier (exactement ce qui sera publié), avec Valider / Refuser comme sur Telegram ; ses
// questions de compétences (Oui / Non) ; les projets absents du portfolio (la fiche proposée en entier, Ajouter / Pas
// maintenant / Jamais) ; ce que le QG a refusé ; ce qui a été publié. Page privée, absent de /demo.
// Le client n'importe que `etiquette.ts` et des types. Il lit /api/ye à l'ouverture puis toutes les 60 secondes.

const ROUGE = '#d23b3b';
const VERT = '#2f9c5a';
const jourHeure = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

function useVueYe() {
  const [vue, setVue] = useState<VueYe | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [derniere] = useState(() => derniereSeule());
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/ye', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueYe;
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
const Texte = ({ t, fond }: { t: string; fond: string }) => (
  <pre className="mt-[1px] whitespace-pre-wrap break-words rounded-[4px] px-[6px] py-[3px] font-mono text-[7.5px] leading-snug" style={{ background: fond }}>{t || '(vide)'}</pre>
);
const Bouton = ({ fonce, onClick, disabled, children }: { fonce?: boolean; onClick: () => void; disabled: boolean; children: ReactNode }) => (
  <button onClick={onClick} disabled={disabled}
    className={`shrink-0 rounded-[6px] px-[8px] py-[2px] text-[8px] font-semibold disabled:opacity-50 ${fonce ? 'bg-[#1d1b2e] text-white' : 'bg-[#f1f0f5] text-[#2a2740]'}`}>{children}</button>
);

function CarteProposition({ p, agir, enCours }: { p: PropositionYe; agir: (cle: string, id: string) => void; enCours: boolean }) {
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ boxShadow: 'inset 2.5px 0 0 #b14fd6' }}>
      <div className="flex items-baseline gap-[6px]">
        <span className="min-w-0 flex-1 truncate"><b>{p.titre}</b> · {p.changements.length} {p.changements.length > 1 ? 'champs' : 'champ'}</span>
        <Bouton fonce onClick={() => agir('valider', p.id)} disabled={enCours}>Valider</Bouton>
        <Bouton onClick={() => agir('refuser', p.id)} disabled={enCours}>Refuser</Bouton>
      </div>
      {p.changements.map(c => (
        <div key={c.champ} className="mt-[4px]">
          <div className="text-[8px] font-bold">{NOMS_CHAMPS[c.champ] ?? c.champ}</div>
          <div className="text-[7.5px] font-semibold" style={{ color: ROUGE }}>Avant</div>
          <Texte t={c.avant} fond="#fdecec" />
          <div className="text-[7.5px] font-semibold" style={{ color: VERT }}>Après (publié tel quel)</div>
          <Texte t={c.apres} fond="#eef8f1" />
        </div>
      ))}
      <ul className="mt-[3px] space-y-[1px]">{p.raisons.map((r, i) => <li key={i}>• {r.texte} <code className="text-[#6b6880]">{r.source}</code></li>)}</ul>
      <div className="mt-[2px] text-[7.5px] text-[#6b6880]">Proposé le {jourHeure(p.quand)} · expire au bout de 8 jours sans réponse</div>
    </div>
  );
}

function CarteNouvelle({ n, agir, enCours }: { n: NouvelleYe; agir: (cle: string, id: string) => void; enCours: boolean }) {
  const c = n.champs;
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ boxShadow: 'inset 2.5px 0 0 #b14fd6' }}>
      <div className="flex flex-wrap items-baseline gap-[6px]">
        <span className="min-w-0 flex-1"><b>{c.title}</b> n’est pas dans ton portfolio <span className="text-[#6b6880]">({n.depot})</span></span>
        <Bouton fonce onClick={() => agir('ajouter', n.id)} disabled={enCours}>Ajouter</Bouton>
        <Bouton onClick={() => agir('plus-tard', n.id)} disabled={enCours}>Pas maintenant</Bouton>
        <Bouton onClick={() => agir('jamais', n.id)} disabled={enCours}>Jamais</Bouton>
      </div>
      <div className="mt-[3px] text-[8px]">{c.kind} · {c.kindEn} · {NOM_STATUT_FICHE[c.status] ?? c.status}{c.liveUrl && <> · <a href={c.liveUrl} target="_blank" rel="noreferrer" className="underline">{c.liveUrl}</a></>}</div>
      <div className="text-[8px]">{NOMS_CHAMPS.technologies} : {c.technologies.map(t => t.name).join(', ')}</div>
      <div className="mt-[3px] text-[8px] font-bold">{NOMS_CHAMPS.description}</div>
      <Texte t={c.description} fond="#eef8f1" />
      <div className="mt-[3px] text-[8px] font-bold">{NOMS_CHAMPS.descriptionEn}</div>
      <Texte t={c.descriptionEn} fond="#eef8f1" />
      <div className="mt-[3px] text-[8px]">{n.images.length ? <>Images : {n.images.join(', ')}</> : 'Aucune image : créée en brouillon, invisible sur le site, le temps d’en ajouter une dans le Studio.'}</div>
      <ul className="mt-[3px] space-y-[1px]">{n.raisons.map((r, i) => <li key={i}>• {r.texte} <code className="text-[#6b6880]">{r.source}</code></li>)}</ul>
      <div className="mt-[2px] text-[7.5px] text-[#6b6880]">Proposé le {jourHeure(n.quand)} · expire au bout de 8 jours sans réponse</div>
    </div>
  );
}
const NOM_STATUT_FICHE: Record<string, string> = { production: 'En production', development: 'En développement', done: 'Terminé' };

function CarteQuestion({ q, agir, enCours }: { q: QuestionYe; agir: (cle: string, id: string) => void; enCours: boolean }) {
  return (
    <div className="flex items-baseline gap-[6px] rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug">
      <span className="min-w-0 flex-1">La fiche <b>{q.titre}</b> utilise <b>{q.techno}</b> (vu dans <code>{q.source}</code>), absente de tes compétences. Tu la maîtrises ?</span>
      <Bouton fonce onClick={() => agir('oui', q.id)} disabled={enCours}>Oui, je l’ajoute</Bouton>
      <Bouton onClick={() => agir('non', q.id)} disabled={enCours}>Non</Bouton>
    </div>
  );
}

function Panneau() {
  const { vue, setVue, horsLigne, derniere } = useVueYe();
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);

  const agir = async (cle: string, id: string) => {
    setEnCours(true);
    setMessage(null);
    const encore = derniere.prendre();
    try {
      const r = await fetch('/api/ye', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [cle]: id }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as { message: string; vue: VueYe };
      setMessage({ texte: j.message, erreur: false });
      if (encore()) setVue(j.vue);
    } catch {
      setMessage({ texte: 'La réponse n’a pas pu être notée.', erreur: true });
    } finally {
      setEnCours(false);
    }
  };
  const lancer = (cle: string, id: string) => { void agir(cle, id); };

  const etat = horsLigne ? <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur.</span> : undefined;
  const publiees = vue ? vue.recentes.filter(p => p.statut === 'publiee') : [];
  const autres = vue ? vue.recentes.filter(p => p.statut !== 'publiee') : [];
  return (
    <BureauAgent agent="ye" cle="bureau-ye" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <p className="text-[8px] text-[#6b6880]">
            {vue.passage === null ? 'Ye n’a encore fait aucun passage.' : <>{lignePassage(vue.passage)[0].toUpperCase() + lignePassage(vue.passage).slice(1)}.</>}
            {vue.passage && vue.passage.sansLien > 0 && <> Les fiches sans lien GitHub ne sont pas suivies.</>}
          </p>
          {vue.echec && <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Dernier passage raté ({jourHeure(vue.echec.quand)}) : {vue.echec.raison}.</p>}
          {vue.rate !== null && !vue.echec && <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Le passage de {jourCourt(vue.rate)} n’a pas eu lieu (rien reçu deux heures après 17:30).</p>}
          {message && <p className="text-[8px] font-semibold" style={{ color: message.erreur ? ROUGE : VERT }}>{message.texte}</p>}
          <Section titre="À valider" n={vue.attente.length}>
            {vue.attente.length ? <div className="space-y-[4px]">{vue.attente.map(p => <CarteProposition key={p.id} p={p} agir={lancer} enCours={enCours} />)}</div>
              : <Gris>Aucune fiche en attente.</Gris>}
          </Section>
          <Section titre="Projets absents du portfolio" n={vue.nouvelles.length}>
            {vue.nouvelles.length ? <div className="space-y-[4px]">{vue.nouvelles.map(n => <CarteNouvelle key={n.id} n={n} agir={lancer} enCours={enCours} />)}</div>
              : <Gris>Aucun : tes projets actifs ont tous leur fiche (ou tu as répondu).</Gris>}
            {vue.nouvellesRecentes.length > 0 && (
              <ul className="mt-[4px] space-y-[2px] text-[8px]">
                {vue.nouvellesRecentes.map(n => <li key={n.id}><b>{n.champs.title}</b> · {NOM_STATUT_NOUVELLE[n.statut]} <span className="text-[#6b6880]">({jourHeure(n.decide ?? n.quand)})</span></li>)}
              </ul>
            )}
          </Section>
          <Section titre="Questions de compétences" n={vue.questions.length}>
            {vue.questions.length ? <div className="space-y-[4px]">{vue.questions.map(q => <CarteQuestion key={q.id} q={q} agir={lancer} enCours={enCours} />)}</div>
              : <Gris>Aucune question.</Gris>}
          </Section>
          <Section titre="Publiées récemment" n={publiees.length}>
            {publiees.length ? (
              <ul className="space-y-[2px] text-[8px]">
                {publiees.map(p => <li key={p.id}><b>{p.titre}</b> · {jourHeure(p.decide ?? p.quand)} · <a href={PORTFOLIO_EN_LIGNE} target="_blank" rel="noreferrer" className="underline">voir le portfolio</a></li>)}
              </ul>
            ) : <Gris>Rien de publié depuis 30 jours.</Gris>}
          </Section>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">Refusées par le QG <span className="font-normal text-[#6b6880]">({vue.refusQG.length})</span></summary>
            <ul className="mt-[5px] space-y-[2px] text-[8px]">
              {vue.refusQG.length ? vue.refusQG.map((r, i) => <li key={i}><b>{r.titre}</b> · proposition refusée par le QG : {r.raison} <span className="text-[#6b6880]">({jourHeure(r.quand)})</span></li>) : <Gris>Aucune.</Gris>}
            </ul>
          </details>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">Autres réponses <span className="font-normal text-[#6b6880]">({autres.length})</span></summary>
            <ul className="mt-[5px] space-y-[2px] text-[8px]">
              {autres.length ? autres.map(p => <li key={p.id}><b>{p.titre}</b> · {NOM_STATUT[p.statut]} <span className="text-[#6b6880]">({jourHeure(p.decide ?? p.quand)})</span></li>) : <Gris>Aucune.</Gris>}
            </ul>
          </details>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauYe() {
  const ouvert = useQG(s => s.volet?.type === 'bureauYe');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-ye" />}</AnimatePresence>;
}
