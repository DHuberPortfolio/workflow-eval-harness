---
name: wfeval
description: Evaluate an AI agent or workflow with the workflow eval harness (wfeval): score its runs against an answer key, find silent errors, and have a panel of AI judges look at doubts about the key. Use when asked to use the eval tool or eval harness, run wfeval, or evaluate, score or grade a workflow or agent.
---

# Evaluating a workflow with wfeval

The harness is `node <harness>/bin/wfeval.js`, where `<harness>` is three folders above this file. If
this skill was copied elsewhere, find the `workflow-eval-harness` checkout, or ask where it is.
`README.md` and `docs/CONFIG.md` there cover every command.

Judges run by default, with no need to ask for them. The one stop is in step 3: nothing that would
bill per token runs until the person says so.

## 1. Score

Run what the task calls for: usually `score`, and `variance` or `compare` with several runs. This
step uses no AI and costs nothing. **This is the official result.** Any gate (`--fail-on`,
`--fail-if-worse`) runs here, against the answer key as it stands.

## 2. Find what needs judging

```
wfeval suspects --config <config> --key <key> <run> [<run> ...] --write-rulings <new pending file>
```

It writes the 20 likeliest doubts about the key as pending rulings (`--top` changes that). If an
earlier rulings file exists, pass it with `--rulings`. No suspects means no judges: go to step 7.

## 3. The stop: check how this session is billed

```
node <this folder>/route.js
```

It prints `{ "route", "why" }`.

- **`plan`:** go on, with no stop and no question. Judges run on the Claude plan's allowance.
- **`api`:** stop. Judges would be billed per token, so the person decides. Say why (`why`), how many
  cases, and that it takes three judges. Quote a price only from today's published prices. If they
  say no, skip to step 7 and say the doubts were left open.
- **`unknown`:** stop and ask once whether this login is a Claude plan or billed through the API. If
  they say a plan, run `node <this folder>/route.js --confirm-plan`, which remembers it for this
  account, and go on. If it is the API, or they are not sure, treat it as `api`.

Never get around this stop, and never change a setting so that it passes. A plan past its limit may
draw on usage credits if the person turned them on, and this check cannot see that. If the session
is short of allowance, say so instead of starting judges.

Outside Claude Code nothing runs judges: the harness calls no model, so a CI job just reports the
suspects it finds.

## 4. Write the questions

```
wfeval judges --config <config> --key <key> --rulings <pending file> --write-cases <new cases file>
```

Then write one packet file holding, for every record in the cases:

- the project's own rules: what each value means, from its prompt, config or docs
- the record's source text
- `listed`: what the key already lists for that record
- the questions, exactly as the cases file gives them

Keep out everything that would steer a reader: the runs' outputs, confidences, the ranking, the
suspects report, notes, and anything from earlier rulings or reviews. The rules must come from the
project, not from the rulings you are testing against.

## 5. Run three judges

Start three agents in one message so that none can see another: `subagent_type: general-purpose`,
`model: haiku`, each with its own name and answers file. Tell each one to read only `JUDGE.md` in
this folder and the packet, and to write its answers to its file. One agent reads every case, so a
long list still costs three agents, not one agent per case.

Haiku is the default because in the blind test below it did no worse than Sonnet.

## 6. Turn the answers into rulings

```
wfeval judges --config <config> --rulings <pending file> --write-rulings <new judged file> <a.json> <b.json> <c.json>
```

Only a unanimous panel decides, and each decision is marked as an AI judge's. A split, or a judge who
gave no answer, stays pending. Then score again with `--rulings <judged file>`.

The answer key file is never changed. Decisions already made by a person are carried over as written:
a panel answers what was open and overrules nobody.

## 7. Report

Lead with the official result from step 1. Then, separately and labelled as AI judgment: what the
panel decided, the numbers with its decisions, and how many doubts stayed open. Say that AI judges
made these decisions. Never let a judged number take the place of the official one, and never run a
gate on it.

**Why the judges advise and do not decide.** In a blind test on 25 real rulings a person had made, a
unanimous Sonnet panel matched the person on 14 of 24 decisions and a unanimous Haiku panel on 15 of
21, while answering "no" every time would have matched 16 of 25. Three judges agreeing is not
evidence that they are right: they share blind spots. These 25 were the hard, borderline cases, so
the test says little about easy ones, but it is the only measurement there is.

## What judges do not replace

- `wfeval estimate` depends on a person's independent checks: its guarantee does not survive an AI
  judge checking an AI judge.
- Free-text grading has no judge path yet. `wfeval grade` is still done by a reviewer. A grades file
  written by an AI judge can say so (`"reviewer_kind": "judge"`), and reports will label it.
