// The judge: what in an answer is already dead, or about to be, on the day of the run.
//
// An answer's fenced code blocks are sent to Since's check (POST /v1/check), one block a call: a snippet with its language, a manifest
// with its file name. A finding counts only when the check settled it (`state: "affected"`); one it could not settle (a package with no
// version given) never counts. The verdict of an answer is its worst finding:
//   dead        a model, API, runtime or version the code names ended before the day of the run
//   dying       it ends within `DYING_DAYS` of the run
//   vulnerable  it pins a version a published security advisory applies to
//   behind      anything else the check settled: an end date further out, or a pinned version with breaking changes between it and today's
//   clean       nothing of the above
//
// The check answers a page of findings at a time, the most severe first, and severity is not the order above: a version line that ended
// can sit behind hundreds of breaking changes. So the judge reads every page of a block before it decides.

export const DYING_DAYS = 90
/** The most pages of one block the judge reads (500 findings a page). A block with more is marked `cut`, never passed off as read whole. */
export const PAGES_MAX = 20

/** A fence's info string to what the check reads it as: a snippet's language, or a manifest's file name. */
const LANGUAGES = {
  py: "python", python: "python", python3: "python",
  ts: "typescript", typescript: "typescript", tsx: "typescript",
  js: "javascript", javascript: "javascript", jsx: "javascript", mjs: "javascript", node: "javascript",
  go: "go", golang: "go", rb: "ruby", ruby: "ruby", rs: "rust", rust: "rust", php: "php", java: "java",
  cs: "csharp", csharp: "csharp", "c#": "csharp",
}
const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Gemfile", "Cargo.toml", "composer.json"]
const SHELLS = ["bash", "sh", "shell", "zsh", "console", "terminal", "powershell", "cmd", "fish"]

/**
 * The blocks of an answer the check can read. A manifest is known by its file name: in the fence's info string
 * (```json package.json), on the line before the fence, or in a first-line comment. A JSON block with "dependencies" is a
 * package.json, and a text block of `name==version` lines is a requirements.txt, since answers often leave the name out.
 */
export function blocksOf(answer) {
  const blocks = []
  // The line before a fence is kept: an answer often names a manifest there. A fence may also open the answer.
  const fence = /(?:^|\n)(?:([^\n`]*)\n)?```([^\n`]*)\n([\s\S]*?)\n```(?=\n|$)/g
  for (const match of String(answer).matchAll(fence)) {
    const before = (match[1] ?? "").trim()
    const info = match[2].trim()
    const content = match[3]
    if (!content.trim()) continue
    const firstLine = content.split("\n", 1)[0]
    const word = info.split(/\s+/)[0].toLowerCase()
    // A shell block that mentions a manifest (`pip install -r requirements.txt`) is a command, not the manifest.
    if (SHELLS.includes(word)) continue
    // Named in the fence, on the line before it, or in a comment on its first line.
    const named = MANIFESTS.find((name) => info.includes(name) || before.includes(name) || (/^\s*(?:#|\/\/|<!--)/.test(firstLine) && firstLine.includes(name)))
    if (named) blocks.push({ kind: "manifest", path: named, content })
    else if (word === "json" && /"(?:dev)?[dD]ependencies"\s*:/.test(content)) blocks.push({ kind: "manifest", path: "package.json", content })
    else if ((word === "" || word === "text" || word === "txt") && isRequirements(content)) blocks.push({ kind: "manifest", path: "requirements.txt", content })
    else if (LANGUAGES[word]) blocks.push({ kind: "code", language: LANGUAGES[word], content })
  }
  return blocks
}

function isRequirements(content) {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  return lines.length > 0 && lines.every((line) => /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[^\]]+\])?\s*(?:[=<>~!]=?|===)\s*[0-9]/.test(line))
}

/** One finding as the results keep it: what it is, when it ends, and where the check found it. */
export function findingOf(finding) {
  const days = typeof finding.daysLeft === "number" ? finding.daysLeft : null
  return {
    kind: finding.surface?.kind ?? "unknown",
    name: finding.surface?.name ?? "",
    version: finding.version ?? null,
    reason: String(finding.reason ?? "").slice(0, 300),
    replacement: finding.replacement ?? null,
    date: finding.effectiveDate ?? null,
    daysLeft: days,
    severity: finding.severity ?? "unknown",
    source: finding.source?.url ?? finding.change?.source?.url ?? null,
    verdict: days !== null && days < 0 ? "dead" : days !== null && days <= DYING_DAYS ? "dying" : isAdvisory(finding) ? "vulnerable" : "behind",
  }
}

/** A security advisory: the change says so, or the finding is named by an advisory id. */
const isAdvisory = (finding) => finding.change?.kind === "security" || /^(?:GHSA|CVE|PYSEC|RUSTSEC|GO|OSV|MAL)-/i.test(String(finding.reason ?? ""))

const ORDER = ["clean", "behind", "vulnerable", "dying", "dead"]

/** An answer's verdict: its worst finding's. */
export function verdictOf(findings) {
  return findings.reduce((worst, finding) => (ORDER.indexOf(finding.verdict) > ORDER.indexOf(worst) ? finding.verdict : worst), "clean")
}

/** Every finding of one block: the check's pages, followed by their cursor to the end. */
async function findingsOf(body, check) {
  const found = []
  let cursor = null
  for (let page = 0; page < PAGES_MAX; page++) {
    const answered = await check({ ...body, detail: "full", ...(cursor ? { cursor } : {}) })
    found.push(...(answered.findings ?? []))
    cursor = answered.nextCursor ?? null
    if (!cursor) return { found, cut: false }
  }
  return { found, cut: true }
}

/**
 * The findings as a run keeps them. One that ended, is ending or has an advisory is kept by itself. The breaking changes between a
 * pinned version and today's are one finding a version: the first of them, with `changes` saying how many there are, since a version a
 * few years old has hundreds.
 */
export function fold(findings) {
  const kept = new Map()
  const seen = new Set()
  for (const finding of findings) {
    const one = `${finding.kind}\0${finding.name}\0${finding.version}\0${finding.reason}`
    // The same thing named in two blocks is one finding.
    if (seen.has(one)) continue
    seen.add(one)
    const key = finding.verdict === "behind" && finding.version ? `${finding.kind}\0${finding.name}\0${finding.version}\0behind` : one
    const first = kept.get(key)
    if (first) first.changes++
    else kept.set(key, { ...finding, changes: 1 })
  }
  return [...kept.values()]
}

/**
 * Checks one answer. `check(body)` posts to Since's check and returns the parsed answer, or throws; an answer with no block the check
 * can read is `unjudged`, never clean, and is left out of every rate.
 */
export async function judge(answer, check) {
  const blocks = blocksOf(answer)
  if (!blocks.length) return { verdict: "unjudged", blocks: 0, findings: [] }
  const findings = []
  let cut = false
  for (const block of blocks) {
    const body = block.kind === "manifest" ? { manifest: { path: block.path, content: block.content } } : { code: block.content, language: block.language }
    const read = await findingsOf(body, check)
    cut ||= read.cut
    for (const finding of read.found) if (finding.state === "affected") findings.push(findingOf(finding))
  }
  const unique = fold(findings)
  return { verdict: verdictOf(unique), blocks: blocks.length, findings: unique, ...(cut ? { cut: true } : {}) }
}
