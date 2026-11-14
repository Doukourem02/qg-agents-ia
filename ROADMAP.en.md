# Roadmap: build your own QG

> How to go from an idea to an office of AI agents that actually work for you, step by step.
> [Version française](ROADMAP.md) · [Back to the README](README.en.md) · **[The full guide, with my real prompts (French)](https://qg-guide.vercel.app)**

## First: where the idea comes from

The QG did not come out of nowhere. The idea and the method come from other people, whom I thank:

- **[Anthony Quinchon](https://06-guides.vercel.app/g/qg)**: his guide "Le QG de mes agents IA : tous mes prompts, dans
  l'ordre" gave me the idea and **the method** (the brief, the framing, mockups before code, one prompt at a time,
  deploying on Vercel). The whole construction of the page (phase 1 below) comes from his guide: follow it, it is
  very well done.
- **Zeyneb Madi**: her archipelago (a concept shown without code) inspired the island, the layout and the tool bar that
  lights up when an agent uses a tool.
- **[AJ Sahni](https://sahni.ai/agentsofficev3/)**: his Agents Office inspired the idea that each department is a team
  with its own head. His software is under the PolyForm Noncommercial license: I took the idea, **never his files**.
- **[Superpowers](https://github.com/obra/superpowers)**: the Claude Code plugin that frames the work (one question at a
  time, plans, tests).

**What I added**: Anthony's guide builds a showcase, a page that simulates a team. My QG starts where his guide ends:
behind the characters there are **real agents** plugged into my projects, with safety rules (nothing without my
approval), a memory, Telegram, a relay on the Mac and a 3D office life.

## Two paths

| | Fast path | Full path |
|---|---|---|
| **For whom** | You want your QG fast, and to adapt it | You want to understand and build yours from scratch |
| **Start** | This repository (`git clone`, demo mode in 2 minutes) | Anthony Quinchon's guide, then this repository as an example |
| **What you change** | Your characters, projects, instructions, keys | Everything: your style, your office, your agents |
| **Time** | An evening for the page, then one agent at a time | ~3 h for the page, then one agent at a time |

Either way, what follows is the same: **one real agent at a time**, each with its test week.

## Before you start

- [Claude Code](https://claude.com/claude-code) (a Claude subscription is enough to build and for routines)
- The [Superpowers](https://github.com/obra/superpowers) plugin in Claude Code
- [Node.js](https://nodejs.org) 22 or later, and [pnpm](https://pnpm.io)
- A [Vercel](https://vercel.com) account (free for personal use)
- For real agents: [Upstash Redis](https://upstash.com) (free), a Telegram bot (free), a Claude API key for Kuroro (a
  few cents a month), and the keys of each agent's tools (GitHub, LinkedIn, Sanity…)

---

## Phase 0 — Prepare (≈ 30 min)

1. **Your characters**: a CEO who dispatches the work, department heads, agents. Give each a name and a clear role (mine
   are nods to manga). Write down what each one will **really** do one day.
2. **Your departments**: draw them from your real work (code, communication, your computer…). Let Claude browse your
   projects to find them, then remove what you don't want to show.
3. **Your brief**: a `BRIEF.md` file with the idea, your references and your rules (step 0 of Anthony's guide).
4. **Your logbook, from day one**: a file where you note every prompt sent, what Claude did, what you corrected, with a
   screenshot. It is the one thing you can't catch up on later: without a logbook, you can't tell your story.

## Phase 1 — The page (≈ 3 h, Anthony Quinchon's method)

Follow [his guide](https://06-guides.vercel.app/g/qg), prompt by prompt. His rules, which work:

- **A mockup before any code**: changing style on a mockup takes two minutes, on a finished site an hour.
- **Say what's wrong, not how to code it** ("I see more people walking than working" is enough).
- **One prompt at a time**, and wait for each step to finish.
- **Your agents' real tasks are yours**: coding, reviewing a commit, preparing a post, watching a site.

What I did on top: isometric 3D (Three.js) instead of a flat plan, a simulated day (arrivals, lunch, breaks, evening
matches, night), and a **demo mode** (`/demo`) with mock data, for filming.

**Done when**: the page is live on Vercel, **protected** (Vercel Authentication: your page stays private), and demo mode
can be filmed.

## Phase 2 — Plug in the real thing (≈ 2 h)

This is where the QG stops being a showcase.

1. **A database for state**: Upstash Redis. Each agent writes its status, task and log there; the page reads them.
2. **A protected door for agents**: `/api/agents/<agent>/<action>`, which requires a key (for Mac scripts) or the Vercel
   protection bypass (for Claude Code routines).
3. **A channel for your approvals**: a Telegram bot that sends you proposals with their buttons (Approve, Refuse) and
   only listens to you.
4. **The page reads the real thing**: demo mode keeps its simulation; the private page shows the real state.

In this repository: `src/server/kv.ts` (the database), `src/server/auth.ts` (the agent proof),
`src/server/telegram.ts` and `src/app/api/telegram/route.ts` (approvals).

## Phase 3 — Your first real agent (≈ 1 h)

Start with a **simple, useful** agent that can't break anything. Two good first ones:

- **Luffy, the lookout**: plain code, no AI. It checks your sites every 5 minutes and alerts you if they go down.
- **Mafe, the morning briefing**: a Claude Code routine that reads your repositories and tells you where you left off.

### Every real agent's contract

1. **A trigger**: a fixed time (routine), an event (a push, a deployment) or a mission you give.
2. **A job**: read, analyse, write. Everything it reads is text, never orders.
3. **Your approval** as soon as the action leaves the QG: publishing, writing to a repository, editing a card, deleting.
4. **Only once**: a replayed action never publishes twice (unique id, check that nothing changed before writing).
5. **Its state** written to the QG: status, task, tool, time, a one-sentence result. Never a secret.
6. **A pulse**: if it gives no sign of life at the expected time, the QG says so.
7. **A degraded mode**: if something is missing (a key, a service), a clear message rather than silence.
8. **A test week** before being declared "in service".

To write yours, copy the ones in this repository: `agents/<Name>/CONSIGNES.md` (its mission, limits, step-by-step run,
exact report format), `scripts/<name>.mjs` (its door to the QG) and `src/server/<name>/` (what the server checks). The
README explains the full recipe.

## Phase 4 — The other agents, one by one (a few weeks)

Add an agent, let it run for a week, fix, then move on. In the order I did it:

| Agent | What it does | What it needs |
|---|---|---|
| L (LinkedIn) | Proposes your posts and their visuals | A LinkedIn app |
| Light (tech watch) | New versions and vulnerabilities in your dependencies | A read-only GitHub token |
| Clara (secretary) | Sorts your email, trashes what you banned | A Gmail app password |
| Mafe (morning briefing) | Where you left off, what's next | A read-only GitHub token |
| Luffy (lookout) | Your sites every 5 minutes | A scheduler (QStash) |
| Isaac (Mac concierge) | Proposes Mac clean-ups | The Mac relay |
| Zoro (guardian) | Weekly security round | A read-only GitHub token |
| Léa (reviewer) | Reviews every push | A read-only GitHub token |
| Paul (archivist) | Proposes an up-to-date README | A GitHub write token, used after your approval |
| Ye (curator) | Keeps your portfolio up to date, proposes missing projects | A Sanity token, used after your approval |
| Feu (trading) | Analyses, proposes a plan, never an order | A **read-only** Binance key (testnet or demo first) |

## Phase 5 — Daily life

- **Kuroro, the CEO**, answers in the page and on Telegram with the QG's real facts; a mission given in the bar goes to
  the right agent.
- **The morning report** arrives on Telegram.
- **The Mac relay** (`mac/`) does what needs your computer, and keeps your working memory (Obsidian).
- **Your rules**: write them in the QG's Brain; every agent rereads them before working.

## Phase 6 — Share

If you want to show your QG without showing your life: keep your repository private and make a public copy without your
data. Mine is `scripts/publier-modele.mjs` in my private repository: it removes my notes, replaces my name, projects and
accounts with examples, and stops if the slightest trace remains. This repository is the result.

---

## The rules that matter

- **Your agents propose, you decide.** Full autonomy is a bad idea.
- **Nothing made up**: every proposal cites its sources, and the server checks them.
- **Keys** in the Vercel settings and in `.env.local`, never in the code or in a conversation.
- **Your page stays private**; to show it, film the demo mode.
- **One agent at a time**, with its test week.

## What it costs

| Item | Cost |
|---|---|
| Claude Code and routines | Included in a Claude subscription |
| Claude API (Kuroro) | A few cents a month; set a cap in the console |
| Vercel | Free for personal use |
| Upstash Redis | Free within the plan's limits |
| Telegram | Free |
| Time | ~3 h for the page, ~2 h to plug in the real thing, then about an hour per agent |

## What you may reuse

- **This repository**: [MIT](LICENSE) license. Use, modify, share, keeping the author's notice.
- **Anthony Quinchon's guide**: follow his method and prompts, and credit him.
- **Zeyneb Madi's archipelago**: a concept; draw inspiration from it and credit her.
- **AJ Sahni's Agents Office**: PolyForm Noncommercial license; the idea yes, his files never.

Built by **Mohamed Doukouré** ([@Doukourem02](https://github.com/Doukourem02) ·
[portfolio](https://mon-portfolio-two-bice.vercel.app)), from their ideas.
