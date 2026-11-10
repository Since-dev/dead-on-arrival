# Dead on arrival

How often does a coding model write code that is already retired, or about to be, on the day it writes it?

A model writes the model IDs, versions and API calls that were current when it was trained. Some of those have ended since. This benchmark asks coding models for ordinary code, then checks each answer against what has changed as of the day of the run.

## What a run does

1. **60 prompts** (`prompts.json`): everyday requests that need a model ID or pinned versions. Call Claude, OpenAI, Gemini or Mistral from Python, TypeScript and Go; call a model on Amazon Bedrock, Azure OpenAI or Vertex AI; write a `package.json` or a `requirements.txt` with exact versions.
2. **Each model answers each prompt twice:**
   - **on its own:** the prompt and a short system line, nothing else;
   - **with Since:** the same, plus two tools (`whats_changed` and `check_code`) and one rule: read what is current before you write a model ID or a version, and check the code before you answer.
     A model may call the tools for seven rounds. With the results of its last calls it is told, in the same words for every provider, that its checks are over, and the round after has no tools. So a model that keeps checking still gives an answer that can be judged.
3. **The judge reads every answer.** Each fenced code block goes to Since's check (`POST /v1/check`): a snippet with its language, a manifest with its file name. Only findings the check settled count. A finding it could not settle, such as a package named with no version, never counts.

## How an answer is counted

An answer counts once, by the worst thing in it:

| Verdict | Meaning |
|---|---|
| `dead` | It names a model, API or version whose end date had passed on the day of the run. |
| `dying` | It ends within 90 days of the run. |
| `vulnerable` | It pins a version a published security advisory applies to. |
| `behind` | Anything else the check settled: an end date further out, or breaking changes between the pinned version and today's. |
| `clean` | None of the above. |

An answer with no code block, or a call that failed, is `unjudged` or `error`. It is listed beside the rates and left out of them, never counted as clean.

The headline number is **dead on arrival**: the share of judged answers that are `dead`.

## What is published with a run

Everything, in `results/<day>/`:

- `run.json`: the day, the models, the prompts, the exact system line and rule.
- `answers/<model>/<mode>/<prompt>.json`: the full answer, every tool call with its input and output, the tokens used, and each finding with its date, replacement and source.
- `summary.json` and `LEADERBOARD.md`: the table.

## Run it

Node 20 or newer.

```bash
npm install
```

```bash
export SINCE_DEV_KEY=...        # the judge and the tools (npx since-dev login); a free key is enough for a small run
export ANTHROPIC_API_KEY=...    # each provider you want to run
export OPENAI_API_KEY=...
export GEMINI_API_KEY=...
```

```bash
node src/run.mjs --prompts 5 --max-usd 2
```

```bash
node src/run.mjs --max-usd 50
```

```bash
node src/report.mjs results/2026-11-24
```

Add `--site <file>` to also write the table as JSON, as the page at since.dev/dead-on-arrival reads it.

- `--models id,id` runs only those models from `models.json`.
- `--prompts 5` runs five prompts spread over every area; `--prompts claude-01,npm-03` runs those.
- `--modes bare` or `--modes since` runs one half.
- `--max-usd` stops the run before it spends more. The count uses the rates in `models.json`, set at one and a half times list prices on purpose: they are a guard, not a price list.
- A run can be stopped and started again. An answer already in the folder is not asked for twice.

```bash
npm test
```

## What to know before you quote it

- **The judge is Since.** The same check anyone can call. Every finding carries its source link, so a verdict can be traced to the provider's or registry's own page. If you find one that is wrong, open an issue with the answer file.
- **"With Since" uses Since's own tools.** The second table shows what the tools change for the same model on the same prompts. It is not a comparison between models.
- **A full run costs real money.** The first one, 60 prompts on nine models both ways, was projected at about $60 at list prices from a two-prompt trial. Most of it is the largest models reading the tools' answers.
- **One answer a prompt.** Models are not deterministic. A rate from 60 answers moves by a few points between runs; a difference of one or two answers is not a finding.
- **The day matters.** An answer that is clean today can be dead next month. Every result names the day it was judged, and the run is meant to be repeated.
- **Prompts ask for exact versions.** That is what a manifest needs, and it is what shows whether a model knows today's versions.

## Add a provider

A provider is one file in `src/providers/` that exports `complete({ model, system, prompt, tools })` and returns the answer's text, the tool calls made and the tokens used. There are three: Claude (`anthropic.mjs`, the Messages API), OpenAI (`openai.mjs`, the Responses API) and Gemini (`google.mjs`), each through its maker's own SDK. Each one ends a model's checks the same way (`last-round.mjs`). Add a provider to `PROVIDERS` and `KEYS` in `src/run.mjs`, and its models to `models.json`.

The tests (`npm test`) run every adapter against a scripted client, so the tool loop is checked without a key.

MIT License.
