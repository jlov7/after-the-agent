# Reproduce browser measurements

The fixed local regression ceilings are interaction p95 **100 ms** and rendered
twelve-case scoring p95 **150 ms**, in `fixtures/performance-targets.json`.
These are checks on the recorded machine class, not universal device promises
or measurements of comprehension or task completion.

```sh
BASE=/after-the-agent/ npm run build
npm run benchmark:product
```

The runner starts its own production preview on port 4175, uses headless
Chromium, records `evidence/quality/benchmark.json`, then stops both processes.
Three rounds each take five samples for each of the three faults. Every repair
must visibly pass twelve cases. The first sample on each page includes worker
startup; later samples reuse it. External requests are blocked.

Interactions measure a native checkbox event through two rendering frames.
Scoring measures Check repair through a **new matching worker request ID,
candidate hash, twelve cases and rendered verdict**. An earlier verdict or
unrelated DOM update cannot finish measurement. A regression injects a 200 ms
worker delay while an old verdict remains, checking this measurement boundary.

Receipts retain every sample, environment, recipes, thresholds and output asset
hashes. Shared machine load and scheduling vary. A slow hosted runner may fail
these ceilings; report that result and investigate rather than widening limits
merely to pass. Hosted timing is not established by local success.
