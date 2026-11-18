# Notes on the run of 2026-11-18

The first run with web search: 60 prompts, nine models, four ways. 2,160 answers, and one failed.

- **Two new ways to answer.** Beside "on its own" and "with Since", each model answered with its maker's own web search, which it chose whether to use ("search allowed"), and with the same search plus one line telling it to search for what is current ("told to search"). The line is `searchRule` in `run.json`. Search is Claude's web search, OpenAI's web search and Gemini's Grounding with Google Search. Everything else is the same: the same prompts, the same day, one answer each, the same judge.
- **Off the usual days.** Runs fall on the 10th and the 24th. This one ran on the 18th, to add the search arms.
- **A pilot is part of the run.** The search arms were first tried on 5 prompts (`claude-01`, `openai-03`, `gemini-05`, `mistral-01`, `npm-09`), nine models, four ways, earlier the same day with the same code. Those 180 answers are in this run as they were, not asked twice.
- **Asked in two passes.** The run stopped at its spend guard with 129 answers left. Those, and 23 answers that failed when Gemini's API was unavailable (HTTP 503), were asked again the same day. One Gemini 3.8 Flash answer with Since (`npm-01`) failed again and counts as an error.
- **Search costs count every query.** Gemini's first 5,000 search queries a month are free; the costs here count each one at the list price.
- **The tools changed after the run of 2026-11-10** (see that run's notes), so the "with Since" rows are not like for like with it.
- **`cloud-07` is not judged.** It asks for Terraform, which Since's check does not read yet. Each row has one answer `unjudged`.
- The code as it ran is in the same commit as these results.
