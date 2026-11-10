// Claude through the official SDK. One conversation: the prompt, then tool calls answered until the model gives its answer.

import { LAST_ROUND } from "./last-round.mjs"

let shared

/**
 * Answers `prompt`. With `tools`, the model may call them (each `{ name, description, input_schema, run }`) for `maxTurns` rounds; the
 * last round is for its answer, with the tools switched off (last-round.mjs). Returns the answer's text, every tool call made, and the
 * tokens used.
 */
export async function complete({ model, system, prompt, tools = [], maxTokens = 16_000, maxTurns = 8, sdk }) {
  // `sdk` is a client to use in its place: the tests pass one that answers from a script. The maker's SDK is loaded only when a real
  // client is needed, so the tests run with nothing installed.
  const client = sdk ?? (shared ??= new (await import("@anthropic-ai/sdk")).default())
  const messages = [{ role: "user", content: prompt }]
  const usage = { inputTokens: 0, outputTokens: 0 }
  const calls = []
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model,
      // Counts the model's reasoning too, so it is set well above what an answer needs.
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools.length ? { tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        ...(turn === maxTurns - 1 ? { tool_choice: { type: "none" } } : {}) } : {}),
    })
    usage.inputTokens += (response.usage.input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0)
    usage.outputTokens += response.usage.output_tokens ?? 0
    const asked = response.content.filter((block) => block.type === "tool_use")
    if (response.stop_reason !== "tool_use" || !asked.length) {
      return { text: response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"), calls, usage, stop: response.stop_reason }
    }
    // The model's turn goes back whole, as it came: its reasoning blocks must not be edited or dropped.
    messages.push({ role: "assistant", content: response.content })
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
