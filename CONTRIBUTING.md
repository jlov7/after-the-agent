# Contributing

Keep the instrument focused on recovering inherited state. Read the
[product specification](docs/01_PRODUCT_SPEC.md),
[engine contracts](docs/02_ENGINE_AND_CONTRACTS.md) and
[reference notes](docs/REFERENCE.md) before changing behavior.

Use Node 24.19.0, npm 12.0.0 and uv. Install with `npm ci --ignore-scripts`.
Dependencies are exact and locked. Add a dependency only when it replaces
substantial custom code. Keep credentials, participant records, machine paths
and generated test logs out of commits. A public noreply Git email avoids
exposing a private contact address.

## Verify a change

For a consequential defect, first reproduce it with a meaningful regression.
Observe its failure, fix the behavior, then rerun the focused check. Tests should
challenge plausible failures, not repeat implementation or target a test count.

| Change | Focused command |
| --- | --- |
| Request or boundary validation | `npm run test:contract` |
| Engine or session lifecycle | `npm run test:engine` |
| Scoring or world/queue semantics | `npm run test:oracle` and `npm run test:mutants` |
| Recording or replay | `npm run test:replay` |
| MCP or capture | `npm run test:mcp` (real child process) |
| Complete attempt packet | `npm run test:oracle -- tests/oracle/twelve-packet.test.ts` |
| Static-build determinism | `npm run verify:reproducible` (clean committed source) |
| UI behavior or layout | `BASE=/after-the-agent/ npm run test:ui` |
| Firefox and WebKit release journeys | `BASE=/after-the-agent/ npm run test:ui:cross` |
| Responsiveness | `BASE=/after-the-agent/ npm run build`, then `npm run benchmark:product` |

Oracle and capture tests require the retained sibling reference from the README.
Run `npm run typecheck`, `npm run lint` and `node scripts/check-reference.mjs`.
Inspect the actual UI when behavior/layout changes. Keyboard, reduced motion,
narrow layouts and overflowing content matter as well as the initial screen.
Tests start headless browsers and local servers; stop any temporary processes
you start yourself.

Before requesting review, commit the source and run `npm run verify` from the
clean checkout. This also discovers every `test_*.py` reference test. Receipts
name the source revision actually tested. Do not describe a later revision as
verified merely because it inherited an old report. Hosted CI is separate from
local command success.

## Protect the reference

Do not alter executable oracle/schema/golden/policy files to make a candidate
pass. Keep task truth separate from mutable clocks, preserve valid queued work,
score multiplicities and the final drain, and preserve phase authority and
request idempotency. A behavioral change requires a versioned specification and
counterexamples. The public protocol attribution derivative is documented and
pinned separately; it does not permit any additional reference change.

## Pull requests

Use a small `type/short-description` branch and imperative conventional commits.
Describe the concrete problem, resulting behavior and checks actually run.
Preserve failed evidence locally. Reviewers should reproduce material findings.
Do not include internal build conversations or review transcripts in the source.
No assessed-model or research improvement is established by software tests.

## Research and live providers

Research collection stays disabled. Local synthetic rehearsal is not a consented
study. Provider invocation, recruitment, consent/review, collection services,
budgets and publication each need a separate concrete decision. Never add
credentials, guessed model IDs, fabricated observations or unsupported claims.
