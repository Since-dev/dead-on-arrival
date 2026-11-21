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

## Judged again on 2026-11-21

The judge missed a manifest named in inline code on the line before its block ("Create `go.mod`:", "`requirements.txt`"): it read 111 blocks unnamed, and three go.mod files as Go code. The fix is in `src/judge.mjs`, with tests from these answers. Every stored answer was judged again with it (`node src/run.mjs --rejudge --out results/2026-11-18`), each finding dated against 2026-11-18 as before. 337 verdicts moved, mostly between dying, behind and clean; dead on arrival moved for three rows (Gemini 3.8 Flash on its own 40.7% to 42.4%, GPT 6.1 Sol on its own 8.5% to 6.8%, GPT 6 Luna with search 1.7% to 3.4%). The judge is Since's check as it reads today, so a finding Since has since withdrawn is no longer counted. The tables here and `answers-2026-11-18.tar.gz` on the release are the judged-again ones; told to search, up to 20.3% of a model's answers were dead on arrival, and with Since 0%.

The tables also count the sources an answer's searches returned. Claude and OpenAI return pages; Gemini returns the site names its search found, so its column counts sites, not pages.
