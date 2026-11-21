// The leaderboard from a run's answers: for each model, how many of its answers were dead on arrival on its own, with its own web
// search, told to search, and with Since; how often it searched; and every end date the judge used, with its source.
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
 * `prices` (each model's list price a million tokens and, for the search arms, a search: `{ id: { input, output, search } }`) what that cost.
 * `searched` is how many answers made at least one web search, and `searchRate` its share of the answers asked. `sources` counts the distinct
 * sources an answer's searches returned: pages for Claude and OpenAI, and for Gemini the sites its search found, since Google names a site,
 * not a page (`sourcesPerAnswer`).
 */
export function summarize(answers, prices = {}) {
  const rows = new Map()
  for (const answer of answers) {
    const key = `${answer.model}\0${answer.mode}`
    const row = rows.get(key) ?? { model: answer.model, mode: answer.mode, answers: 0, judged: 0, dead: 0, dying: 0, vulnerable: 0, behind: 0, clean: 0, unjudged: 0, errors: 0, toolCalls: 0, searched: 0, searches: 0, sources: 0, inputTokens: 0, outputTokens: 0, asked: 0 }
    row.answers++
    if (answer.verdict === "error") row.errors++
    else if (answer.verdict === "unjudged") row.unjudged++
    else { row.judged++; row[answer.verdict]++ }
    row.toolCalls += answer.toolCalls?.length ?? 0
    row.sources += new Set((answer.toolCalls ?? []).filter((call) => call.name === "web_search")
      .flatMap((call) => String(call.output ?? "").split("\n").map((line) => line.trim()).filter(Boolean))).size
    if (answer.usage) { row.asked++; row.inputTokens += answer.usage.inputTokens ?? 0; row.outputTokens += answer.usage.outputTokens ?? 0; row.searches += answer.usage.searches ?? 0; if (answer.usage.searches > 0) row.searched++ }
    rows.set(key, row)
  }
  return [...rows.values()].map(({ asked, ...row }) => {
    const price = prices[row.model]
    return { ...row, deadRate: share(row.dead, row.judged), deadOrDyingRate: share(row.dead + row.dying, row.judged), vulnerableRate: share(row.vulnerable, row.judged),
      searchRate: share(row.searched, asked), searchesPerAnswer: asked ? Math.round((row.searches / asked) * 10) / 10 : null,
      sourcesPerAnswer: asked ? Math.round((row.sources / asked) * 10) / 10 : null,
      tokensPerAnswer: asked ? Math.round((row.inputTokens + row.outputTokens) / asked) : null,
      usdPerAnswer: asked && price ? Math.round((((row.inputTokens * price.input + row.outputTokens * price.output) / 1_000_000 + row.searches * (price.search ?? 0)) / asked) * 100_000) / 100_000 : null }
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
  // The search arms, when the run had them: the dead rate each way, how often each model searched, and what searching cost.
  const of = (model, mode) => rows.find((row) => row.model === model && row.mode === mode)
  const searchModels = [...new Set(rows.filter((row) => row.mode.startsWith("search")).map((row) => row.model))]
  const ways = (rate) => searchModels.map((model) => `| ${name(model)} | ${["bare", "search", "search-told", "since"].map((mode) => percent(of(model, mode)?.[rate] ?? null)).join(" | ")} |`)
  const searching = searchModels.map((model) => `| ${name(model)} | ${["search", "search-told"].map((mode) => of(model, mode) ? `${percent(of(model, mode).searchRate)} | ${of(model, mode).searchesPerAnswer ?? "n/a"}` : "n/a | n/a").join(" | ")} |`)
  const searchCosts = searchModels.map((model) => {
    const allowed = of(model, "search"), told = of(model, "search-told")
    return allowed?.usdPerAnswer != null || told?.usdPerAnswer != null ? `| ${name(model)} | ${count(allowed?.tokensPerAnswer)} | ${count(told?.tokensPerAnswer)} | ${usd(allowed?.usdPerAnswer)} | ${usd(told?.usdPerAnswer)} |` : null
  }).filter(Boolean)
  const fourWays = "| Model | On its own | Search allowed | Told to search | With Since |\n|---|---|---|---|---|"
  return [
    `# Dead on arrival: ${run.day}`,
    "",
    `${run.prompts.length} coding prompts, each answered by each model. An answer is dead on arrival when it names a model, API or version that had already ended on ${run.day}, as Since's check read it that day. An answer counts once, by the worst thing in it.`,
    "",
    "## Models on their own",
    "",
    head,
    table("bare"),
    ...(searchModels.length ? ["", "## Memory, web search and Since",
      "", "Each model answered the same prompts four ways: on its own; with its own web search, which it chose whether to use; with the same search and one line telling it to search for what is current; and with Since's tools. Search is each maker's own: Claude's web search, OpenAI's web search and Gemini's Grounding with Google Search.",
      "", "### Dead on arrival", "", fourWays, ...ways("deadRate"),
      "", "### Dead, or ends within 90 days", "", fourWays, ...ways("deadOrDyingRate"),
      "", "### How often each model searched", "", "Searched is the share of answers that made at least one web search.", "",
      "| Model | Searched, allowed | Searches an answer, allowed | Searched, told to | Searches an answer, told to |", "|---|---|---|---|---|", ...searching] : []),
    ...(both.length ? ["", "## The same models with Since's tools", "", "| Model | Dead or ending, on its own | Dead or ending, with Since | Known advisory, on its own | Known advisory, with Since | Tool calls an answer |", "|---|---|---|---|---|---|", ...both] : []),
    ...(costs.length ? ["", "## What the tools cost", "", `A model reads what the tools answer, so an answer with Since takes more tokens. Tokens are an answer's input and output over every round, as the provider bills them. Cost is those tokens at list prices${run.pricedOn ? ` on ${run.pricedOn}` : ""}.`, "",
      "| Model | Tokens an answer, on its own | Tokens an answer, with Since | Cost an answer, on its own | Cost an answer, with Since |", "|---|---|---|---|---|", ...costs] : []),
    ...(searchCosts.length ? ["", "## What search costs", "", `A search is billed by itself (Claude $10 and OpenAI $10 per 1,000 searches, Gemini $14 per 1,000 queries${run.searchPricedOn ? ` on ${run.searchPricedOn}` : ""}), and the pages it reads are billed as input tokens. Cost an answer counts both.`, "",
      "| Model | Tokens an answer, search allowed | Tokens an answer, told to search | Cost an answer, search allowed | Cost an answer, told to search |", "|---|---|---|---|---|", ...searchCosts] : []),
    "",
    "Every end date an answer was judged by is in `SOURCES.md`, with the page it comes from, so each can be checked by hand.",
    "",
    "Every answer, every tool call and every finding with its source is in `answers/`; for a published run that folder is `answers-<day>.tar.gz` on the run's release. How it is judged, and how to run it again, is in the README.",
    "",
  ].join("\n")
}

/**
 * Every end date the judge used, once each: what ended or is ending, its date, the page the date comes from, and how many answers
 * named it each way. Dead first, then by date; so anyone can check by hand each date a verdict rests on.
 */
export function endDates(answers) {
  const dates = new Map()
  for (const answer of answers) for (const finding of answer.findings ?? []) {
    if (!finding.date || (finding.verdict !== "dead" && finding.verdict !== "dying")) continue
    const key = `${finding.kind}\0${finding.name}\0${finding.version ?? ""}\0${finding.date}`
    const entry = dates.get(key) ?? { kind: finding.kind, name: finding.name, version: finding.version ?? null, date: finding.date, verdict: finding.verdict, replacement: finding.replacement ?? null, source: finding.source ?? null, answers: {} }
    entry.answers[answer.mode] = (entry.answers[answer.mode] ?? 0) + 1
    dates.set(key, entry)
  }
  return [...dates.values()].sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "dead" ? -1 : 1) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

/** The end dates as Markdown, one row each with its source link. */
export function sourcesPage(dates, run) {
  const cell = (value) => String(value ?? "").replace(/\|/g, "\\|")
  const modes = ["bare", "search", "search-told", "since"].filter((mode) => dates.some((entry) => entry.answers[mode]))
  const label = { bare: "On its own", search: "Search allowed", "search-told": "Told to search", since: "With Since" }
  return [
    `# End dates of the run of ${run.day}`,
    "",
    `Each thing an answer named that had ended (dead) or ended within 90 days (dying) on ${run.day}, with the date and the page it comes from. The counts are how many answers named it each way.`,
    "",
    `| What | Version | Ends | Verdict | Replacement | Source | ${modes.map((mode) => label[mode]).join(" | ")} |`,
    `|---|---|---|---|---|---|${modes.map(() => "---|").join("")}`,
    ...dates.map((entry) => `| ${cell(entry.name)} | ${cell(entry.version)} | ${entry.date} | ${entry.verdict} | ${cell(entry.replacement)} | ${entry.source ? `[link](${entry.source})` : "none given"} | ${modes.map((mode) => entry.answers[mode] ?? 0).join(" | ")} |`),
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
    rows: rows.map(({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, searched, searches, deadRate, deadOrDyingRate, vulnerableRate, searchRate, searchesPerAnswer, sourcesPerAnswer, tokensPerAnswer, usdPerAnswer }) =>
      ({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, searched, searches, deadRate, deadOrDyingRate, vulnerableRate, searchRate, searchesPerAnswer, sourcesPerAnswer, tokensPerAnswer, usdPerAnswer })),
  }
}

function main() {
  const folder = join(ROOT, process.argv[2] ?? "")
  if (!process.argv[2] || !existsSync(join(folder, "run.json"))) throw new Error("Usage: node src/report.mjs results/<day> [--site <file>] (a folder a run wrote)")
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"))
  const listed = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8"))
  run.modelNames = listed.models
  run.pricedOn = listed.pricedOn ?? null
  run.searchPricedOn = listed.guardSearch?.searchPricedOn ?? null
  // models.json holds each model's guard rate: its list price times `guardFactor`. An answer's cost is counted at the list price.
  const factor = listed.guardFactor ?? 1.5
  const prices = Object.fromEntries(listed.models.map((model) => [model.id, { input: model.guardInput / factor, output: model.guardOutput / factor, search: (listed.guardSearch?.[model.provider] ?? 0) / factor }]))
  const answers = readAnswers(folder)
  const rows = summarize(answers, prices)
  const dates = endDates(answers)
  writeFileSync(join(folder, "summary.json"), `${JSON.stringify({ day: run.day, pricedOn: run.pricedOn, searchPricedOn: run.searchPricedOn, rows, endDates: dates }, null, 2)}\n`)
  writeFileSync(join(folder, "LEADERBOARD.md"), leaderboard(rows, run))
  writeFileSync(join(folder, "SOURCES.md"), sourcesPage(dates, run))
  // `--site <file>` also writes what since.dev's leaderboard page reads (landing/src/generated/benchmark.json).
  const site = process.argv.indexOf("--site")
  if (site > 0 && process.argv[site + 1]) writeFileSync(process.argv[site + 1], `${JSON.stringify(siteData(rows, run), null, 2)}\n`)
  process.stdout.write(leaderboard(rows, run))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { try { main() } catch (error) { console.error(error.message ?? error); process.exit(1) } }
