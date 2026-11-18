// Claude through the official SDK. One conversation: the prompt, then tool calls answered until the model gives its answer.

import { LAST_ROUND } from "./last-round.mjs"

let shared

/** Claude's own web search, as Anthropic gives it today (with dynamic filtering). Anthropic runs the searches inside the request. */
export const WEB_SEARCH = { type: "web_search_20260318", name: "web_search" }
/** How many times a turn should pause for more server-side work before the run gives up on it. */
const PAUSES_MAX = 8

/**
 * Answers `prompt`. With `tools`, the model may call them (each `{ name, description, input_schema, run }`) for `maxTurns` rounds; the
 * last round is for its answer, with the tools switched off (last-round.mjs). With `webSearch`, the model also has Claude's own web
 * search and decides itself whether to use it. Returns the answer's text, every tool call made (each search as a `web_search` call),
 * and the tokens and searches used.
 */
export async function complete({ model, system, prompt, tools = [], webSearch = false, maxTokens = 16_000, maxTurns = 8, sdk }) {
  // `sdk` is a client to use in its place: the tests pass one that answers from a script. The maker's SDK is loaded only when a real
  // client is needed, so the tests run with nothing installed.
  const client = sdk ?? (shared ??= new (await import("@anthropic-ai/sdk")).default())
  const messages = [{ role: "user", content: prompt }]
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 }
  const calls = []
  // The text of the turn so far: a turn paused for a search goes on in the next request, and its text goes on with it.
  let text = ""
  for (let turn = 0, pauses = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model,
      // Counts the model's reasoning too, so it is set well above what an answer needs.
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools.length || webSearch ? { tools: [...tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })), ...(webSearch ? [WEB_SEARCH] : [])],
        ...(tools.length && turn === maxTurns - 1 ? { tool_choice: { type: "none" } } : {}) } : {}),
    })
    usage.inputTokens += (response.usage.input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0)
    usage.outputTokens += response.usage.output_tokens ?? 0
    usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0
    calls.push(...searchesOf(response.content))
    text = joinText(text, response.content)
    // A long search turn comes back paused: it goes back as it came and the server goes on with it. It is not one of the tool rounds.
    if (response.stop_reason === "pause_turn" && pauses < PAUSES_MAX) {
      pauses++
      turn--
      messages.push({ role: "assistant", content: response.content })
      continue
    }
    const asked = response.content.filter((block) => block.type === "tool_use")
    if (response.stop_reason !== "tool_use" || !asked.length) return { text, calls, usage, stop: response.stop_reason }
    // The model's turn goes back whole, as it came: its reasoning blocks must not be edited or dropped.
    messages.push({ role: "assistant", content: response.content })
    text = ""
    const results = []
    for (const block of asked) {
      const tool = tools.find((candidate) => candidate.name === block.name)
      const output = tool ? await tool.run(block.input ?? {}).catch((error) => `The tool failed: ${error.message ?? error}`) : `No tool is named ${block.name}.`
      calls.push({ name: block.name, input: block.input, output: String(output).slice(0, 2_000) })
      results.push({ type: "tool_result", tool_use_id: block.id, content: String(output) })
    }
    if (turn === maxTurns - 2) results.push({ type: "text", text: LAST_ROUND })
    messages.push({ role: "user", content: results })
  }
  return { text: "", calls, usage, stop: "max_turns" }
}

/**
 * The answer's text from a response's blocks. Text Claude cites from a search comes as several text blocks in a row: those are one
 * text. Text on either side of a search or a tool call is two, and starts on a new line, so a code fence still opens a line.
 */
export function joinText(before, content) {
  let text = before
  let previous = before ? "other" : null
  for (const block of content) {
    if (block.type === "text") text += (previous === "other" && text && !text.endsWith("\n") ? "\n" : "") + block.text
    previous = block.type === "text" ? "text" : "other"
  }
  return text
}

/** Each search of a response as a call: what was searched, and the pages it found. */
function searchesOf(content) {
  const found = new Map(content.filter((block) => block.type === "web_search_tool_result").map((block) => [block.tool_use_id, block.content]))
  return content.filter((block) => block.type === "server_tool_use" && block.name === "web_search").map((block) => {
    const result = found.get(block.id)
    const output = Array.isArray(result) ? result.map((page) => page.url).join("\n") : result?.error_code ? `The search failed: ${result.error_code}` : ""
    return { name: "web_search", input: { query: block.input?.query ?? "" }, output: output.slice(0, 2_000) }
  })
}
