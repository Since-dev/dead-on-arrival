// Since's API as the benchmark uses it: the judge's check, and the two tools a model is given in the "with Since" run.

const API = (process.env.SINCE_API_URL ?? "https://api.since.dev").replace(/\/+$/, "")

async function call(method, path, body) {
  const key = process.env.SINCE_DEV_KEY
  if (!key) throw new Error("SINCE_DEV_KEY is not set: the judge and the tools read Since's API with it.")
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "dead-on-arrival/1", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90_000),
    })
    // A rate limit or a busy moment is waited out, longer each time, for some minutes in all; anything else is the answer. The API
    // takes about two requests a second from one key, and a run's workers share it.
    if ((response.status === 429 || response.status === 503) && attempt < 30) {
      const wait = Math.min(30, (Number(response.headers.get("retry-after")) || 1) * (attempt + 1))
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      continue
    }
    const json = await response.json().catch(() => null)
    return { status: response.status, json }
  }
}

/** POST /v1/check: the findings for a snippet or a manifest, or an error that names the status. */
export async function check(body) {
  const { status, json } = await call("POST", "/v1/check", body)
  // A manifest the check does not read, or a block that is not what its fence says, is nothing to judge. A later page that is refused
  // (its cursor ran out) is an error: the block was not read whole.
  if ((status === 400 || status === 422) && !body.cursor) return { findings: [], refused: json?.message ?? String(status) }
  if (status !== 200 || !json) throw new Error(`Since's check answered ${status}${json?.message ? `: ${json.message}` : ""}`)
  return json
}

const short = (value, limit = 3_000) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}\n[cut at ${limit} characters]` : text
}

const ADVISORY = /^(?:GHSA|CVE|PYSEC|RUSTSEC|GO|OSV|MAL)-/i

/**
 * A check's answer as a model reads it. A finding with a date or an advisory is listed by itself, the most severe first, as the check
 * orders them. The breaking changes after a pinned version are one line a version, with how many there are and the first of them: a
 * version a few years old has hundreds, and listed one by one they would push every other package out of the answer.
 */
export function digest(answered) {
  const listed = []
  const behind = new Map()
  for (const finding of answered.findings ?? []) {
    const name = finding.surface?.name ?? ""
    const version = finding.version ?? null
    const dated = finding.effectiveDate ?? null
    if (finding.state !== "affected" || dated || ADVISORY.test(String(finding.reason ?? "")) || !version) {
      listed.push({ name, version, state: finding.state, reason: String(finding.reason ?? "").slice(0, 240), replacement: finding.replacement ?? null, date: dated, line: finding.where?.[0]?.line ?? null })
      continue
    }
    const key = `${name}\0${version}`
    const first = behind.get(key)
    if (first) first.breakingChangesAfterIt++
    else behind.set(key, { name, version, breakingChangesAfterIt: 1, first: String(finding.reason ?? "").slice(0, 240), line: finding.where?.[0]?.line ?? null })
  }
  const waiting = (answered.unresolved ?? []).filter((item) => /reading/i.test(String(item.reason ?? ""))).map((item) => item.name)
  return short({
    findings: listed.slice(0, 40),
    ...(listed.length > 40 ? { moreFindings: listed.length - 40 } : {}),
    ...(behind.size ? { behind: [...behind.values()] } : {}),
    ...(waiting.length ? { stillReading: waiting } : {}),
    ...(answered.nextCursor ? { notAllRead: true } : {}),
  }, 4_000)
}

/** The most pages of one check a tool call reads (500 findings a page); pages after the first are free. */
const TOOL_PAGES = 10

/** One check with every page of its findings, as far as `TOOL_PAGES`; `nextCursor` stays set when there were more. */
async function checkWhole(body) {
  const first = await check(body)
  let last = first
  for (let page = 1; page < TOOL_PAGES && last.nextCursor && !first.refused; page++) {
    last = await check({ ...body, cursor: last.nextCursor })
    first.findings = [...(first.findings ?? []), ...(last.findings ?? [])]
  }
  return { ...first, nextCursor: last.nextCursor ?? null }
}

/**
 * The tools a model has in the "with Since" run, as the hosted server names them and with the inputs it takes. Each returns text for the
 * model to read: compact, so a long list of changes does not crowd out the task.
 */
export const TOOLS = [
  {
    name: "whats_changed",
    description:
      "What changed in packages, AI models, APIs and runtimes. Your knowledge of them stops at your training, so read this before you choose a model ID or a version. Give `package` with its registry (npm:zod, pypi:fastapi) for its latest version, and add `since` with the version you know for what changed after it. Give `surface` to ask whether a model ID, API or runtime is still supported and what replaces it, such as `claude-sonnet-4-5-20250929` or `gpt-5`. Give `provider` (anthropic, openai, google, mistral) alone for the model IDs to use in new code. One of the three a call.",
    input_schema: {
      type: "object",
      properties: {
        package: { type: "string", description: "One package with its registry, such as npm:react or pypi:fastapi." },
        since: { type: "string", description: "With package: the version you know, such as 18.2.0. Lists what changed after it." },
        surface: { type: "string", description: "One model ID, API host or runtime, such as gpt-5 or python." },
        provider: { type: "string", description: "A provider whose current models to list, such as anthropic or openai." },
      },
    },
    async run(input) {
      // One subject a call, as the API takes it: a package first, then a surface, then a provider's current models.
      const query = new URLSearchParams()
      if (input.package) {
        query.set("package", String(input.package))
        if (input.since) query.set("since", String(input.since))
      } else if (input.surface) query.set("surface", String(input.surface))
      else if (input.provider) {
        query.set("provider", String(input.provider))
        query.set("current", "true")
      }
      query.set("limit", "20")
      const { status, json } = await call("GET", `/v1/changes?${query}`)
      if (status !== 200 || !json) return `Since answered ${status}${json?.message ? `: ${json.message}` : ""}`
      const found = json.package
      return short({
        ...(found ? { package: { name: found.name, registry: found.ecosystem, latest: found.latest ?? null, releasesBehind: found.releasesBehind ?? undefined } } : {}),
        ...(json.reading ? { note: "Since is still reading newer releases of this package; changes may be missing here." } : {}),
        ...(json.surface ? { surface: json.surface } : {}),
        models: json.models ?? undefined,
        changes: (json.changes ?? []).map((change) => ({ title: change.title, date: change.effectiveDate ?? null, replacement: change.replacement ?? null })),
      })
    },
  },
  {
    name: "check_code",
    description:
      "Check code or a manifest you wrote against what has changed, before you give it to the user: its model IDs, API calls, imports and pinned versions. Give `code` with `language`, or a manifest's `content` with its file name in `path` (package.json, requirements.txt, pyproject.toml). `findings` lists what has ended, is ending or has a security advisory; `behind` lists each pinned version with how many breaking changes came after it; `stillReading` names what Since has not finished reading.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "A snippet, with language." },
        language: { type: "string", description: "python, typescript, javascript, go, ruby, rust, php, java or csharp." },
        path: { type: "string", description: "A manifest's file name, with content." },
        content: { type: "string", description: "A manifest's contents, with path." },
      },
    },
    async run(input) {
      const body = input.path && input.content ? { manifest: { path: String(input.path), content: String(input.content) } } : { code: String(input.code ?? ""), language: String(input.language ?? "") }
      const answered = await checkWhole({ ...body, detail: "summary" }).catch((error) => ({ error: String(error.message ?? error) }))
      if (answered.error) return answered.error
      if (answered.refused) return `Not checked: ${answered.refused}`
      return digest(answered)
    },
  },
]
