# Local tools and evidence

The public instrument retains the original sixteen additions below and includes
[twelve further additions in version 0.4](ADDITIONS_V0_4.md) and
[four portability additions in version 0.6](PORTABILITY_ADDITIONS.md). The tables describe software
behavior. Human usability observation and study
launch require their own evidence. See [BUILD_REPORT](../BUILD_REPORT.md) for
the exact checked revision and results.

| # | Addition | Where and why |
| ---: | --- | --- |
| 1 | Narrow-screen workbench | One action dock keeps Step, Run, Pause, Check and the original countdown reachable while editing. |
| 2 | Three concept lessons | Before takeover, predict and execute isolated examples of queued work, scene versions and cached activity. |
| 3 | Frozen continuation playback | Explore behavior reconstructs actual ticks through final drain from a retained check. |
| 4 | Job lineage | Follow a real job through enqueue, pending state, delivery, discard or drop. |
| 5 | Repair comparison | Compare retained checks, including capture tick and world differences. |
| 6 | Command replay viewer | Open a recording, Download attempt evidence or Save progress to a file download. Move backward or forward without changing the live board. |
| 7 | Complete history | Search all events and actual rejections; filter tick, type, job and request. Matching rows have bounded pages. |
| 8 | Printable HTML evidence | Download a standalone report with initial state, edits, checks, counterexamples and commitments. No scripts or network resources. |
| 9 | One-case reproducer | Download the selected frozen case and reproduce its exact pulses locally with the CLI and independent oracle. |
| 10 | Attempt notebook | Explicitly enable IndexedDB, then name, inspect, export, restore or delete immutable bookmarks. |
| 11 | First replay divergence | A changed recording identifies the first command and field with recorded and reconstructed values. |
| 12 | Capture-run inspector | Select retained nonsecret capture artifacts to inspect claimed provider, tool, budget, replay and behavior outcomes locally. |
| 13 | Controlled recording gallery | Owner-pinned assets are replayed and qualified before selection. The genuine selected run and bundled test fixture retain distinct labels. The default genuine run configured a clock, gate and guard. The earlier inspect/advance run remains available with its narrower description. |
| 14 | Offline edition | Opt in before takeover to cache the complete versioned application, workers, documents and bundled recordings. |
| 15 | MCP playground | Send canonical requests to the actual local stdio server and inspect accepted, rejected and repeated responses. |
| 16 | Stateful sequence checks | Generated edits, pending work, retries, phase changes, save/restore, reset and expiry are checked with reproducible seeds and shrinking. |

## Replay and reports

Open **Optional tools** on the public page. Tools run on this
device. Replay accepts files up to 8 MiB and journals of at most 10,000 commands,
with a 15-second worker timeout. Closing or replacing the file cancels the old
worker. Large displayed values and event windows are explicitly bounded; the
original inspected file remains available for download.

Select **Complete verification packet** to open a packet of up to 32 MiB. Its
inventory is recomputed and any embedded playback source is reconstructed and
bound to the attempt. Replay navigates the exact embedded attempt, which can be
downloaded separately. Notes pin to that attempt's bytes. A missing required
source stays explicitly incomplete. This browser path does not run Python,
verify retained repair scores or authenticate imported provenance. Use the
independent `npm run evidence:verify -- path/to/packet.json` for full scoring.

A replay verifies deterministic consistency. An uploaded `live_model` claim
cannot establish its own trusted commitment. Only owner-pinned gallery assets
can supply that trust. Neither path proves authorship or trustworthy timestamps.

The HTML report renders at most 500 command rows and labels truncation. Keep the
full JSON when you need every command. Reports and diagnostic excerpts are local
evidence, not study results.

To reproduce a downloaded case:

```sh
npm run diagnostic:reproduce -- path/to/case.json
```

This reconstructs the canonical case, compares the exact retained observation,
then invokes the independently retained Python reference. A faithfully reproduced
**mismatch** is a successful diagnostic invocation. It remains a failed repair.
One case never qualifies the twelve-case repair. An all-quiet case can have no
required pulse; the preserved suite oracle rejects that input for lack of
liveness. The CLI labels this `reproduced_engine_only` with
`oracle_status: unavailable_no_liveness`, without claiming an independent verdict.

## Notebook and offline storage

Automatic resume now keeps separate per-attempt slots with editing ownership
across tabs. The landing chooser lists retained states. A second tab opens the
same attempt read-only; **Transfer editing here** flushes the owner's latest
state before the receiving tab validates and restores it. The original deadline
does not restart. Explicitly resetting retains an abandonment disposition, so
the old autosave cannot reopen as a live repair. These autosaves are separate
from the opt-in immutable notebook below.

**Download selected autosave** retains the exact stored bytes without resuming
or deleting anything. Raw autosaves are a separate format from **Save progress to a file** files. A damaged file stays unvalidated; a local abandonment disposition
still prevents restoration. Keep the original bytes for diagnosis.

The notebook is opt-in. It accepts 20 bookmarks, at most 8 MiB each and 32 MiB in
total, enforced in a single IndexedDB transaction. Saving captures bytes once.
Later edits do not rewrite them. Corrupt entries cannot be inspected, exported
or restored; deletion remains available. Storage denial or a blocked database
produces explicit feedback. Export important bookmarks before clearing browser
data.

**Download notebook backup** keeps every valid bookmark's ID, name, date,
commitment and exact attempt string. **Import notebook backup** validates all
records in a bounded worker, then previews the merge. Identical IDs and records
are skipped; conflicting IDs, one corrupt record or an exceeded quota reject the
whole import. The write transaction rechecks current storage, including changes
in another tab. Import never resumes an attempt. Restoration still performs its
existing command validation. The backup limit is 64 MiB plus 64 KiB because JSON
escaping can enlarge the 32 MiB raw contents. Invalid existing records prevent
bulk backup/import; valid bookmarks remain individually exportable. No record
is deleted automatically. Cancelled or timed-out merges may have completed one
atomic transaction before the response was lost; inspect stored entries before
retrying. Reimporting the same backup skips identical records.

Restoring a bookmark replays the saved commands and keeps its original deadline.
Time spent paused, closed or offline counts. Restoring an expired attempt does
not create a new recovery allowance. A recording-bound attempt requires its
original qualified owner asset to remain available.

**Enable offline edition** installs the complete static release. On a secure
origin or localhost, compatible browsers can install a standalone window through
their install or Add to Home Screen command. Installation UI varies by browser.
Service-worker updates wait until between attempts, refuse activation when
another application tab is open, and retain the prior complete edition if asset
verification fails. Worker source participates in the release commitment.
No notebook records, attempt files or participant responses enter the static
cache. Browser storage may still be cleared or evicted.

**Check saved offline files** is available during recovery too. It checks every
current-release cached asset and the cached manifest without network access,
cache creation, repair or deletion. Missing and altered counts stay separate;
an unavailable, malformed or timed-out worker response leaves completeness
unknown. An unchanged update also checks actual cached bytes before claiming
the offline edition is complete. Download important attempts separately. A cache
check is a point-in-time local consistency check, not a storage guarantee.

The software checks include persistent headless Chromium closing and reopening
offline, all three repairs, original-deadline resume and failed-update/multiple-tab
cases. They do not establish physical-device installation or human usability.

## Local capture and MCP

The capture inspector reads only these explicitly selected filenames:
`recording.json`, `manifest-pending.json`, `status.json`, `replay.json`,
`behavioral-verification.json` and `exchanges.ndjson`. Do not select credentials
or configuration files. The tool accepts at most 8 MiB combined and 10,000
exchange rows. Unknown cost remains unknown. Selected claims are unauthenticated;
inspection neither calls a provider nor reruns qualification.

Start the real local MCP playground:

```sh
npm run mcp:playground
```

Enter one canonical board request per line, for example:

```json
{"schema_version":"1.0","request_id":"inspect-1","action":{"type":"inspect","target":"board"}}
```

Use the observed revision for a subsequent mutation. Reusing an ID with the same
payload returns the retained response; a different payload conflicts. The host
owns identity, phase and world truth. Limits are 64 requests, 64 KiB per request,
1 MiB total input and a 60-second session. Child transport cleanup runs on exit.
This CLI is separate from the public browser application.

All new public aids are absent from matched local rehearsal. The collector stays
disabled. Fixtures, scripted previews, generated test sequences and synthetic
rehearsals are not genuine model or human-study evidence.
