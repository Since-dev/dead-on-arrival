// OpenAI through the official SDK (Responses API). One conversation: the prompt, then tool calls answered until the model answers.

import { LAST_ROUND } from "./last-round.mjs"

let shared

/** OpenAI's own web search in the Responses API. OpenAI runs the searches inside the response. */
export const WEB_SEARCH = { type: "web_search" }

/** Answers `prompt`; the same contract as the other providers (see anthropic.mjs). */
export async function complete({ model, system, prompt, tools = [], webSearch = false, maxTokens = 16_000, maxTurns = 8, sdk }) {
  // `sdk` is a client to use in its place: the tests pass one that answers from a script. The maker's SDK is loaded only when a real
  // client is needed, so the tests run with nothing installed.
  const client = sdk ?? (shared ??= new (await import("openai")).default())
  const functions = tools.map(({ name, description, input_schema }) => ({ type: "function", name, description, parameters: input_schema, strict: false }))
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 }
  const calls = []
  // The first request carries the prompt. Each later one continues the response before it and carries only the tools' results, so the
  // model's own items (its reasoning, its calls) stay as OpenAI stored them.
  let input = prompt
  let previous = null
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.responses.create({
      model,
      instructions: system,
      input,
      ...(previous ? { previous_response_id: previous } : {}),
      // Counts the model's reasoning too, so it is set well above what an answer needs.
      max_output_tokens: maxTokens,
      // The last round is for the answer: the tools are switched off (last-round.mjs).
      ...(functions.length ? { tools: functions, ...(turn === maxTurns - 1 ? { tool_choice: "none" } : {}) } : {}),
      // A search's sources come back only when asked for.
      ...(webSearch ? { tools: [WEB_SEARCH], include: ["web_search_call.action.sources"] } : {}),
    })
    usage.inputTokens += response.usage?.input_tokens ?? 0
    usage.outputTokens += response.usage?.output_tokens ?? 0
    // Each web search call is billed as one, whatever it did (a search, or opening a page it found).
    const searched = (response.output ?? []).filter((item) => item.type === "web_search_call")
    usage.searches += searched.length
    for (const item of searched) {
      const action = item.action ?? {}
      const query = action.type === "search" ? (action.queries ?? [action.query]).filter(Boolean).join(" | ") : action.url ?? action.type ?? ""
      calls.push({ name: "web_search", input: { query, ...(action.type && action.type !== "search" ? { action: action.type } : {}) }, output: (action.sources ?? []).map((source) => source.url).join("\n").slice(0, 2_000) })
    }
    const asked = (response.output ?? []).filter((item) => item.type === "function_call")
    if (!asked.length) return { text: response.output_text ?? "", calls, usage, stop: response.incomplete_details?.reason ?? response.status ?? null }
    previous = response.id
    input = []
    for (const call of asked) {
      const tool = tools.find((candidate) => candidate.name === call.name)
      let given = {}
      try { given = JSON.parse(call.arguments || "{}") } catch { given = {} }
      const output = tool ? await tool.run(given).catch((error) => `The tool failed: ${error.message ?? error}`) : `No tool is named ${call.name}.`
      calls.push({ name: call.name, input: given, output: String(output).slice(0, 2_000) })
      input.push({ type: "function_call_output", call_id: call.call_id, output: String(output) })
    }
    if (turn === maxTurns - 2) input.push({ role: "user", content: LAST_ROUND })
  }
  return { text: "", calls, usage, stop: "max_turns" }
}
