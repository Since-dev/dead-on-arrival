import assert from "node:assert/strict"
import { test } from "node:test"

import { blocksOf, findingOf, judge, verdictOf } from "./src/judge.mjs"
import { leaderboard, siteData, summarize } from "./src/report.mjs"
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
    { model: "a", mode: "bare", answers: 4, judged: 2, dead: 1, dying: 0, vulnerable: 0, behind: 0, clean: 1, unjudged: 1, errors: 1, toolCalls: 0, deadRate: 50, deadOrDyingRate: 50, vulnerableRate: 0 })
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
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "end_turn", { inputTokens: 40, outputTokens: 12 }])
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
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "completed", { inputTokens: 40, outputTokens: 12 }])
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
  assert.deepEqual([answer.text, answer.stop, answer.usage], ["done", "STOP", { inputTokens: 40, outputTokens: 12 }])
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
