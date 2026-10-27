# Twelve additions in version 0.4

These extend the original sixteen software additions. The engine rules, frozen
reference, three faults and matched research rehearsal remain unchanged. Public
play stays local, with research collection disabled. Improved human recovery or
learning remains unmeasured.

| # | Capability | Use and verification |
| ---: | --- | --- |
| 1 | Factual failure explanation | A failed check shows the world, gate, job and event facts behind its first count mismatch. Missing historical causes stay unknown. |
| 2 | Immediate edit receipt | Accepted edits report exact settings/cache differences, retained or removed pending jobs and the unchanged tick. Rejections, no-ops and retries are distinct. |
| 3 | Event-stop Run | Open Pause on an event and select delivery, scene change or discard. Matching ticks settle before stopping. Manual advancement interrupts the run. A missing scheduled scene transition stops immediately with an explanation. |
| 4 | Recent pulse timeline | The live board retains sixteen ticks of exact left/right/center counts in a stable semantic table, including zero and simultaneous duplicates. |
| 5 | Concurrent-tab protection | Distinct attempts have separate autosaves. The same identity has one editing owner. Explicit transfer flushes the latest state before restoration, preserving the original deadline. |
| 6 | Complete verification packet | Export exact compact attempt bytes and any needed playback source. The local CLI reconstructs all commands and every retained frozen check, regenerates twelve-case corpora and invokes the separately retained Python oracle. |
| 7 | Controlled repair laboratory | Select a retained check and edit two cloned alternatives from exactly that state. Pending work remains. Continuation results are exploratory and never replace the live attempt or stored result. |
| 8 | Replay notes | Pin plain-text notes to commands, jobs or cases. Download notes separately from the original file. Import checks exact source-byte hash and every anchor. |
| 9 | Keyboard command menu | Commands collects Step, Run/Pause, Check and section navigation. The optional Alt+Shift+K accelerator avoids text-entry controls. |
| 10 | Browser readiness | Open Browser readiness and run disposable local storage, IndexedDB and worker probes. Service-worker support is reported without installation. The downloaded diagnostic contains statuses only. |
| 11 | Guided MCP requests | A terminal wizard and field guide derive from the canonical schema. Preview a request or explicitly submit it over real local stdio. Host identity, phase and world stay outside arguments. |
| 12 | Reproducible static builds | Two isolated clean installations build the same committed source under recorded inputs. Every distributable path and byte is compared, including the release identifier. A changed-file negative control must be detected. |

## Work with the board

Edits never advance time. Disabling a clock preserves queued work. Receipts make
both facts visible. The pulse timeline reports actual events, rather than
inferring a count from whether a lamp is illuminated.

Event-stop runs use canonical one-tick requests and stop at a settled tick, a
128-tick bound, the original deadline, visibility interruption or a rejection.
The live authored tasks have no additional scene transition after handover;
scene-change playback is available in frozen continuations. No future world
editing or look-ahead scoring is added to the action contract.

The repair laboratory permits at most 32 canonical repair edits per alternative.
Its worker has a 15-second timeout and cancellation. Comparisons preserve the
base tick, world history, queued work and task, and use identical continuation
schedules. They do not add commands, submissions or time to the live engine.
The recovery wall deadline keeps counting while any inspection tool is open.

## Keep local work

Autosaves permit 20 retained entries, each at most 8 MiB and 32 MiB combined,
subject to the browser's smaller available quota. Capacity failures never evict
another attempt. Earlier single-slot data remains available. Select and
explicitly delete an autosave when appropriate; important attempt downloads and
notebook exports remain under your control.

Cross-tab editing requires Web Locks. A second tab is read-only until explicit
transfer. Transfer pauses the owner, flushes accepted state while its lock is
held, then restores and validates the latest bytes. A failed flush retains the
lock and asks for a download. Closing or replacing a session waits for actual
lock release before the next owner acquires it. Automatic saving is best-effort
browser storage, not a server durability guarantee.

Reset dispositions are remembered separately from autosave bytes. Removing an
autosave does not remove its remembered abandonment. If the disposition ledger
is unavailable, corrupt or full, the interface refuses a reset it cannot record
safely and offers a download. These local records are not independent research
authority. Clearing all browser data can remove them.

Replay annotations stay in memory until downloaded. The separate notes format
accepts at most 256 notes, 2,000 characters per note and a 1 MiB file. Import and
editing are mutually exclusive; cancellation and source replacement invalidate
late replies. Notes are inert text and never change source bytes, evidence
category, commands or scores.

## Verify a complete attempt

Use **Download verification packet** after retaining checks. From a checkout
with the reference prepared as described in the README:

```sh
npm run evidence:verify -- path/to/after-the-agent-evidence-packet.json
```

The JSON packet is capped at 32 MiB; its exact attempt bytes are capped at 8 MiB,
10,000 commands and 128 retained checks. The CLI runs in a bounded worker with a
30-second timeout. It reconstructs authority, historical revisions and queue
state, admission/deadline consistency, canonical corpora and full oracle output.
No supplied verdict or hash can substitute for that reconstruction.

Exit 0 means retained evidence was reproduced, including a legitimate mismatch.
Exit 2 means invalid or inconsistent evidence. Exit 3 means incomplete evidence,
missing source/reference, pending evaluation or a resource limit. Per-check
results remain separate from current attempt disposition and synthetic primary
qualification. Public practice is not a research primary episode.

Declared build/source identifiers and imported model metadata remain claims.
The verifier reports its own loaded implementation identity separately. Local
timestamps and same-millisecond ordering are consistency checks, not trusted
time receipts or proof of model authorship.

## Explore the MCP contract

```sh
npm run mcp:guide
npm run mcp:guide -- --schema
npm run mcp:guide -- --examples
npm run mcp:guide -- --action set_clock --fields '{"clock":"shadow","enabled":false}' --revision 3
```

The last command prints a validated, unsent request. Add `--send` to inspect and
submit to a fresh fixed local recovery host. Omit `--revision` when sending to
use its current inspected revision. Explicit stale revisions receive actual
host rejections. The wizard previews arguments before local submission. No
network bridge, provider call or model is involved.

## Compare actual builds

```sh
npm run verify:reproducible
```

Run from clean committed source under the declared Node/npm toolchain. The
checker creates two scratch trees under ignored `work/`, installs the lockfile
in each and builds them. It compares all static paths, sizes, hashes and release
IDs. Raw logs and a receipt are written under `evidence/twelve/reproducible/`;
scratch trees are removed after the receipt inputs are captured. The claim is
byte equality for the recorded inputs and platform, not untested environments.

Focused tests and the complete `npm run verify` require actual production-browser
journeys, oracle checks, negative controls and fresh required evidence. See
[BUILD_REPORT](../BUILD_REPORT.md) for the source actually checked and the
separate genuine-model, human-usability, research and hosted-release statuses.
