# V1 behavior and verification

V1 is an experimental local browser instrument with three authored fault
families. It is suitable for examining recovery behavior and evidence integrity.
It is not an empirical study result or an estimate of a model's reliability.
The exact checks performed belong in [BUILD_REPORT.md](../BUILD_REPORT.md).

## Preserving an attempt

Each attempt keeps its identity, accepted commands, checks and original
five-minute wall deadline. Restoring a valid older file is rejected when this
browser knows a later state of that same identity. This includes a pre-takeover
bookmark retained before recovery began. A divergent branch is also rejected.
The current board and stored bytes remain intact. Download the old file as
evidence and resume the latest autosave instead.

Admission checks run before restoration, after the editing lock is granted and
inside the autosave storage lock. A stale owner cannot win by racing a newer
accepted edit. Transfer editing reads the latest retained state. Returning from
browser history remains read-only until a validated resume.

The engine replays retained receipts before accepting them. Visibility metadata
and recomputed verdicts do not define freshness. Saved check verdicts are never
authority: restore recomputes the original candidates. The stored previous
verdict is retained while that recomputation is pending.

Offline installation and rehearsal wait for selected playback assets and editing
ownership. Notebook restoration waits for source initialization, so a late default
load cannot replace a restored attempt. A blocked restoration can be retried after
loading without changing the saved bookmark.

Local data clearing, deliberate edits to browser storage and imports into a
different browser can remove the browser's knowledge of later state. No server
or trusted timestamp authority is claimed. An abandoned-reset identity remains
retired while its separate local disposition is retained.

## Offline recovery

Installation is opt-in. Read-only audit never fetches, repairs or deletes files.
Explicit repair is available between attempts and blocks takeover while pending.
The active worker uses its own embedded release inventory. It fetches only
missing or altered assets, verifies their lengths and hashes, then replaces those
individual cache entries. Existing matching entries remain intact. No attempt,
disposition or notebook bytes are read or changed by the worker.

Repair requires a single open application tab, checks that client before writes,
has a 30-second worker bound and does not retry automatically. A failure can
leave earlier verified replacements completed. The interface says so and offers
another audit. A missing old release requires an update. Neither operation
guarantees future storage retention or authenticity of the software publisher.

## Interface

Settings navigation links go directly to queue, clocks, delivery guard and gate.
Failed checks use neutral candidate-freshness styling. A passing check explains
that its candidate is retained while the original deadline continues. Factual
failure explanations use the same scene-version and Delivery guard terms as
the controls. These aids remain outside matched rehearsal.

## Reproduce the V1 checks

```sh
npm run test:engine -- tests/engine/v1-freshness.test.ts tests/engine/v1-offline-worker.test.ts
npm run test:ui -- tests/ui/v1-lifecycle.spec.ts tests/ui/v1-offline-repair.spec.ts tests/ui/v1-release.spec.ts
npm run test:ui:cross
```

The full clean gate also runs all original engine, oracle, contract, real stdio,
browser, replay, mutation and evidence-packet checks. V1 adds all three fault
journeys with failure, repair, restoration and packet roundtrip at desktop,
390px and 320px in Chromium, Firefox and WebKit. It includes keyboard navigation,
200% CSS zoom, reduced motion, axe checks, ownership-race regressions and actual
offline eviction and repair. See [CONTRIBUTING.md](../CONTRIBUTING.md).

This is automated software evidence. Human usability and assistive-technology
observation remain unobserved. Study preparation stays separate with collection
disabled. Publishing and hosted-environment verification are separate decisions.
