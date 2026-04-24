# Reading AI Kernel Refactor

## Core Verdict

The target shape is `route -> retrieval -> prompt -> provider -> normalize`. The old `coach-service.ts` mixed all five concerns, which made every bug fix turn into another branch in one large file.

## Current Split

- `server/src/lib/reading/router.ts`: route, intent, and context-route classification.
- `server/src/lib/reading/chunks.ts`: exam bundle chunk construction, passage paragraph extraction, and question HTML extraction.
- `server/src/lib/reading/retrieval.ts`: deterministic chunk scoring, passage fallback injection, context budget, and review target assembly.
- `server/src/lib/reading/prompt.ts`: model prompt contract, response JSON schema, and model response normalization.
- `server/src/lib/reading/coach-service.ts`: orchestration, exam bundle loading, local fallback, provider call, caching, and final response assembly.

## Next Cuts

1. Move local deterministic replies into `server/src/lib/reading/local-response.ts`.
2. Add direct chunk-construction contract probes before changing question extraction rules again.
3. Keep question extraction inside `chunks.ts` unless it grows materially beyond chunk construction; do not split it just for file-count neatness.

## Regression Gates

- `node developer/tests/js/readingAnalysisService.test.js`
- `python3 developer/tests/ci/run_static_suite.py`
- `python3 developer/tests/e2e/suite_practice_flow.py`

## Non-Negotiable Review Contract

Wrong-answer review must carry question stem, user answer, correct answer, official explanation or evidence, and original passage chunks into the model prompt. If any of those fields is absent, the response must report missing context instead of pretending to diagnose the mistake.
