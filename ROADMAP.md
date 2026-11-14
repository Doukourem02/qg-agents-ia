# Feuille de route : monter ton propre QG

> Comment passer d'une idée à un bureau d'agents IA qui travaillent vraiment pour toi, étape par étape.
> [English version](ROADMAP.en.md) · [Retour au README](README.md) · **[Le guide complet, avec mes vrais prompts](https://qg-guide.vercel.app)**

## D'abord : d'où vient l'idée

Le QG n'est pas parti de rien. L'idée et la méthode viennent d'autres personnes, que je remercie :

- **[Anthony Quinchon](https://06-guides.vercel.app/g/qg)** : son guide « Le QG de mes agents IA : tous mes prompts,
  dans l'ordre » m'a donné l'idée et **la méthode** (le brief, le cadrage, les maquettes avant le code, les prompts un
  par un, la mise en ligne sur Vercel). Toute la construction de la page (phase 1 ci-dessous) vient de son guide :
  suis-le, il est très bien fait.
- **Zeyneb Madi** : son archipel (un concept présenté sans code) a inspiré l'île, la disposition et la barre d'outils
  qui s'allume quand un agent s'en sert.
- **[AJ Sahni](https://sahni.ai/agentsofficev3/)** : son Agents Office a inspiré l'idée que chaque pôle est une équipe
  avec son chef. Son logiciel est sous licence PolyForm Noncommercial : j'ai repris l'idée, **jamais ses fichiers**.
- **[Superpowers](https://github.com/obra/superpowers)** : le plugin de Claude Code qui cadre le travail (questions une
  par une, plans, tests).

**Ce que j'ai ajouté** : le guide d'Anthony construit une vitrine, une page qui simule une équipe. Mon QG commence
là où son guide s'arrête : derrière les personnages, il y a **de vrais agents** branchés sur mes projets, avec des
règles de sécurité (rien sans mon accord), une mémoire, Telegram, un relais sur le Mac et une vie de bureau en 3D.

## Deux chemins

| | Chemin rapide | Chemin complet |
|---|---|---|
| **Pour qui** | Tu veux ton QG vite, et l'adapter | Tu veux comprendre et construire le tien de zéro |
| **Départ** | Ce dépôt (`git clone`, mode démo en 2 minutes) | Le guide d'Anthony Quinchon, puis ce dépôt comme exemple |
| **Ce que tu changes** | Tes personnages, tes projets, tes consignes, tes clés | Tout : ton style, ton bureau, tes agents |
| **Temps** | Une soirée pour la page, puis un agent à la fois | ~3 h pour la page, puis un agent à la fois |

Dans les deux cas, la suite est la même : **un agent réel à la fois**, chacun avec sa semaine de test.

## Avant de commencer

- [Claude Code](https://claude.com/claude-code) (un abonnement Claude suffit pour construire et pour les routines)
- Le plugin [Superpowers](https://github.com/obra/superpowers) dans Claude Code
- [Node.js](https://nodejs.org) 22 ou plus récent, et [pnpm](https://pnpm.io)
- Un compte [Vercel](https://vercel.com) (gratuit pour un usage personnel)
- Pour les vrais agents : [Upstash Redis](https://upstash.com) (gratuit), un bot Telegram (gratuit), une clé de l'API
  Claude pour Kuroro (quelques centimes par mois), et les clés des outils de chaque agent (GitHub, LinkedIn, Sanity…)

---

## Phase 0 — Préparer (≈ 30 min)

1. **Tes personnages** : un CEO qui répartit le travail, des chefs de pôle, des agents. Donne-leur un nom et un rôle
   clair (les miens sont des clins d'œil à des mangas). Écris pour chacun ce qu'il fera **vraiment** un jour.
2. **Tes pôles** : tire-les de ton travail réel (le code, la communication, ton ordinateur…). Laisse Claude parcourir
   tes projets pour les trouver, puis enlève ce que tu ne veux pas montrer.
3. **Ton brief** : un fichier `BRIEF.md` avec l'idée, tes références et tes règles (c'est l'étape 0 du guide d'Anthony).
4. **Ton carnet de bord, dès le début** : un fichier où tu notes chaque prompt envoyé, ce que Claude a fait, ce que tu
   as corrigé, avec une capture. C'est la seule chose qui ne se rattrape pas après : sans carnet, tu ne pourras pas
   raconter ton chemin.

## Phase 1 — La page (≈ 3 h, la méthode d'Anthony Quinchon)

Suis [son guide](https://06-guides.vercel.app/g/qg), prompt par prompt. Ses règles, qui marchent :

- **Une maquette avant le moindre code** : changer de style sur une maquette prend deux minutes, sur un site fini une
  heure.
- **Dis ce qui ne va pas, pas comment le coder** (« je vois plus de gens qui marchent que de gens qui travaillent »
  suffit).
- **Un prompt à la fois**, et attends la fin de chaque étape.
- **Les vraies tâches de tes agents sont les tiennes** : coder, relire un commit, préparer un post, surveiller un site.

Ce que j'ai fait en plus : la 3D isométrique (Three.js) au lieu d'un plan à plat, une simulation de la journée (arrivées,
déjeuner, pauses, matchs du soir, nuit), et un **mode démo** (`/demo`) avec des données fictives, pour filmer.

**Fini quand** : la page est en ligne sur Vercel, **protégée** (Vercel Authentication : ta page reste privée), et le
mode démo est filmable.

## Phase 2 — Brancher le réel (≈ 2 h)

C'est là que le QG cesse d'être une vitrine.

1. **Une base pour l'état** : Upstash Redis. Chaque agent y écrit son statut, sa tâche et son journal ; la page les lit.
2. **Une entrée protégée pour les agents** : `/api/agents/<agent>/<action>`, qui exige une clé (pour les scripts du Mac)
   ou le laissez-passer de la protection Vercel (pour les routines Claude Code).
3. **Un canal pour tes accords** : un bot Telegram qui t'envoie les propositions avec leurs boutons (Valider, Refuser)
   et qui n'écoute que toi.
4. **La page lit le vrai** : le mode démo garde sa simulation ; la page privée montre l'état réel.

Dans ce dépôt : `src/server/kv.ts` (la base), `src/server/auth.ts` (la preuve d'agent), `src/server/telegram.ts` et
`src/app/api/telegram/route.ts` (les accords).

## Phase 3 — Ton premier vrai agent (≈ 1 h)

Commence par un agent **simple et utile**, qui ne peut rien casser. Deux bons premiers :

- **Luffy, la vigie** : du code pur, sans IA. Il vérifie tes sites toutes les 5 minutes et t'alerte s'ils tombent.
- **Mafe, le point du matin** : une routine Claude Code qui lit tes dépôts et te dit où tu t'es arrêté sur chaque projet.

### Le contrat de chaque agent réel

1. **Un déclencheur** : une heure fixe (routine), un événement (un push, un déploiement) ou une mission que tu donnes.
2. **Un travail** : lire, analyser, rédiger. Tout ce qu'il lit est du texte, jamais des ordres.
3. **Ton accord** dès que l'action sort du QG : publier, écrire sur un dépôt, modifier une fiche, supprimer.
4. **Une seule fois** : une action rejouée ne publie jamais deux fois (identifiant unique, vérification que rien n'a
   bougé avant d'écrire).
5. **Son état** écrit dans le QG : statut, tâche, outil, heure, résultat en une phrase. Jamais un secret.
6. **Un pouls** : s'il ne donne pas signe de vie à l'heure prévue, le QG le dit.
7. **Un mode dégradé** : si quelque chose manque (une clé, un service), un message clair plutôt que le silence.
8. **Une semaine de test** avant d'être déclaré « en service ».

Pour écrire le tien, copie ceux de ce dépôt : `agents/<Nom>/CONSIGNES.md` (sa mission, ses limites, son pas à pas, le
format exact de son rapport), `scripts/<nom>.mjs` (sa porte vers le QG) et `src/server/<nom>/` (ce que le serveur
vérifie). Le README explique la recette complète.

## Phase 4 — Les autres agents, un par un (quelques semaines)

Ajoute un agent, laisse-le tourner une semaine, corrige, puis passe au suivant. Dans l'ordre où je l'ai fait :

| Agent | Ce qu'il fait | Ce qu'il lui faut |
|---|---|---|
| L (LinkedIn) | Propose tes posts et leurs visuels | Une app LinkedIn |
| Light (veilleur) | Nouvelles versions et failles de tes dépendances | Un jeton GitHub en lecture |
| Clara (secrétaire) | Trie tes mails, met à la corbeille ce que tu as banni | Un mot de passe d'application Gmail |
| Mafe (point du matin) | Où tu t'es arrêté, la suite | Un jeton GitHub en lecture |
| Luffy (vigie) | Tes sites toutes les 5 minutes | Un planificateur (QStash) |
| Isaac (concierge Mac) | Propose le ménage du Mac | Le relais Mac |
| Zoro (gardien) | Tour de sécurité hebdomadaire | Un jeton GitHub en lecture |
| Léa (relectrice) | Relit chaque push | Un jeton GitHub en lecture |
| Paul (archiviste) | Propose le README à jour | Un jeton GitHub en écriture, utilisé après ton accord |
| Ye (curatrice) | Tient ton portfolio à jour, propose les projets absents | Un jeton Sanity, utilisé après ton accord |
| Feu (trading) | Analyse, propose un plan, jamais un ordre | Une clé Binance **en lecture seule** (testnet ou démo d'abord) |

## Phase 5 — La vie quotidienne

- **Kuroro, le CEO**, répond dans la page et sur Telegram, avec les vrais faits du QG ; une mission donnée dans la barre
  part au bon agent.
- **Le compte rendu du matin** arrive sur Telegram.
- **Le relais Mac** (`mac/`) fait ce qui demande ton ordinateur, et garde ta mémoire de travail (Obsidian).
- **Tes règles** : écris-les dans le Cerveau du QG ; chaque agent les relit avant de travailler.

## Phase 6 — Partager

Si tu veux montrer ton QG sans montrer ta vie : garde ton dépôt privé, et fabriques-en une copie publique sans tes
données. Ici, c'est `scripts/publier-modele.mjs` dans mon dépôt privé : il retire mes notes, remplace mon nom, mes
projets et mes comptes par des exemples, et s'arrête s'il reste la moindre trace. Ce dépôt en est le résultat.

---

## Les règles qui comptent

- **Tes agents proposent, toi tu décides.** L'autonomie totale est une mauvaise idée.
- **Rien d'inventé** : chaque proposition cite ses sources, et le serveur le vérifie.
- **Les clés** dans les réglages de Vercel et dans `.env.local`, jamais dans le code ni dans une conversation.
- **Ta page reste privée** ; pour la montrer, filme le mode démo.
- **Un agent à la fois**, avec sa semaine de test.

## Ce que ça coûte

| Poste | Coût |
|---|---|
| Claude Code et routines | Compris dans un abonnement Claude |
| API Claude (Kuroro) | Quelques centimes par mois ; règle un plafond dans la console |
| Vercel | Gratuit pour un usage personnel |
| Upstash Redis | Gratuit dans les limites de l'offre |
| Telegram | Gratuit |
| Temps | ~3 h pour la page, ~2 h pour le branchement, puis environ une heure par agent |

## Ce que tu as le droit de reprendre

- **Ce dépôt** : licence [MIT](LICENSE). Utilise, modifie, partage, en gardant la mention de l'auteur.
- **Le guide d'Anthony Quinchon** : suis sa méthode et ses prompts, et crédite-le.
- **L'archipel de Zeyneb Madi** : un concept ; inspire-toi en la créditant.
- **L'Agents Office d'AJ Sahni** : licence PolyForm Noncommercial ; l'idée oui, ses fichiers jamais.

Construit par **Mohamed Doukouré** ([@Doukourem02](https://github.com/Doukourem02) ·
[portfolio](https://mon-portfolio-two-bice.vercel.app)), à partir de leurs idées.
