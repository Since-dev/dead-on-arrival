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

## What the tools cost

A model reads what the tools answer, so an answer with Since takes more tokens. Tokens are an answer's input and output over every round, as the provider bills them. Cost is those tokens at list prices on 2026-11-10.

| Model | Tokens an answer, on its own | Tokens an answer, with Since | Cost an answer, on its own | Cost an answer, with Since |
|---|---|---|---|---|
| Gemini 4 Carbon | 577 | 33,721 | $0.0049 | $0.086 |
| Claude Sonnet 5.5 | 1,434 | 23,154 | $0.013 | $0.062 |
| Gemini 3.8 Flash | 1,061 | 20,980 | $0.0037 | $0.021 |
| Claude Haiku 5.5 | 1,454 | 17,334 | $0.0007 | $0.0026 |
| Claude Fable 5.2 | 2,315 | 51,518 | $0.089 | $0.56 |
| Claude Opus 5.5 | 1,391 | 21,216 | $0.026 | $0.12 |
| GPT-6 Luna | 924 | 18,454 | $0.0004 | $0.0027 |
| GPT-6.1 Terra | 841 | 12,262 | $0.0039 | $0.017 |
| GPT-6.1 Sol | 776 | 15,805 | $0.0071 | $0.041 |

Every answer, every tool call and every finding with its source is in `answers/`; for a published run that folder is `answers-<day>.tar.gz` on the run's release. How it is judged, and how to run it again, is in the README.
