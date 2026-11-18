# Dead on arrival: 2026-11-18

60 coding prompts, each answered by each model. An answer is dead on arrival when it names a model, API or version that had already ended on 2026-11-18, as Since's check read it that day. An answer counts once, by the worst thing in it.

## Models on their own

| Model | Dead on arrival | Dead, or ends within 90 days | Pins a version with a known advisory | Answers judged | Not judged |
|---|---|---|---|---|---|
| Gemini 4 Carbon | 42.4% | 52.5% | 20.3% | 59 | 1 |
| Gemini 3.8 Flash | 40.7% | 52.5% | 18.6% | 59 | 1 |
| Claude Sonnet 5.5 | 23.7% | 45.8% | 22% | 59 | 1 |
| Claude Haiku 5.5 | 22% | 49.2% | 23.7% | 59 | 1 |
| GPT-6 Luna | 22% | 35.6% | 22% | 59 | 1 |
| Claude Opus 5.5 | 20.3% | 45.8% | 23.7% | 59 | 1 |
| Claude Fable 5.2 | 18.6% | 44.1% | 20.3% | 59 | 1 |
| GPT-6.1 Terra | 11.9% | 35.6% | 23.7% | 59 | 1 |
| GPT-6.1 Sol | 8.5% | 25.4% | 25.4% | 59 | 1 |

## Memory, web search and Since

Each model answered the same prompts four ways: on its own; with its own web search, which it chose whether to use; with the same search and one line telling it to search for what is current; and with Since's tools. Search is each maker's own: Claude's web search, OpenAI's web search and Gemini's Grounding with Google Search.

### Dead on arrival

| Model | On its own | Search allowed | Told to search | With Since |
|---|---|---|---|---|
| Gemini 3.8 Flash | 40.7% | 39% | 20.3% | 0% |
| Claude Sonnet 5.5 | 23.7% | 13.6% | 0% | 0% |
| Claude Haiku 5.5 | 22% | 11.9% | 3.4% | 0% |
| Claude Opus 5.5 | 20.3% | 10.2% | 5.1% | 0% |
| Claude Fable 5.2 | 18.6% | 8.5% | 0% | 0% |
| Gemini 4 Carbon | 42.4% | 8.5% | 0% | 0% |
| GPT-6 Luna | 22% | 1.7% | 0% | 0% |
| GPT-6.1 Terra | 11.9% | 1.7% | 0% | 0% |
| GPT-6.1 Sol | 8.5% | 0% | 0% | 0% |

### Dead, or ends within 90 days

| Model | On its own | Search allowed | Told to search | With Since |
|---|---|---|---|---|
| Gemini 3.8 Flash | 52.5% | 50.8% | 32.2% | 1.7% |
| Claude Sonnet 5.5 | 45.8% | 40.7% | 1.7% | 1.7% |
| Claude Haiku 5.5 | 49.2% | 44.1% | 5.1% | 1.7% |
| Claude Opus 5.5 | 45.8% | 32.2% | 5.1% | 1.7% |
| Claude Fable 5.2 | 44.1% | 23.7% | 0% | 0% |
| Gemini 4 Carbon | 52.5% | 10.2% | 0% | 0% |
| GPT-6 Luna | 35.6% | 5.1% | 1.7% | 1.7% |
| GPT-6.1 Terra | 35.6% | 5.1% | 1.7% | 0% |
| GPT-6.1 Sol | 25.4% | 6.8% | 1.7% | 0% |

### How often each model searched

Searched is the share of answers that made at least one web search.

| Model | Searched, allowed | Searches an answer, allowed | Searched, told to | Searches an answer, told to |
|---|---|---|---|---|
| Gemini 3.8 Flash | 40% | 0.9 | 86.7% | 2.3 |
| Claude Sonnet 5.5 | 18.3% | 1.6 | 100% | 9.1 |
| Claude Haiku 5.5 | 6.7% | 0.3 | 100% | 6.3 |
| Claude Opus 5.5 | 46.7% | 2.1 | 100% | 7.7 |
| Claude Fable 5.2 | 60% | 7.2 | 100% | 19.1 |
| Gemini 4 Carbon | 75% | 2.5 | 100% | 4.1 |
| GPT-6 Luna | 100% | 2.5 | 100% | 2.8 |
| GPT-6.1 Terra | 100% | 1.9 | 100% | 2.3 |
| GPT-6.1 Sol | 100% | 2.1 | 100% | 2.6 |

## The same models with Since's tools

| Model | Dead or ending, on its own | Dead or ending, with Since | Known advisory, on its own | Known advisory, with Since | Tool calls an answer |
|---|---|---|---|---|---|
| Gemini 4 Carbon | 52.5% | 0% | 20.3% | 0% | 11.1 |
| Gemini 3.8 Flash | 52.5% | 1.7% | 18.6% | 0% | 7.2 |
| Claude Sonnet 5.5 | 45.8% | 1.7% | 22% | 1.7% | 6.0 |
| Claude Haiku 5.5 | 49.2% | 1.7% | 23.7% | 1.7% | 5.7 |
| GPT-6 Luna | 35.6% | 1.7% | 22% | 0% | 6.5 |
| Claude Opus 5.5 | 45.8% | 1.7% | 23.7% | 1.7% | 7.0 |
| Claude Fable 5.2 | 44.1% | 0% | 20.3% | 1.7% | 9.1 |
| GPT-6.1 Terra | 35.6% | 0% | 23.7% | 1.7% | 6.3 |
| GPT-6.1 Sol | 25.4% | 0% | 25.4% | 1.7% | 6.0 |

## What the tools cost

A model reads what the tools answer, so an answer with Since takes more tokens. Tokens are an answer's input and output over every round, as the provider bills them. Cost is those tokens at list prices on 2026-11-10.

| Model | Tokens an answer, on its own | Tokens an answer, with Since | Cost an answer, on its own | Cost an answer, with Since |
|---|---|---|---|---|
| Gemini 4 Carbon | 612 | 27,695 | $0.0052 | $0.071 |
| Gemini 3.8 Flash | 1,084 | 24,535 | $0.0038 | $0.024 |
| Claude Sonnet 5.5 | 1,377 | 18,423 | $0.013 | $0.049 |
| Claude Haiku 5.5 | 1,472 | 20,675 | $0.0007 | $0.0028 |
| GPT-6 Luna | 931 | 18,841 | $0.0004 | $0.0026 |
| Claude Opus 5.5 | 1,359 | 23,221 | $0.025 | $0.12 |
| Claude Fable 5.2 | 2,294 | 27,043 | $0.088 | $0.31 |
| GPT-6.1 Terra | 818 | 13,786 | $0.0038 | $0.018 |
| GPT-6.1 Sol | 747 | 13,471 | $0.0068 | $0.036 |

## What search costs

A search is billed by itself (Claude $10 and OpenAI $10 per 1,000 searches, Gemini $14 per 1,000 queries on 2026-11-18), and the pages it reads are billed as input tokens. Cost an answer counts both.

| Model | Tokens an answer, search allowed | Tokens an answer, told to search | Cost an answer, search allowed | Cost an answer, told to search |
|---|---|---|---|---|
| Gemini 3.8 Flash | 1,674 | 2,658 | $0.018 | $0.040 |
| Claude Sonnet 5.5 | 13,000 | 67,478 | $0.052 | $0.24 |
| Claude Haiku 5.5 | 10,169 | 46,456 | $0.0050 | $0.069 |
| Claude Opus 5.5 | 19,156 | 58,078 | $0.12 | $0.35 |
| Claude Fable 5.2 | 59,717 | 171,536 | $0.66 | $1.75 |
| Gemini 4 Carbon | 1,378 | 2,165 | $0.046 | $0.076 |
| GPT-6 Luna | 18,521 | 23,484 | $0.027 | $0.031 |
| GPT-6.1 Terra | 16,244 | 19,435 | $0.038 | $0.045 |
| GPT-6.1 Sol | 16,081 | 21,470 | $0.059 | $0.075 |

Every end date an answer was judged by is in `SOURCES.md`, with the page it comes from, so each can be checked by hand.

Every answer, every tool call and every finding with its source is in `answers/`; for a published run that folder is `answers-<day>.tar.gz` on the run's release. How it is judged, and how to run it again, is in the README.
