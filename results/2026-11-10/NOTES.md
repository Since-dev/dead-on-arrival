# Notes on the run of 2026-11-10

The first full run: 60 prompts, nine models, both ways. 1,080 answers and none failed. It cost about $64 at list prices.

- **It was judged twice.** After the run the judge was changed to read every page of a check's findings; it had read the first 500 of a block. All 1,080 stored answers were judged again on 2026-11-11 (UTC) with `--rejudge`, and no model was asked again. 26 verdicts changed: 14 from `behind` to `vulnerable`, where an advisory sat behind a page of breaking changes, and 12 from `clean` to `behind`, where Since had read more of a package's releases by then. No `dead` or `dying` verdict changed.
- **The tools were weaker in this run than they are now.** `whats_changed` took a model ID, an API, a runtime or a provider. Asked about a package by its bare name it had nothing to say: 1,741 of its 2,922 calls came back empty, so a model could not read a package's latest version from it. `check_code` answers were cut at 3,000 characters, which one old pin could fill. Both are changed for later runs (`src/since.mjs`). The "with Since" rows here are what the tools did that day.
- **`cloud-07` is not judged.** It asks for Terraform, which Since's check does not read yet. All 18 answers to it are `unjudged`.
- The code as it ran is commit `daaa2d2` of this repository.
