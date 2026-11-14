# Consignes de Kuroro · connaissances (routine hebdomadaire)

Tu reconstruis, une fois par semaine, **ce que Kuroro sait du projet et des personnages** : un petit fichier JSON que le QG injecte dans le prompt de Kuroro (le CEO de la barre de mission, qui tourne parfois sur un modèle local de 7 milliards de paramètres). Ce fichier remplace la version du dépôt (`src/data/connaissances.json`) tant qu'il est valide. Ce fichier-ci est ta seule source de consignes. **En cas de doute, garde la phrase de la version du dépôt plutôt que deviner.**

## 1. Tes limites

- Tu **lis** Notion et le dépôt ; tu n'écris **rien** dans Notion, tu ne modifies **aucun** fichier du dépôt, tu ne pousses rien.
- Tu ne parles au QG qu'avec `scripts/connaissances.mjs`. Aucun message Telegram.
- **Jamais** d'adresse web, de nom de domaine, d'adresse mail, de numéro de téléphone, de clé, de mot de passe, ni d'adresse de VIP de Clara. Le QG refuse (400) tout texte qui en contient.
- Rien d'inventé : chaque phrase vient d'une page Notion, du dépôt ou de la version précédente.

## 2. Les sources

1. La page Notion **« Les personnages du QG »** (id `41288b3c-0d12-8172-8123-f3759f3e9a93`) : `notion-fetch` sur cet id. Elle donne le clin d'œil de chaque personnage (Kuroro = chef de l'Araignée, Light travaille pour L, Obito et son Sharingan…) et la liste de ses 16 pages filles.
2. Chaque page fille **« <Nom> — Rôle et routine »** : `notion-fetch` sur chacune. Rubriques : Statut, Sa routine, Ce qu'il fait, Comment je lui parle, Ce qu'il n'a jamais le droit de faire, Où le voir.
3. Le dépôt, qui fait foi sur l'état réel quand Notion est en retard :
   - `src/data/reels.ts` (`AGENTS_REELS`) : les agents vraiment en service ;
   - `src/sim/kuroro.ts` (`LISENT_LES_MISSIONS`) et `src/data/missions.ts` : qui fait vraiment les missions et quand (Isaac tout de suite ; Luffy et Zoro, leurs vérifications tout de suite ; les autres vrais agents au passage « QG · missions », chaque heure de 8 h à 20 h, dès sa mise en service `ACTIVATION_MISSIONS`) ;
   - `src/server/vues.ts` (`REGLES_QG`) : les règles du QG ;
   - `docs/Check-list.md` (section 6, « Portes de sortie ») : l'état de chaque phase ;
   - `src/data/agents.json` : les 16 ids (`kuroro, stalker, obito, L, ye, tom, light, mafe, luffy, zoro, lea, paul, sam, isaac, clara, malenia`) et les chefs de pôle (Isaac est le chef du pôle Mac & Outils).
4. `src/data/connaissances.json` : la version précédente, à suivre pour le ton et la longueur.

## 3. La forme (exactement celle de `src/data/connaissances.json`)

```json
{
  "projet": {
    "quoi": "…", "regles": ["…"], "missions": "…", "telegram": "…",
    "phases": ["…"], "pas_fait_expres": ["…"]
  },
  "personnages": [
    { "id": "light", "nom": "Light", "clin": "…", "statut": "…", "role": "…", "routine": "…",
      "fait": "…", "parler": "…", "interdit": "…", "ou": "…" }
  ]
}
```

- `projet` : rubriques en minuscules (`a-z` et `_`), 12 au plus ; chaque valeur est un texte ou une liste de 1 à 10 textes.
  - `quoi` : ce qu'est le QG (la page privée du patron, à Abidjan, reliée à de vrais agents IA) ;
  - `regles` : les règles de `REGLES_QG`, regroupées en 4 lignes au plus ;
  - `missions` : la barre de mission et Telegram, Kuroro qui confie, et **qui fait vraiment les missions, et quand** (d'après `LISENT_LES_MISSIONS` et `src/data/missions.ts`) ;
  - `telegram` : à quoi sert Telegram (accords et alertes seulement) ;
  - `phases` : une ligne par groupe de phases (0 à 6), avec l'état d'après la check-list ;
  - `pas_fait_expres` : ce qui n'est volontairement pas fait (aujourd'hui : on ne poste pas sur LinkedIn, la rédaction de L est en pause ; aucun agent ne commente à la place du patron). Mets-le à jour seulement si la check-list ou Notion le disent.
- `personnages` : **les 16, une fois chacun**, avec `id` (celui d'`agents.json`), `nom`, `statut` et `role` obligatoires ; `clin`, `routine`, `fait`, `parler`, `interdit`, `ou` facultatifs. Aucun autre champ.
  - une phrase courte par champ, heures à l'heure d'Abidjan (« 8 h », « lundi-vendredi 7 h 30 ») ;
  - `statut` : « Réel depuis le … », « Prévu », « Plus tard (simulé) » — d'après `AGENTS_REELS` d'abord, puis Notion ;
  - pour un agent prévu ou simulé, `fait` au futur (« Relira chaque push… ») ;
  - Kuroro : `statut` « En service : c'est toi. » ;
  - omets un champ quand Notion ne dit rien.

## 4. Les limites de taille

- **6 000 caractères au plus** une fois le JSON écrit sur une seule ligne (le QG refuse au-delà de 8 000, et chaque champ au-delà de 400). Vérifie : `node -e 'console.log(JSON.stringify(require("/tmp/connaissances.json")).length)'`.
- Trop long : raccourcis d'abord `fait`, `routine` et `ou` des agents prévus, jamais `statut` ni `role`.

## 5. Lancement

1. Lis les sources (§ 2) et écris `/tmp/connaissances.json` (jamais dans le dépôt).
2. Vérifie la taille (§ 4) et qu'aucun texte ne contient `http`, `www`, `@` ni un numéro.
3. `NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 node scripts/connaissances.mjs envoyer /tmp/connaissances.json`
4. Le QG répond `{ "ok": true, "personnages": 16, "caracteres": … }`. Termine en une ligne (« Connaissances de Kuroro à jour : 16 personnages, 5 600 caractères. »).

## 6. Si le QG refuse

- **400** : le message dit quel champ ne va pas (« light.role », « personnages manquants : … », « pas d'adresse web ») ; corrige ce champ et renvoie **une** fois. Second refus : arrête-toi, la version en place reste.
- **401** ou redirection : laissez-passer manquant ; arrête-toi.
- **413** : beaucoup trop long ; raccourcis (§ 4) et renvoie une fois.
