// Gemini through the official Google Gen AI SDK. One conversation: the prompt, then tool calls answered until the model answers.

import { LAST_ROUND } from "./last-round.mjs"

let shared

/** Answers `prompt`; the same contract as the other providers (see anthropic.mjs). */
export async function complete({ model, system, prompt, tools = [], maxTokens = 16_000, maxTurns = 8, sdk }) {
  // `sdk` is a client to use in its place: the tests pass one that answers from a script. The maker's SDK is loaded only when a real
  // client is needed, so the tests run with nothing installed.
  const ai = sdk ?? (shared ??= new (await import("@google/genai")).GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }))
  const contents = [{ role: "user", parts: [{ text: prompt }] }]
  const config = {
    systemInstruction: system,
    maxOutputTokens: maxTokens,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map(({ name, description, input_schema }) => ({ name, description, parametersJsonSchema: input_schema })) }] } : {}),
  }
  const usage = { inputTokens: 0, outputTokens: 0 }
  const calls = []
  for (let turn = 0; turn < maxTurns; turn++) {
    // In the last round the model has no tools (last-round.mjs): they are left out of the request. Switched off alone (`mode: NONE`),
    // or left out with nothing said, Gemini still answered with another call in the middle of a run of calls (measured, November 2026).
    const last = tools.length > 0 && turn === maxTurns - 1
    const response = await ai.models.generateContent({ model, contents, config: last ? { systemInstruction: system, maxOutputTokens: maxTokens } : config })
    usage.inputTokens += response.usageMetadata?.promptTokenCount ?? 0
    usage.outputTokens += (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0)
    const asked = response.functionCalls ?? []
    const candidate = response.candidates?.[0]
    if (!asked.length || !candidate?.content) return { text: response.text ?? "", calls, usage, stop: candidate?.finishReason ?? null }
    if (last) break
    // The model's turn goes back whole, as it came: its thought signatures ride on its parts.
    contents.push(candidate.content)
    const parts = []
    for (const call of asked) {
      const tool = tools.find((entry) => entry.name === call.name)
      const output = tool ? await tool.run(call.args ?? {}).catch((error) => `The tool failed: ${error.message ?? error}`) : `No tool is named ${call.name}.`
      calls.push({ name: call.name, input: call.args ?? {}, output: String(output).slice(0, 2_000) })
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result: String(output) } } })
    }
    if (turn === maxTurns - 2) parts.push({ text: LAST_ROUND })
    contents.push({ role: "user", parts })
  }
  return { text: "", calls, usage, stop: "max_turns" }
}
