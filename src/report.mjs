// The leaderboard from a run's answers: for each model, how many of its answers were dead on arrival, bare and with Since.
//
//   node src/report.mjs results/2026-11-24
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Every answer of a run, read from its folder. */
export function readAnswers(folder) {
  const answers = []
  const root = join(folder, "answers")
  if (!existsSync(root)) return answers
  for (const model of readdirSync(root)) for (const mode of readdirSync(join(root, model))) for (const file of readdirSync(join(root, model, mode)))
    if (file.endsWith(".json")) answers.push(JSON.parse(readFileSync(join(root, model, mode, file), "utf8")))
  return answers
}

const share = (count, of) => (of === 0 ? null : Math.round((count / of) * 1000) / 10)

/** Dollars as a table shows them: a fraction of a cent keeps the digits that tell two models apart. */
export const usd = (value) => (value === null || value === undefined ? "n/a" : `$${value >= 0.1 ? value.toFixed(2) : value >= 0.01 ? value.toFixed(3) : value.toFixed(4)}`)

/**
 * One row a model and mode. Rates are over the answers the judge could read: an answer with no code block, or a call that failed, is
 * counted beside them and never as clean.
 *
 * A row also says what an answer took: its tokens, every round of a tool conversation counted as the provider bills it, and with
 * `prices` (each model's list price a million tokens, `{ id: { input, output } }`) what that cost.
 */
export function summarize(answers, prices = {}) {
  const rows = new Map()
  for (const answer of answers) {
    const key = `${answer.model}\0${answer.mode}`
    const row = rows.get(key) ?? { model: answer.model, mode: answer.mode, answers: 0, judged: 0, dead: 0, dying: 0, vulnerable: 0, behind: 0, clean: 0, unjudged: 0, errors: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, asked: 0 }
    row.answers++
    if (answer.verdict === "error") row.errors++
    else if (answer.verdict === "unjudged") row.unjudged++
    else { row.judged++; row[answer.verdict]++ }
    row.toolCalls += answer.toolCalls?.length ?? 0
    if (answer.usage) { row.asked++; row.inputTokens += answer.usage.inputTokens ?? 0; row.outputTokens += answer.usage.outputTokens ?? 0 }
    rows.set(key, row)
  }
  return [...rows.values()].map(({ asked, ...row }) => {
    const price = prices[row.model]
    return { ...row, deadRate: share(row.dead, row.judged), deadOrDyingRate: share(row.dead + row.dying, row.judged), vulnerableRate: share(row.vulnerable, row.judged),
      tokensPerAnswer: asked ? Math.round((row.inputTokens + row.outputTokens) / asked) : null,
      usdPerAnswer: asked && price ? Math.round(((row.inputTokens * price.input + row.outputTokens * price.output) / 1_000_000 / asked) * 100_000) / 100_000 : null }
  })
    .sort((a, b) => a.mode.localeCompare(b.mode) || (b.deadRate ?? -1) - (a.deadRate ?? -1) || a.model.localeCompare(b.model))
}

const percent = (value) => (value === null ? "n/a" : `${value}%`)

/** The leaderboard as Markdown: the bare table first, then each model beside itself with Since. */
export function leaderboard(rows, run) {
  const names = new Map((run.modelNames ?? []).map((model) => [model.id, model.name]))
  const name = (id) => names.get(id) ?? id
  const table = (mode) => rows.filter((row) => row.mode === mode).map((row) =>
    `| ${name(row.model)} | ${percent(row.deadRate)} | ${percent(row.deadOrDyingRate)} | ${percent(row.vulnerableRate)} | ${row.judged} | ${row.unjudged + row.errors} |`).join("\n")
  const head = "| Model | Dead on arrival | Dead, or ends within 90 days | Pins a version with a known advisory | Answers judged | Not judged |\n|---|---|---|---|---|---|"
  const both = [...new Set(rows.map((row) => row.model))].map((model) => {
    const bare = rows.find((row) => row.model === model && row.mode === "bare"), since = rows.find((row) => row.model === model && row.mode === "since")
    return bare && since ? `| ${name(model)} | ${percent(bare.deadOrDyingRate)} | ${percent(since.deadOrDyingRate)} | ${percent(bare.vulnerableRate)} | ${percent(since.vulnerableRate)} | ${since.judged ? (since.toolCalls / since.answers).toFixed(1) : "n/a"} |` : null
  }).filter(Boolean)
  const count = (value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))
  const costs = [...new Set(rows.map((row) => row.model))].map((model) => {
    const bare = rows.find((row) => row.model === model && row.mode === "bare"), since = rows.find((row) => row.model === model && row.mode === "since")
    return bare && since && bare.usdPerAnswer != null && since.usdPerAnswer != null ? `| ${name(model)} | ${count(bare.tokensPerAnswer)} | ${count(since.tokensPerAnswer)} | ${usd(bare.usdPerAnswer)} | ${usd(since.usdPerAnswer)} |` : null
  }).filter(Boolean)
  return [
    `# Dead on arrival: ${run.day}`,
    "",
    `${run.prompts.length} coding prompts, each answered by each model. An answer is dead on arrival when it names a model, API or version that had already ended on ${run.day}, as Since's check read it that day. An answer counts once, by the worst thing in it.`,
    "",
    "## Models on their own",
    "",
    head,
    table("bare"),
    ...(both.length ? ["", "## The same models with Since's tools", "", "| Model | Dead or ending, on its own | Dead or ending, with Since | Known advisory, on its own | Known advisory, with Since | Tool calls an answer |", "|---|---|---|---|---|---|", ...both] : []),
    ...(costs.length ? ["", "## What the tools cost", "", `A model reads what the tools answer, so an answer with Since takes more tokens. Tokens are an answer's input and output over every round, as the provider bills them. Cost is those tokens at list prices${run.pricedOn ? ` on ${run.pricedOn}` : ""}.`, "",
      "| Model | Tokens an answer, on its own | Tokens an answer, with Since | Cost an answer, on its own | Cost an answer, with Since |", "|---|---|---|---|---|", ...costs] : []),
    "",
    "Every answer, every tool call and every finding with its source is in `answers/`; for a published run that folder is `answers-<day>.tar.gz` on the run's release. How it is judged, and how to run it again, is in the README.",
    "",
  ].join("\n")
}

/** What the site's leaderboard page reads: the day, the prompts' count, each model's name and the rows. */
export function siteData(rows, run) {
  const names = new Map((run.modelNames ?? []).map((model) => [model.id, model]))
  const ids = [...new Set(rows.map((row) => row.model))]
  return {
    day: run.day,
    pricedOn: run.pricedOn ?? null,
    prompts: run.prompts.length,
    models: ids.map((id) => ({ id, name: names.get(id)?.name ?? id, provider: names.get(id)?.provider ?? null })),
    rows: rows.map(({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, deadRate, deadOrDyingRate, vulnerableRate, tokensPerAnswer, usdPerAnswer }) =>
      ({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, deadRate, deadOrDyingRate, vulnerableRate, tokensPerAnswer, usdPerAnswer })),
  }
}

function main() {
  const folder = join(ROOT, process.argv[2] ?? "")
  if (!process.argv[2] || !existsSync(join(folder, "run.json"))) throw new Error("Usage: node src/report.mjs results/<day> [--site <file>] (a folder a run wrote)")
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"))
  const listed = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8"))
  run.modelNames = listed.models
  run.pricedOn = listed.pricedOn ?? null
  // models.json holds each model's guard rate: its list price times `guardFactor`. An answer's cost is counted at the list price.
  const factor = listed.guardFactor ?? 1.5
  const prices = Object.fromEntries(listed.models.map((model) => [model.id, { input: model.guardInput / factor, output: model.guardOutput / factor }]))
  const rows = summarize(readAnswers(folder), prices)
  writeFileSync(join(folder, "summary.json"), `${JSON.stringify({ day: run.day, pricedOn: run.pricedOn, rows }, null, 2)}\n`)
  writeFileSync(join(folder, "LEADERBOARD.md"), leaderboard(rows, run))
  // `--site <file>` also writes what since.dev's leaderboard page reads (landing/src/generated/benchmark.json).
  const site = process.argv.indexOf("--site")
  if (site > 0 && process.argv[site + 1]) writeFileSync(process.argv[site + 1], `${JSON.stringify(siteData(rows, run), null, 2)}\n`)
  process.stdout.write(leaderboard(rows, run))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { try { main() } catch (error) { console.error(error.message ?? error); process.exit(1) } }
