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
    // A rate limit or a busy moment is waited out, a few times; anything else is the answer.
    if ((response.status === 429 || response.status === 503) && attempt < 4) {
      const wait = Math.min(60, Number(response.headers.get("retry-after")) || 5 * (attempt + 1))
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
  // A manifest the check does not read, or a block that is not what its fence says, is nothing to judge.
  if (status === 400 || status === 422) return { findings: [], refused: json?.message ?? String(status) }
  if (status !== 200 || !json) throw new Error(`Since's check answered ${status}${json?.message ? `: ${json.message}` : ""}`)
  return json
}

const short = (value, limit = 3_000) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}\n[cut at ${limit} characters]` : text
}

/**
 * The tools a model has in the "with Since" run, as the hosted server names them. Each returns text for the model to read:
 * compact, so a long list of changes does not crowd out the task.
 */
export const TOOLS = [
  {
    name: "whats_changed",
    description:
      "What changed in packages, APIs, AI models and runtimes. Your knowledge of them stops at your training, so read this before you choose a model ID or a version. Give `surface` to ask whether one thing is still supported and what replaces it: a model ID such as `claude-sonnet-4-5-20250929` or `gpt-5`, or a package name. Give `provider` (anthropic, openai, google, mistral) with no surface for the model IDs to use in new code.",
    input_schema: {
      type: "object",
      properties: {
        surface: { type: "string", description: "One model ID, API host, runtime or package, such as gpt-5 or pydantic." },
        provider: { type: "string", description: "A provider whose current models to list, such as anthropic or openai." },
      },
    },
    async run(input) {
      const query = new URLSearchParams()
      if (input.surface) query.set("surface", String(input.surface))
      if (input.provider) {
        query.set("provider", String(input.provider))
        if (!input.surface) query.set("current", "true")
      }
      query.set("limit", "20")
      const { status, json } = await call("GET", `/v1/changes?${query}`)
      if (status !== 200 || !json) return `Since answered ${status}${json?.message ? `: ${json.message}` : ""}`
      return short({ surface: json.surface ?? null, models: json.models ?? undefined,
        changes: (json.changes ?? []).map((change) => ({ title: change.title, date: change.effectiveDate ?? null, replacement: change.replacement ?? null })) })
    },
  },
  {
    name: "check_code",
    description:
      "Check code or a manifest you wrote against what has changed, before you give it to the user: its model IDs, API calls, imports and pinned versions. Give `code` with `language`, or a manifest's `content` with its file name in `path` (package.json, requirements.txt, pyproject.toml).",
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
      const answered = await check({ ...body, detail: "summary" }).catch((error) => ({ error: String(error.message ?? error) }))
      if (answered.error) return answered.error
      if (answered.refused) return `Not checked: ${answered.refused}`
      return short({ findings: (answered.findings ?? []).map((finding) => ({ name: finding.surface?.name, version: finding.version ?? null, state: finding.state,
        reason: finding.reason, replacement: finding.replacement ?? null, date: finding.effectiveDate ?? null, line: finding.where?.[0]?.line ?? null })) })
    },
  },
]
