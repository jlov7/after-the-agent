# Portability and offline integrity

These four additions extend existing workflows. They do not alter the engine,
the action contract, the recorded model run or either local study arm.

| Addition | Benefit | Acceptance |
| --- | --- | --- |
| Open a verification packet in replay | Keep the complete file usable in the browser as well as the independent CLI. | Bounded worker checks inventory and embedded source binding, reconstructs the attempt, retains exact packet and attempt bytes, rejects corruption and supports cancellation. Browser inspection does not run Python, verify all retained scores or authenticate provenance. |
| Notebook backup and import | Move named bookmarks between browser profiles without losing their dates or original attempt bytes. | Explicit preview, one atomic merge, identical IDs skipped, conflicting IDs rejected, 20 entries and 32 MiB raw quota retained. One bad entry or concurrent quota failure writes nothing. Import does not resume an attempt. |
| Download retained autosave | Recover saved bytes even when an attempt is abandoned or damaged. | Export is independent of restoration and preserves exact bytes, with raw-format and local-disposition warnings. It does not revive an attempt, clear evidence or change the current board. |
| Check offline files | Detect cache eviction or corruption after a successful installation. | Read only, bounded message and timeout, every current-release cached asset checked against the worker's embedded inventory. Missing, altered and unavailable results stay distinct. No network fetch, activation, repair, deletion or plant mutation during the check. |

Use existing JSON and Zod boundaries and browser workers. No dependency or server
is needed. Keep imported names as text. Preserve existing records on every import
failure. A backup may be larger than the raw quota because JSON escapes embedded
attempt strings. Cap its file size at twice the raw quota plus 64 KiB of metadata.

Verification records real commands, red/green regressions, production browser
journeys, screenshots and fresh reviewer findings. Software evidence remains
separate from genuine model provenance, human observation and research readiness.
