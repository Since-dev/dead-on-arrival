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

/**
 * One row a model and mode. Rates are over the answers the judge could read: an answer with no code block, or a call that failed, is
 * counted beside them and never as clean.
 */
export function summarize(answers) {
  const rows = new Map()
  for (const answer of answers) {
    const key = `${answer.model}\0${answer.mode}`
    const row = rows.get(key) ?? { model: answer.model, mode: answer.mode, answers: 0, judged: 0, dead: 0, dying: 0, vulnerable: 0, behind: 0, clean: 0, unjudged: 0, errors: 0, toolCalls: 0 }
    row.answers++
    if (answer.verdict === "error") row.errors++
    else if (answer.verdict === "unjudged") row.unjudged++
    else { row.judged++; row[answer.verdict]++ }
    row.toolCalls += answer.toolCalls?.length ?? 0
    rows.set(key, row)
  }
  return [...rows.values()].map((row) => ({ ...row, deadRate: share(row.dead, row.judged), deadOrDyingRate: share(row.dead + row.dying, row.judged), vulnerableRate: share(row.vulnerable, row.judged) }))
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
    "",
    "Every prompt, every answer and every finding with its source is in `answers/`. How it is judged, and how to run it again, is in the README.",
    "",
  ].join("\n")
}

/** What the site's leaderboard page reads: the day, the prompts' count, each model's name and the rows. */
export function siteData(rows, run) {
  const names = new Map((run.modelNames ?? []).map((model) => [model.id, model]))
  const ids = [...new Set(rows.map((row) => row.model))]
  return {
    day: run.day,
    prompts: run.prompts.length,
    models: ids.map((id) => ({ id, name: names.get(id)?.name ?? id, provider: names.get(id)?.provider ?? null })),
    rows: rows.map(({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, deadRate, deadOrDyingRate, vulnerableRate }) =>
      ({ model, mode, answers, judged, dead, dying, vulnerable, behind, clean, unjudged, errors, toolCalls, deadRate, deadOrDyingRate, vulnerableRate })),
  }
}

function main() {
  const folder = join(ROOT, process.argv[2] ?? "")
  if (!process.argv[2] || !existsSync(join(folder, "run.json"))) throw new Error("Usage: node src/report.mjs results/<day> [--site <file>] (a folder a run wrote)")
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"))
  run.modelNames = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8")).models
  const rows = summarize(readAnswers(folder))
  writeFileSync(join(folder, "summary.json"), `${JSON.stringify({ day: run.day, rows }, null, 2)}\n`)
  writeFileSync(join(folder, "LEADERBOARD.md"), leaderboard(rows, run))
  // `--site <file>` also writes what since.dev's leaderboard page reads (landing/src/generated/benchmark.json).
  const site = process.argv.indexOf("--site")
  if (site > 0 && process.argv[site + 1]) writeFileSync(process.argv[site + 1], `${JSON.stringify(siteData(rows, run), null, 2)}\n`)
  process.stdout.write(leaderboard(rows, run))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { try { main() } catch (error) { console.error(error.message ?? error); process.exit(1) } }
