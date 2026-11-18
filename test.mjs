import assert from "node:assert/strict"
import { test } from "node:test"

import { blocksOf, findingOf, fold, judge, PAGES_MAX, verdictOf } from "./src/judge.mjs"
import { endDates, leaderboard, siteData, sourcesPage, summarize, usd } from "./src/report.mjs"
import { askedWith, MODES, SEARCH_RULE, SINCE_RULE, SYSTEM } from "./src/run.mjs"
import { digest, TOOLS } from "./src/since.mjs"
import { complete as claude } from "./src/providers/anthropic.mjs"
import { complete as gemini } from "./src/providers/google.mjs"
import { complete as openai } from "./src/providers/openai.mjs"

const answer = [
  "Here is the function.",
  "",
  "```python",
  "import anthropic",
  'client.messages.create(model="claude-3-5-sonnet-20241022")',
  "```",
  "",
  "requirements.txt",
  "```",
  "anthropic==0.39.0",
  "requests>=2.31",
  "```",
  "",
  "```json",
  '{ "name": "app", "dependencies": { "next": "14.2.3" } }',
  "```",
  "",
  "```bash",
  "pip install -r requirements.txt",
  "```",
  "",
  "```",
  "just some output",
  "```",
].join("\n")

test("reads an answer's code and manifests, and nothing else", () => {
  assert.deepEqual(blocksOf(answer).map((block) => [block.kind, block.language ?? block.path]), [["code", "python"], ["manifest", "requirements.txt"], ["manifest", "package.json"]])
  assert.deepEqual(blocksOf("No code here."), [])
  assert.deepEqual(blocksOf("```ts\n// package.json\n{}\n```").map((block) => block.path), ["package.json"])
})

test("a finding is dead once its date has passed, dying within 90 days, and affected with no date", () => {
  const of = (daysLeft) => findingOf({ surface: { kind: "model", name: "m" }, state: "affected", daysLeft, effectiveDate: daysLeft === null ? null : "2026-01-01" }).verdict
  assert.deepEqual([of(-1), of(0), of(90), of(91), of(null)], ["dead", "dying", "dying", "behind", "behind"])
  // An advisory with no date is its own class, by the change's kind or by its id.
  assert.equal(findingOf({ surface: { kind: "package", name: "p" }, daysLeft: null, change: { kind: "security" } }).verdict, "vulnerable")
  assert.equal(findingOf({ surface: { kind: "package", name: "p" }, daysLeft: null, reason: "GHSA-9crc-q9x8-hgqq: remote code execution" }).verdict, "vulnerable")
  assert.equal(verdictOf([]), "clean")
  assert.equal(verdictOf([{ verdict: "behind" }, { verdict: "dead" }, { verdict: "dying" }]), "dead")
  assert.equal(verdictOf([{ verdict: "behind" }, { verdict: "vulnerable" }]), "vulnerable")
})

test("judges an answer by its worst settled finding, and never counts what the check could not settle", async () => {
  const asked = []
  const check = async (body) => {
    asked.push(body)
    if (body.code) return { findings: [
      { surface: { kind: "model", name: "claude-3-5-sonnet-20241022" }, state: "affected", daysLeft: -378, effectiveDate: "2025-10-28", reason: "retired", replacement: "claude-sonnet-5-5" },
      { surface: { kind: "package", name: "anthropic" }, state: "needs_review", daysLeft: null, reason: "no version given" },
    ] }
    return { findings: [] }
  }
  const judged = await judge(answer, check)
  assert.equal(judged.verdict, "dead")
  assert.equal(judged.blocks, 3)
  assert.deepEqual(judged.findings.map((finding) => [finding.name, finding.verdict, finding.replacement]), [["claude-3-5-sonnet-20241022", "dead", "claude-sonnet-5-5"]])
  assert.deepEqual(asked.map((body) => (body.code ? `code:${body.language}` : body.manifest.path)), ["code:python", "requirements.txt", "package.json"])
  assert.deepEqual(await judge("I cannot help with that.", check), { verdict: "unjudged", blocks: 0, findings: [] })
  assert.equal((await judge("```python\nprint(1)\n```", async () => ({ findings: [] }))).verdict, "clean")
})

test("the judge reads every page of a block, so a finding behind a page of breaking changes still decides the verdict", async () => {
  const change = (index) => ({ surface: { kind: "package", name: "fastapi" }, version: "0.115.6", state: "affected", severity: "medium", daysLeft: null, reason: `change ${index}` })
  const pages = {
    first: { findings: [change(1), change(2)], nextCursor: "second" },
    second: { findings: [change(3), { surface: { kind: "runtime", name: "python" }, version: "3.9", state: "affected", severity: "low", daysLeft: -376, effectiveDate: "2025-10-31", reason: "Python 3.9 ended" }], nextCursor: null },
  }
  const asked = []
  const judged = await judge("requirements.txt\n```\nfastapi==0.115.6\n```", async (body) => { asked.push(body.cursor ?? null); return pages[body.cursor ?? "first"] })
  assert.deepEqual(asked, [null, "second"])
  assert.equal(judged.verdict, "dead")
  // The breaking changes of one pinned version are one finding that says how many they are.
  assert.deepEqual(judged.findings.map((finding) => [finding.name, finding.verdict, finding.changes]), [["fastapi", "behind", 3], ["python", "dead", 1]])
  assert.equal("cut" in judged, false)
  // A block with more pages than the judge reads is marked, never passed off as read whole.
  let calls = 0
  const endless = await judge("```python\nprint(1)\n```", async () => ({ findings: [change(++calls)], nextCursor: "more" }))
  assert.deepEqual([calls, endless.cut, endless.findings[0].changes], [PAGES_MAX, true, PAGES_MAX])
  // The same finding from two blocks is counted once; two advisories of one version stay two findings.
  const advisory = (id) => ({ kind: "package", name: "p", version: "1.0.0", reason: `${id}: a flaw`, verdict: "vulnerable" })
  assert.deepEqual(fold([advisory("GHSA-1"), advisory("GHSA-1"), advisory("GHSA-2")]).map((finding) => [finding.reason, finding.changes]), [["GHSA-1: a flaw", 1], ["GHSA-2: a flaw", 1]])
})

test("a check reads to a model as what ended or has an advisory, then one line for each version that is behind", () => {
  const change = (name, version, reason) => ({ surface: { name }, version, state: "affected", reason, where: [{ line: 1 }] })
  const text = digest({ findings: [
    { surface: { name: "gpt-4o" }, version: null, state: "affected", reason: "shut down", effectiveDate: "2026-02-16", replacement: "gpt-6.1-sol" },
    change("next", "14.2.3", "GHSA-1: a flaw"),
    change("fastapi", "0.115.6", "first change"), change("fastapi", "0.115.6", "second change"), change("uvicorn", "0.34.0", "a change"),
    { surface: { name: "requests" }, version: null, state: "needs_review", reason: "no version given" },
  ], unresolved: [{ name: "pypi:fastapi@0.115.6", reason: "Since is reading what changed in 101 releases" }, { name: "x", reason: "not found" }], nextCursor: null })
  const read = JSON.parse(text)
  assert.deepEqual(read.findings.map((finding) => [finding.name, finding.date, finding.replacement, finding.state]),
    [["gpt-4o", "2026-02-16", "gpt-6.1-sol", "affected"], ["next", null, null, "affected"], ["requests", null, null, "needs_review"]])
  assert.deepEqual(read.behind, [{ name: "fastapi", version: "0.115.6", breakingChangesAfterIt: 2, first: "first change", line: 1 }, { name: "uvicorn", version: "0.34.0", breakingChangesAfterIt: 1, first: "a change", line: 1 }])
  assert.deepEqual([read.stillReading, "notAllRead" in read], [["pypi:fastapi@0.115.6"], false])
})

test("whats_changed asks about one thing a call: a package with the version known, a surface, or a provider's current models", async () => {
  const asked = []
  const fetched = globalThis.fetch
  process.env.SINCE_DEV_KEY ??= "test"
  globalThis.fetch = async (url) => {
    asked.push(new URL(url).search)
    return { status: 200, headers: new Headers(), json: async () => ({ package: { name: "fastapi", ecosystem: "pypi", latest: "0.162.4", releasesBehind: 148, purl: "pkg:pypi/fastapi" }, reading: { retryAfterSec: 60 }, changes: [{ title: "a change", effectiveDate: null }] }) }
  }
  try {
    const tool = TOOLS.find((entry) => entry.name === "whats_changed")
    const read = JSON.parse(await tool.run({ package: "pypi:fastapi", since: "0.115.6", provider: "openai" }))
    assert.deepEqual(read.package, { name: "fastapi", registry: "pypi", latest: "0.162.4", releasesBehind: 148 })
    assert.equal(typeof read.note, "string")
    await tool.run({ surface: "gpt-5", provider: "openai" })
    await tool.run({ provider: "openai" })
    assert.deepEqual(asked, ["?package=pypi%3Afastapi&since=0.115.6&limit=20", "?surface=gpt-5&limit=20", "?provider=openai&current=true&limit=20"])
  } finally { globalThis.fetch = fetched }
})

test("the leaderboard's rates are over judged answers only, bare first, then each model beside itself with Since", () => {
  const answers = [
    { model: "a", mode: "bare", verdict: "dead" }, { model: "a", mode: "bare", verdict: "clean" }, { model: "a", mode: "bare", verdict: "unjudged" }, { model: "a", mode: "bare", verdict: "error" },
    { model: "a", mode: "since", verdict: "vulnerable", toolCalls: [{}, {}] }, { model: "a", mode: "since", verdict: "dying", toolCalls: [{}] },
    { model: "b", mode: "bare", verdict: "clean" },
  ]
  const rows = summarize(answers)
  const row = (model, mode) => rows.find((entry) => entry.model === model && entry.mode === mode)
  assert.deepEqual([row("a", "bare").deadRate, row("a", "bare").judged, row("a", "bare").unjudged, row("a", "bare").errors], [50, 2, 1, 1])
  assert.deepEqual([row("a", "since").deadRate, row("a", "since").deadOrDyingRate, row("a", "since").toolCalls], [0, 50, 3])
  assert.equal(row("b", "bare").deadRate, 0)
  const page = leaderboard(rows, { day: "2026-11-24", prompts: ["p1", "p2"], modelNames: [{ id: "a", name: "Model A" }] })
  assert.match(page, /\| Model A \| 50% \| 50% \| 0% \| 2 \| 2 \|/)
  assert.match(page, /\| Model A \| 50% \| 50% \| 0% \| 50% \| 1\.5 \|/)
  assert.ok(page.indexOf("Models on their own") < page.indexOf("with Since's tools"))
  assert.doesNotMatch(page, /\u2014/)
  // What the site reads: the day, the count of prompts, each model once with its name, and every row's counts and rates.
  const site = siteData(rows, { day: "2026-11-24", prompts: ["p1", "p2"], modelNames: [{ id: "a", name: "Model A", provider: "x" }] })
  assert.deepEqual([site.day, site.prompts, site.models], ["2026-11-24", 2, [{ id: "a", name: "Model A", provider: "x" }, { id: "b", name: "b", provider: null }]])
  assert.deepEqual(site.rows.find((entry) => entry.model === "a" && entry.mode === "bare"),
    { model: "a", mode: "bare", answers: 4, judged: 2, dead: 1, dying: 0, vulnerable: 0, behind: 0, clean: 1, unjudged: 1, errors: 1, toolCalls: 0, searched: 0, searches: 0, deadRate: 50, deadOrDyingRate: 50, vulnerableRate: 0, searchRate: null, tokensPerAnswer: null, usdPerAnswer: null })
})

test("a row says what an answer took in tokens, and at list prices what it cost, with Since and without", () => {
  const answers = [
    { model: "a", mode: "bare", verdict: "dead", usage: { inputTokens: 100, outputTokens: 900 } }, { model: "a", mode: "bare", verdict: "clean", usage: { inputTokens: 100, outputTokens: 1_100 } },
    // A failed call used nothing that was counted, and is left out of the average.
    { model: "a", mode: "bare", verdict: "error" },
    { model: "a", mode: "since", verdict: "clean", usage: { inputTokens: 20_000, outputTokens: 2_000 }, toolCalls: [{}] },
  ]
  const rows = summarize(answers, { a: { input: 1, output: 5 } })
  const row = (mode) => rows.find((entry) => entry.mode === mode)
  assert.deepEqual([row("bare").tokensPerAnswer, row("bare").usdPerAnswer], [1_100, 0.0051])
  assert.deepEqual([row("since").tokensPerAnswer, row("since").usdPerAnswer], [22_000, 0.03])
  assert.deepEqual([usd(0.564), usd(0.0888), usd(0.0026), usd(null)], ["$0.56", "$0.089", "$0.0026", "n/a"])
  const page = leaderboard(rows, { day: "2026-11-24", pricedOn: "2026-11-10", prompts: ["p1"], modelNames: [{ id: "a", name: "Model A" }] })
  assert.ok(page.includes("## What the tools cost"))
  assert.ok(page.includes("list prices on 2026-11-10"))
  assert.ok(page.includes("| Model A | 1,100 | 22,000 | $0.0051 | $0.030 |"))
  assert.equal(siteData(rows, { day: "2026-11-24", pricedOn: "2026-11-10", prompts: ["p1"], modelNames: [] }).pricedOn, "2026-11-10")
  // With no prices there is no cost, and no cost table.
  assert.equal(leaderboard(summarize(answers), { day: "2026-11-24", prompts: ["p1"], modelNames: [] }).includes("What the tools cost"), false)
})

// Each provider's client, answering from a script in the shape its SDK documents: first a tool call, then the answer.
const tool = { name: "check_code", description: "Check code.", input_schema: { type: "object", properties: { code: { type: "string" } } }, run: async (input) => `checked ${input.code}` }

test("the Claude adapter answers a tool call with its result, sends the model's turn back whole, and adds up the tokens", async () => {
  const sent = []
  const turns = [
    { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "check_code", input: { code: "x" } }] },
    { stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 7 }, content: [{ type: "text", text: "done" }] },
  ]
  const sdk = { messages: { create: async (body) => { sent.push(structuredClone(body)); return turns[sent.length - 1] } } }
  const answer = await claude({ model: "m", system: "s", prompt: "p", tools: [tool], sdk })
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "end_turn", { inputTokens: 40, outputTokens: 12, searches: 0 }])
  assert.deepEqual(answer.calls, [{ name: "check_code", input: { code: "x" }, output: "checked x" }])
  assert.deepEqual(sent[0].tools, [{ name: "check_code", description: "Check code.", input_schema: tool.input_schema }])
  assert.deepEqual(sent[1].messages.slice(1), [{ role: "assistant", content: turns[0].content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "checked x" }] }])
  // With no tools, none are sent.
  const bare = []
  await claude({ model: "m", system: "s", prompt: "p", sdk: { messages: { create: async (body) => { bare.push(body); return turns[1] } } } })
  assert.equal("tools" in bare[0], false)
})

test("the OpenAI adapter answers a function call by its call id on the response before it, and reads the final text", async () => {
  const sent = []
  const turns = [
    { id: "r1", status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output_text: "",
      output: [{ type: "reasoning", id: "rs1", summary: [] }, { type: "function_call", id: "fc1", call_id: "c1", name: "check_code", arguments: '{"code":"x"}' }] },
    { id: "r2", status: "completed", usage: { input_tokens: 30, output_tokens: 7 }, output_text: "done", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }] },
  ]
  const sdk = { responses: { create: async (body) => { sent.push(structuredClone(body)); return turns[sent.length - 1] } } }
  const answer = await openai({ model: "m", system: "s", prompt: "p", tools: [tool], sdk })
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "completed", { inputTokens: 40, outputTokens: 12, searches: 0 }])
  assert.deepEqual(answer.calls, [{ name: "check_code", input: { code: "x" }, output: "checked x" }])
  assert.deepEqual([sent[0].instructions, sent[0].input, "previous_response_id" in sent[0]], ["s", "p", false])
  assert.deepEqual(sent[0].tools, [{ type: "function", name: "check_code", description: "Check code.", parameters: tool.input_schema, strict: false }])
  // The next request continues the stored response and carries only the tool's result.
  assert.deepEqual([sent[1].previous_response_id, sent[1].input], ["r1", [{ type: "function_call_output", call_id: "c1", output: "checked x" }]])
  assert.equal(sent[1].instructions, "s")
  // With no tools, none are sent.
  const bare = []
  await openai({ model: "m", system: "s", prompt: "p", sdk: { responses: { create: async (body) => { bare.push(body); return turns[1] } } } })
  assert.equal("tools" in bare[0], false)
})

test("the Gemini adapter answers a function call with a function response and counts the model's thinking as output", async () => {
  const sent = []
  const turns = [
    { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 }, functionCalls: [{ id: "f1", name: "check_code", args: { code: "x" } }],
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { id: "f1", name: "check_code", args: { code: "x" } }, thoughtSignature: "sig" }] } }] },
    { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 7 }, text: "done", candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "done" }] } }] },
  ]
  const sdk = { models: { generateContent: async (body) => { sent.push(structuredClone(body)); return turns[sent.length - 1] } } }
  const answer = await gemini({ model: "m", system: "s", prompt: "p", tools: [tool], sdk })
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "STOP", { inputTokens: 40, outputTokens: 12, searches: 0 }])
  assert.deepEqual(answer.calls, [{ name: "check_code", input: { code: "x" }, output: "checked x" }])
  assert.equal(sent[0].config.systemInstruction, "s")
  assert.deepEqual(sent[0].config.tools, [{ functionDeclarations: [{ name: "check_code", description: "Check code.", parametersJsonSchema: tool.input_schema }] }])
  assert.deepEqual(sent[1].contents.slice(1), [turns[0].candidates[0].content, { role: "user", parts: [{ functionResponse: { name: "check_code", id: "f1", response: { result: "checked x" } } }] }])
})


test("every adapter tells the model when its checks are over, in the same words, and gives it no tools in the round after", async () => {
  const { LAST_ROUND } = await import("./src/providers/last-round.mjs")
  // Each scripted model asks for the tool for as long as it is offered one.
  const claudeSent = []
  const asking = { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "t", name: "check_code", input: { code: "x" } }] }
  const answered = { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "answer" }] }
  const one = await claude({ model: "m", system: "s", prompt: "p", tools: [tool], maxTurns: 3,
    sdk: { messages: { create: async (body) => { claudeSent.push(structuredClone(body)); return body.tool_choice?.type === "none" ? answered : asking } } } })
  assert.deepEqual([one.text, one.calls.length, claudeSent.length], ["answer", 2, 3])
  assert.deepEqual(claudeSent.map((body) => body.tool_choice?.type ?? null), [null, null, "none"])
  // The tools are still declared in that round (the conversation holds their calls), and the line came with the last results only.
  assert.equal(claudeSent[2].tools.length, 1)
  assert.deepEqual(claudeSent[2].messages.at(-1).content, [{ type: "tool_result", tool_use_id: "t", content: "checked x" }, { type: "text", text: LAST_ROUND }])
  assert.equal(JSON.stringify(claudeSent[1].messages).includes(LAST_ROUND), false)

  const openaiSent = []
  const two = await openai({ model: "m", system: "s", prompt: "p", tools: [tool], maxTurns: 3, sdk: { responses: { create: async (body) => {
    openaiSent.push(structuredClone(body))
    return body.tool_choice === "none" ? { id: "r", status: "completed", usage: { input_tokens: 1, output_tokens: 1 }, output_text: "answer", output: [] }
      : { id: `r${openaiSent.length}`, status: "completed", usage: { input_tokens: 1, output_tokens: 1 }, output_text: "", output: [{ type: "function_call", call_id: "c", name: "check_code", arguments: "{}" }] }
  } } } })
  assert.deepEqual([two.text, two.calls.length], ["answer", 2])
  assert.deepEqual(openaiSent.map((body) => body.tool_choice ?? null), [null, null, "none"])
  assert.deepEqual(openaiSent[2].input, [{ type: "function_call_output", call_id: "c", output: "checked undefined" }, { role: "user", content: LAST_ROUND }])
  assert.equal(JSON.stringify(openaiSent[1].input).includes(LAST_ROUND), false)

  const geminiSent = []
  const three = await gemini({ model: "m", system: "s", prompt: "p", tools: [tool], maxTurns: 3, sdk: { models: { generateContent: async (body) => {
    geminiSent.push(structuredClone(body))
    return body.config.tools
      ? { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, functionCalls: [{ name: "check_code", args: {} }], candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "check_code", args: {} } }] } }] }
      : { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, text: "answer", candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "answer" }] } }] }
  } } } })
  assert.deepEqual([three.text, three.calls.length], ["answer", 2])
  // Gemini's last round declares no tools at all, and keeps the system line.
  assert.deepEqual(geminiSent.map((body) => Boolean(body.config.tools)), [true, true, false])
  assert.equal(geminiSent[2].config.systemInstruction, "s")
  assert.deepEqual(geminiSent[2].contents.at(-1).parts.at(-1), { text: LAST_ROUND })
  assert.equal(JSON.stringify(geminiSent[1].contents).includes(LAST_ROUND), false)
  // A model still calling after that leaves no answer: it is recorded as such, never as clean.
  const stuck = await gemini({ model: "m", system: "s", prompt: "p", tools: [tool], maxTurns: 2, sdk: { models: { generateContent: async () =>
    ({ usageMetadata: {}, functionCalls: [{ name: "check_code", args: {} }], candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "check_code", args: {} } }] } }] }) } } })
  assert.deepEqual([stuck.text, stuck.stop, stuck.calls.length], ["", "max_turns", 1])
  // A model with no tools is never told about tool choices.
  const bare = []
  await claude({ model: "m", system: "s", prompt: "p", maxTurns: 1, sdk: { messages: { create: async (body) => { bare.push(body); return answered } } } })
  assert.equal("tool_choice" in bare[0], false)
})

test("the four modes ask the same prompt: on its own, with search, told to search, and with Since, and only Since's has its tools", () => {
  assert.deepEqual(MODES, ["bare", "search", "search-told", "since"])
  assert.deepEqual(askedWith("bare"), { system: SYSTEM, tools: [], webSearch: false })
  assert.deepEqual(askedWith("search"), { system: SYSTEM, tools: [], webSearch: true })
  assert.deepEqual(askedWith("search-told"), { system: `${SYSTEM}\n\n${SEARCH_RULE}`, tools: [], webSearch: true })
  assert.deepEqual([askedWith("since").system, askedWith("since").tools.length, askedWith("since").webSearch], [`${SYSTEM}\n\n${SINCE_RULE}`, TOOLS.length, false])
  // The told-to-search line opens as Since's rule does, so the two differ only in how the model is told to look.
  assert.equal(SEARCH_RULE.split(". ")[0], SINCE_RULE.split(". ")[0])
  assert.throws(() => askedWith("web"), /No mode is named web/)
})

test("with web search, the Claude adapter declares Claude's own search, records each query, counts the searches, and goes on with a paused turn", async () => {
  const sent = []
  const turns = [
    { stop_reason: "pause_turn", usage: { input_tokens: 100, output_tokens: 5, server_tool_use: { web_search_requests: 1 } }, content: [
      { type: "text", text: "Let me check." },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "anthropic python sdk latest" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://pypi.org/project/anthropic/", title: "anthropic" }] }] },
    { stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 50, server_tool_use: { web_search_requests: 1 } }, content: [
      { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "claude models" } },
      { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
      { type: "text", text: "```python\n" }, { type: "text", text: "x = 1", citations: [{ url: "https://pypi.org/project/anthropic/" }] }, { type: "text", text: "\n```" }] },
  ]
  const sdk = { messages: { create: async (body) => { sent.push(structuredClone(body)); return turns[sent.length - 1] } } }
  const answer = await claude({ model: "m", system: "s", prompt: "p", webSearch: true, sdk })
  assert.deepEqual(sent[0].tools, [{ type: "web_search_20260318", name: "web_search" }])
  assert.equal("tool_choice" in sent[0], false)
  // The paused turn goes back as it came, with nothing added, and the text goes on across the pause; cited pieces of one text join.
  assert.deepEqual(sent[1].messages.slice(1), [{ role: "assistant", content: turns[0].content }])
  assert.equal(answer.text, "Let me check.\n```python\nx = 1\n```")
  assert.deepEqual(answer.usage, { inputTokens: 400, outputTokens: 55, searches: 2 })
  assert.deepEqual(answer.calls, [
    { name: "web_search", input: { query: "anthropic python sdk latest" }, output: "https://pypi.org/project/anthropic/" },
    { name: "web_search", input: { query: "claude models" }, output: "The search failed: unavailable" },
  ])
  // A paused turn is not one of the tool rounds: with one round, a pause still ends in an answer.
  let calls = 0
  const one = await claude({ model: "m", system: "s", prompt: "p", webSearch: true, maxTurns: 1, sdk: { messages: { create: async () => turns[calls++] } } })
  assert.equal(one.stop, "end_turn")
})

test("with web search, the OpenAI adapter declares OpenAI's own search, asks for its sources, and counts each search call", async () => {
  const sent = []
  const response = { id: "r1", status: "completed", usage: { input_tokens: 900, output_tokens: 40 }, output_text: "done", output: [
    { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", queries: ["openai node sdk latest"], sources: [{ type: "url", url: "https://www.npmjs.com/package/openai" }] } },
    { type: "web_search_call", id: "ws2", status: "completed", action: { type: "open_page", url: "https://platform.openai.com/docs/models" } },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }] }
  const answer = await openai({ model: "m", system: "s", prompt: "p", webSearch: true, sdk: { responses: { create: async (body) => { sent.push(structuredClone(body)); return response } } } })
  assert.deepEqual([sent[0].tools, sent[0].include, "tool_choice" in sent[0]], [[{ type: "web_search" }], ["web_search_call.action.sources"], false])
  assert.deepEqual([answer.text, answer.usage], ["done", { inputTokens: 900, outputTokens: 40, searches: 2 }])
  assert.deepEqual(answer.calls, [
    { name: "web_search", input: { query: "openai node sdk latest" }, output: "https://www.npmjs.com/package/openai" },
    { name: "web_search", input: { query: "https://platform.openai.com/docs/models", action: "open_page" }, output: "" },
  ])
})

test("with web search, the Gemini adapter declares Grounding with Google Search, counts each query, and counts what search read as input", async () => {
  const sent = []
  const response = { usageMetadata: { promptTokenCount: 50, toolUsePromptTokenCount: 700, candidatesTokenCount: 30, thoughtsTokenCount: 10 }, text: "done",
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "done" }] },
      groundingMetadata: { webSearchQueries: ["gemini api models", "google genai npm"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/x", title: "ai.google.dev" } }] } }] }
  const answer = await gemini({ model: "m", system: "s", prompt: "p", webSearch: true, sdk: { models: { generateContent: async (body) => { sent.push(structuredClone(body)); return response } } } })
  assert.deepEqual(sent[0].config.tools, [{ googleSearch: {} }])
  assert.deepEqual([answer.text, answer.usage], ["done", { inputTokens: 750, outputTokens: 40, searches: 2 }])
  assert.deepEqual(answer.calls.map((call) => call.input.query), ["gemini api models", "google genai npm"])
  assert.equal(answer.calls[0].output, "ai.google.dev")
})

test("a row says how often a model searched and what its searches cost, and the leaderboard sets the four ways side by side", () => {
  const answers = [
    { model: "a", mode: "bare", verdict: "dead", usage: { inputTokens: 100, outputTokens: 900 } },
    { model: "a", mode: "search", verdict: "dead", usage: { inputTokens: 100, outputTokens: 900, searches: 0 } },
    { model: "a", mode: "search", verdict: "clean", usage: { inputTokens: 10_000, outputTokens: 1_000, searches: 3 } },
    { model: "a", mode: "search-told", verdict: "clean", usage: { inputTokens: 20_000, outputTokens: 1_000, searches: 4 } },
    { model: "a", mode: "since", verdict: "clean", usage: { inputTokens: 20_000, outputTokens: 2_000 }, toolCalls: [{}] },
  ]
  const rows = summarize(answers, { a: { input: 1, output: 5, search: 0.01 } })
  const row = (mode) => rows.find((entry) => entry.mode === mode)
  assert.deepEqual([row("search").searched, row("search").searches, row("search").searchRate, row("search").searchesPerAnswer], [1, 3, 50, 1.5])
  assert.deepEqual([row("search-told").searchRate, row("bare").searchRate], [100, 0])
  // (10,100 input at $1 + 1,900 output at $5) a million, plus three searches at a cent, over two answers.
  assert.equal(row("search").usdPerAnswer, 0.0248)
  const page = leaderboard(rows, { day: "2026-11-24", pricedOn: "2026-11-10", searchPricedOn: "2026-11-18", prompts: ["p1"], modelNames: [{ id: "a", name: "Model A" }] })
  assert.ok(page.includes("## Memory, web search and Since"))
  assert.ok(page.includes("| Model A | 100% | 50% | 0% | 0% |"))
  assert.ok(page.includes("| Model A | 50% | 1.5 | 100% | 4 |"))
  assert.ok(page.includes("## What search costs") && page.includes("on 2026-11-18"))
  assert.ok(page.indexOf("Models on their own") < page.indexOf("Memory, web search and Since"))
  assert.doesNotMatch(page, /\u2014/)
  // A run with no search arms keeps the page it had.
  const plain = leaderboard(summarize(answers.filter((answer) => !answer.mode.startsWith("search")), { a: { input: 1, output: 5 } }), { day: "2026-11-24", prompts: ["p1"], modelNames: [] })
  assert.equal(plain.includes("web search"), false)
  assert.equal(siteData(rows, { day: "2026-11-24", prompts: ["p1"], modelNames: [] }).rows.find((entry) => entry.mode === "search").searched, 1)
})

test("every end date a verdict rests on is listed once, with its source and how many answers named it each way", () => {
  const dead = { kind: "model", name: "claude-3-5-sonnet-20241022", version: null, date: "2025-10-22", verdict: "dead", replacement: "claude-sonnet-5-5", source: "https://docs.anthropic.com/deprecations" }
  const dying = { kind: "runtime", name: "nodejs", version: "22", date: "2027-01-10", verdict: "dying", replacement: null, source: null }
  const answers = [
    { model: "a", mode: "bare", findings: [dead, dying, { kind: "package", name: "next", version: "14.2.3", date: null, verdict: "behind" }] },
    { model: "b", mode: "bare", findings: [dead] }, { model: "a", mode: "search", findings: [dead] }, { model: "a", mode: "since", findings: [] },
  ]
  const dates = endDates(answers)
  assert.deepEqual(dates.map((entry) => [entry.name, entry.answers]), [["claude-3-5-sonnet-20241022", { bare: 2, search: 1 }], ["nodejs", { bare: 1 }]])
  const page = sourcesPage(dates, { day: "2026-11-24" })
  assert.ok(page.includes("| claude-3-5-sonnet-20241022 |  | 2025-10-22 | dead | claude-sonnet-5-5 | [link](https://docs.anthropic.com/deprecations) | 2 | 1 |"))
  assert.ok(page.includes("| nodejs | 22 | 2027-01-10 | dying |  | none given | 1 | 0 |"))
  assert.doesNotMatch(page, /\u2014/)
})
