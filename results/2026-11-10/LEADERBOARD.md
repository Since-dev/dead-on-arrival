# Dead on arrival: 2026-11-10

60 coding prompts, each answered by each model. An answer is dead on arrival when it names a model, API or version that had already ended on 2026-11-10, as Since's check read it that day. An answer counts once, by the worst thing in it.

## Models on their own

| Model | Dead on arrival | Dead, or ends within 90 days | Pins a version with a known advisory | Answers judged | Not judged |
|---|---|---|---|---|---|
| Gemini 4 Carbon | 27.1% | 44.1% | 23.7% | 59 | 1 |
| Claude Sonnet 5.5 | 20.3% | 30.5% | 23.7% | 59 | 1 |
| Gemini 3.8 Flash | 20.3% | 37.3% | 25.4% | 59 | 1 |
| Claude Haiku 5.5 | 18.6% | 33.9% | 22% | 59 | 1 |
| Claude Fable 5.2 | 15.3% | 28.8% | 23.7% | 59 | 1 |
| Claude Opus 5.5 | 15.3% | 28.8% | 25.4% | 59 | 1 |
| GPT-6 Luna | 15.3% | 30.5% | 25.4% | 59 | 1 |
| GPT-6.1 Terra | 6.8% | 22% | 25.4% | 59 | 1 |
| GPT-6.1 Sol | 5.1% | 16.9% | 27.1% | 59 | 1 |

## The same models with Since's tools

| Model | Dead or ending, on its own | Dead or ending, with Since | Known advisory, on its own | Known advisory, with Since | Tool calls an answer |
|---|---|---|---|---|---|
| Gemini 4 Carbon | 44.1% | 0% | 23.7% | 5.1% | 14.3 |
| Claude Sonnet 5.5 | 30.5% | 1.7% | 23.7% | 6.8% | 8.1 |
| Gemini 3.8 Flash | 37.3% | 6.8% | 25.4% | 13.6% | 6.8 |
| Claude Haiku 5.5 | 33.9% | 1.7% | 22% | 18.6% | 5.7 |
| Claude Fable 5.2 | 28.8% | 0% | 23.7% | 0% | 16.7 |
| Claude Opus 5.5 | 28.8% | 1.8% | 25.4% | 12.3% | 6.7 |
| GPT-6 Luna | 30.5% | 3.4% | 25.4% | 11.9% | 6.8 |
| GPT-6.1 Terra | 22% | 1.7% | 25.4% | 10.3% | 7.2 |
| GPT-6.1 Sol | 16.9% | 0% | 27.1% | 5.1% | 7.5 |

Every answer, every tool call and every finding with its source is in `answers/`; for a published run that folder is `answers-<day>.tar.gz` on the run's release. How it is judged, and how to run it again, is in the README.
