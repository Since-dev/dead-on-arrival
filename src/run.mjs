// The run: every model answers every prompt twice, bare and with Since's tools, and the judge reads each answer.
//
//   node src/run.mjs [--models id,id] [--prompts 5 | id,id] [--modes bare,since] [--max-usd 50] [--out results/2026-11-24] [--concurrency 4]
//   node src/run.mjs --rejudge --out results/2026-11-24     the judge reads the stored answers again; no model is asked
//
// Needs SINCE_DEV_KEY (the judge and the tools) and each provider's own key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY). A run can be stopped and started
// again: an answer already in the output folder is not asked for twice.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { judge } from "./judge.mjs"
import { check, TOOLS } from "./since.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PROVIDERS = {
  anthropic: () => import("./providers/anthropic.mjs"),
  openai: () => import("./providers/openai.mjs"),
  google: () => import("./providers/google.mjs"),
}
const KEYS = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY" }

export const SYSTEM = "You are a coding assistant. Answer with the complete code in fenced code blocks, each with its language. Put a manifest (package.json, requirements.txt) in its own block with its file name on the line before it. Keep explanations to a few lines."
/** What the "with Since" run adds: the tools, and the rule Since's own setup gives a coding agent. */
export const SINCE_RULE = "Your knowledge of packages, AI models and APIs stops at your training. Before you write a model ID or pin a version, read what is current with whats_changed, and check the code you are about to give with check_code. Fix what the check finds before you answer."

function args(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index++) if (argv[index].startsWith("--")) out[argv[index].slice(2)] = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? "true" : argv[++index]
  return out
}

async function main() {
  const options = args(process.argv.slice(2))
  const today = new Date().toISOString().slice(0, 10)
  const out = join(ROOT, options.out ?? `results/${today}`)
  const maxUsd = Number(options["max-usd"] ?? 50)
  const modes = (options.modes ?? "bare,since").split(",")
  const allPrompts = JSON.parse(readFileSync(join(ROOT, "prompts.json"), "utf8"))
  const wanted = options.prompts
  const prompts = !wanted ? allPrompts : /^\d+$/.test(wanted) ? spread(allPrompts, Number(wanted)) : allPrompts.filter((prompt) => wanted.split(",").includes(prompt.id))
  const listed = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8")).models
  const models = listed.filter((model) => (!options.models || options.models.split(",").includes(model.id)) && PROVIDERS[model.provider] && (options.rejudge || process.env[KEYS[model.provider]]))
  if (!models.length) throw new Error("No model to run: set a provider's key (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) and name models that models.json lists.")
  if (!prompts.length) throw new Error("No prompt matched --prompts.")

  const jobs = []
  for (const model of models) for (const mode of modes) for (const prompt of prompts) jobs.push({ model, mode, prompt, file: join(out, "answers", model.id, mode, `${prompt.id}.json`) })
  const concurrency = Math.max(1, Number(options.concurrency ?? 4))
  if (options.rejudge) return rejudge(jobs.filter((job) => existsSync(job.file)), concurrency)
  let spent = 0, done = 0, skipped = 0, stopped = false
  const one = async (job) => {
    if (existsSync(job.file)) { skipped++; return }
    if (spent >= maxUsd) { stopped = true; return }
    const { complete } = await PROVIDERS[job.model.provider]()
    const started = Date.now()
    let record
    try {
      const answer = await complete({ model: job.model.id, prompt: job.prompt.prompt, system: job.mode === "since" ? `${SYSTEM}\n\n${SINCE_RULE}` : SYSTEM, tools: job.mode === "since" ? TOOLS : [] })
      const usd = (answer.usage.inputTokens * job.model.guardInput + answer.usage.outputTokens * job.model.guardOutput) / 1_000_000
      spent += usd
      const judged = await judge(answer.text, check)
      record = { model: job.model.id, mode: job.mode, prompt: job.prompt.id, area: job.prompt.area, askedAt: new Date(started).toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10,
        usage: answer.usage, guardUsd: Math.round(usd * 10_000) / 10_000, stop: answer.stop, toolCalls: answer.calls, answer: answer.text, ...judged }
    } catch (error) {
      // A failed call is kept as what it was, never as a clean answer; it is asked again on the next run once its file is removed.
      record = { model: job.model.id, mode: job.mode, prompt: job.prompt.id, area: job.prompt.area, askedAt: new Date(started).toISOString(), error: String(error.message ?? error).slice(0, 500), verdict: "error", findings: [] }
    }
    mkdirSync(dirname(job.file), { recursive: true })
    writeFileSync(job.file, `${JSON.stringify(record, null, 2)}\n`)
    done++
    process.stderr.write(`${String(done + skipped).padStart(4)}/${jobs.length}  ${job.model.id} ${job.mode} ${job.prompt.id}: ${record.verdict}${record.error ? ` (${record.error.slice(0, 80)})` : ""}  about $${spent.toFixed(2)} so far\n`)
  }
  let next = 0
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < jobs.length && !stopped) await one(jobs[next++]) }))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "run.json"), `${JSON.stringify({ day: today, sinceApi: process.env.SINCE_API_URL ?? "https://api.since.dev", models: models.map((model) => model.id), modes, prompts: prompts.map((prompt) => prompt.id), system: SYSTEM, sinceRule: SINCE_RULE }, null, 2)}\n`)
  process.stderr.write(`${done} answered, ${skipped} already there${stopped ? `, stopped at the $${maxUsd} guard with ${jobs.length - done - skipped} left` : ""}. Now: node src/report.mjs ${options.out ?? `results/${today}`}\n`)
}

/**
 * The judge reads each stored answer again and its verdict and findings are rewritten: for a judge that changed, or to see what a later
 * day makes of the same answers. An answer whose check fails is left as it was and counted, and the run ends with an error.
 */
async function rejudge(stored, concurrency) {
  let next = 0, done = 0, changed = 0, failed = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < stored.length) {
      const job = stored[next++]
      const { cut: _cut, ...record } = JSON.parse(readFileSync(job.file, "utf8"))
      // A failed call has no answer to judge.
      if (typeof record.answer !== "string") continue
      try {
        const judged = await judge(record.answer, check)
        if (judged.verdict !== record.verdict) changed++
        writeFileSync(job.file, `${JSON.stringify({ ...record, ...judged, judgedAt: new Date().toISOString() }, null, 2)}\n`)
        process.stderr.write(`${String(++done).padStart(4)}/${stored.length}  ${job.model.id} ${job.mode} ${job.prompt.id}: ${record.verdict === judged.verdict ? judged.verdict : `${record.verdict} -> ${judged.verdict}`}${judged.cut ? " (cut)" : ""}\n`)
      } catch (error) {
        failed++
        process.stderr.write(`${String(++done).padStart(4)}/${stored.length}  ${job.model.id} ${job.mode} ${job.prompt.id}: not judged again (${String(error.message ?? error).slice(0, 120)})\n`)
      }
    }
  }))
  process.stderr.write(`${done} judged again, ${changed} verdicts changed${failed ? `, ${failed} failed and were left as they were` : ""}.\n`)
  if (failed) process.exitCode = 1
}

/** `count` prompts spread over every area, in the file's order. */
function spread(prompts, count) {
  const step = prompts.length / Math.min(count, prompts.length)
  return Array.from({ length: Math.min(count, prompts.length) }, (_, index) => prompts[Math.floor(index * step)])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message ?? error); process.exit(1) })
