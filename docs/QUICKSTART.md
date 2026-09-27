# Quickstart

🇧🇷 [Leia em português](pt-BR/INICIO-RAPIDO.md)

In 5 minutes you get **Claude** and **Codex** debating on their own. You write the topic, they talk in turns, and at the end you get a report with what was agreed and what needs your decision.

No more switching windows and pasting one AI's answer into the other.

![How Clodex works](img/flow.svg)

---

## Step 0 · Install (once)

Open a terminal (in VS Code: **Terminal → New Terminal**) and run:

```bash
cd path/to/clodex
npm link
clodex doctor
```

You should see:

```text
✔ Node 22.20.0
✔ Claude: 2.1.283 (Claude Code)
✔ Codex: codex-cli 0.155.0
All set.
```

> Nothing else to install. Clodex uses the Claude Code and Codex already on your computer (it even finds them inside the VS Code extensions), with the same accounts and subscriptions.

---

## Step 1 · Create the debate

Go to your project folder and create the debate:

```bash
cd path/to/your-project
clodex new debates/2026-09-28-checkout --topic "Mobile checkout flow"
```

This creates a folder with two files:

```text
debates/2026-09-28-checkout/
├── clodex.json    ← the debate rules (cycles, autonomy, language...)
└── 00-brief.md    ← what you want them to debate
```

> The debate language follows your system language. To pick one: `--language en` or `--language pt-BR`.

---

## Step 2 · Write the brief

Open `00-brief.md`, **delete the first line** (the `<!-- clodex:fill-in... -->` comment) and write what you want. Example:

```markdown
# Brief: Mobile checkout flow

## What I want to decide
The best sequence of screens to buy on a phone:
how many steps, what each one shows, and where payment happens.

## Context and files to read
- `docs/decisions.md`: what is already decided
- `debates/2026-09-20-visual-identity/`: the previous debate

## Already decided (do not reopen)
- The visual identity.
- Card and instant bank transfer are the payment methods.

## How I want the answer
A single sequence of screens, with the reason for each choice.
```

> **Tip:** the clearer the brief, the shorter and more useful the debate. Say what is **not** up for discussion.

---

## Step 3 · Start

```bash
clodex start debates/2026-09-28-checkout
```

Then just follow along. The terminal shows each turn starting and finishing:

![Example of the terminal during a debate](img/terminal.svg)

Each turn becomes a file in the folder, in order:

```text
debates/2026-09-28-checkout/
├── 00-brief.md
├── 01-claude.md     ← Claude's proposal
├── 02-codex.md      ← Codex's reply
├── 03-alex.md       ← your answer to a question
├── 04-claude.md
├── ...
└── 08-report.md     ← the final report
```

> ⏱️ Each turn takes a few minutes, because the AI reads the project before answering. A note shows up every minute so you know it is working. You can leave it running and do something else: when it needs you, **your system shows a notification**.

---

## Step 4 · Take part while it runs

You take part by **typing in the same terminal**, at any time:

| I want to... | I type in the debate's terminal |
|---|---|
| Answer a question | the answer + **Enter** |
| Chime in mid-debate | the text + **Enter** (it goes in before the next turn) |
| Send a long text | save it to a file and type `@my-answer.md` |
| Pause | `/pause` (waits for the current turn to end) |
| Continue after pausing | `/resume` |
| Stop | `/stop` (waits for the current turn) or `/stop now` |
| See where things stand | `/status` |

**When an AI asks something**, the debate stops and waits for you:

```text
❓ Codex needs you (turn 2):
   1. Should express checkout come before the full form? Options: yes / no. I recommend: yes.

Type your answer and press Enter (long text: @file.md).
you › Yes, express first. The full form stays as a second option.
✉ Answer received. The debate continues.
```

Your answer becomes a turn (`03-alex.md`) and both AIs read it.

<details>
<summary><b>Prefer another terminal?</b> (click to expand)</summary>

The same commands work from any terminal, even from another folder. Clodex remembers the last debate used:

```bash
clodex status
clodex reply "Yes, express first."
clodex reply @my-answer.md
clodex pause
clodex resume
clodex stop
clodex stop --now
```

</details>

---

## Step 5 · Read the report

When the AIs agree (**consensus**) or hit the cycle limit, **Claude writes the report** as a neutral reporter, and **Codex reviews** whether its positions were represented fairly. The report always has these parts:

| Section | What it holds |
|---|---|
| **Result in one sentence** | the conclusion |
| **What was agreed** | a table with each point, who proposed it and in which turn |
| **Remaining disagreements** | each AI's position and the recommendation |
| **Decisions the AIs made for you** | only in `decide` mode, for you to check |
| **What you need to decide** | the numbered list of what is yours |
| **Suggested next steps** | what to do next |
| **Review by Codex** | "accurate" or its corrections |

---

## Step 6 · After the report

- **Agree with everything?** You're done. The files stay in the folder as a record.
- **Want them to continue with your decisions?** Answer the items in "What you need to decide" and run another round:

```bash
clodex continue --more 1 --message "1: yes. 2: option B. 3: leave it for later."
```

This runs **1 more cycle** (each AI speaks once more) and produces a new report.

---

## Configuration recipes

Everything lives in the debate folder's `clodex.json`. Change only what you need:

**Always consult me** (default)
```json
{ "autonomy": "ask" }
```

**Decide among yourselves and bring me the result**
```json
{ "autonomy": "decide" }
```
> They still stop for anything about security, legal matters, money or irreversible actions, and they never approve plans on your behalf.

**Short debate** (1 cycle = each AI speaks once)
```json
{ "max_cycles": 1 }
```

**Codex opens**
```json
{ "participants": ["codex", "claude"] }
```

**Debate in Portuguese** (the terminal stays in English)
```json
{ "language": "pt-BR" }
```

**They need to create files** (mockups, examples)
```json
{ "permissions": "write" }
```
> Each AI can only write in its own `attachments/NN-name/` folder inside the debate. The rest of the project stays read-only.

**No report at the end**
```json
{ "reporter": null }
```

**Extra rules for both**
```json
{ "extra_instructions": "Keep answers short. Always compare with the current flow described in docs/flow.md." }
```

The full list is in the [MANUAL, §5](MANUAL.md#5-full-configuration).

---

## Cheat sheet

| Command | What for |
|---|---|
| `clodex new <folder> --topic "..."` | create a debate |
| `clodex start [folder]` | start, or continue where it stopped |
| `clodex status` | see where things stand |
| `clodex reply "..."` | answer or comment (accepts `@file.md`) |
| `clodex pause` / `resume` | pause and continue |
| `clodex stop [--now]` | stop |
| `clodex continue --more 1 --message "..."` | another round after the report |
| `clodex report` | generate the report now, with what there is |
| `clodex doctor` | check the installation |

---

## Common problems

| What you see | What to do |
|---|---|
| `clodex` is not recognized | Run Step 0 again (`npm link` in the clodex folder). Alternative: `node path/to/clodex/bin/clodex.mjs ...` |
| `✖ Claude: not found` or `✖ Codex: not found` | Check that the extension is installed in VS Code. If it lives somewhere else, see the [MANUAL, §12](MANUAL.md#12-where-clodex-looks-for-claude-and-codex) |
| "The brief is still the blank template" | Delete the first line of `00-brief.md` |
| "An orchestrator is already running this debate" | Another terminal has this debate open. Use `clodex status` or `clodex stop` |
| "✖ Turn 3 (Codex): ..." and the debate stopped | Usually a usage limit or the internet. Wait and type `/resume` (or `clodex resume`) |
| I closed the terminal by accident | Run `clodex start` again: it continues from the last complete turn |
| Codex says "Access denied" or can't find files (Windows) | Keep the debate in a regular folder (Documents, your project folder), never in Windows temp folders (`AppData\Local\Temp`). See the [MANUAL, §14](MANUAL.md#14-troubleshooting) |
| I want to see exactly what the AI received | Open `.clodex/prompts/` inside the debate folder |

More details: [MANUAL.md](MANUAL.md).
