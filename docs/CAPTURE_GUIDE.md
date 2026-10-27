# Capture and curate a real setup

Current genuine-recording status: **recorded and qualified**. The default selects the unchanged first construction attempt from 26 October 2026. It enabled the delivery guard, switched the gate to live, enabled the primary clock and advanced to tick 5. Replay and twelve independent Python continuations passed. The earlier inspect/advance run remains in the gallery. The authored takeover fault remains a separate controller action. See [the actual recording and limits](MODEL_RECORDING.md).

## Credential-free check

Use the pinned Node runtime from README.md. The output directory must be new or empty. Each failed or incomplete attempt is retained; do not reuse its directory.

```sh
npm run build:packages
node dist/packages/runner/src/capture-cli.js --dry-run --output work/recordings/owner-dry-run-001
```

The dry run starts the real stdio server, executes a fixture, replays every actual command and checks all twelve continuations using the independent external Python reference. It makes zero provider requests. It produces recording.json, exchanges.ndjson, replay.json, behavioral-verification.json and status.json. A replay-consistent trace whose target behavior fails remains failed.

## Existing-subscription capture

The reviewed optional route uses Codex CLI 0.160.1 with the exact requested model `gpt-6.1-sol`. It requires an existing ChatGPT login and a clean committed checkout. It does not create credentials, purchase credits, use an API key, or fall back to a paid API account. Using the existing subscription still consumes its normal allowance.

```sh
npm run build:packages
node dist/packages/runner/src/codex-capture-cli.js --authorised-subscription --output work/recordings/owner-codex-001
```

Before making an assessed call, the recorder tests the installed harness against a credential-free loopback provider. The observed model-visible inventory must contain exactly `board_action`. A valid construction must pass real stdio MCP, replay and all twelve independent Python continuations. A forced unadvertised tool must produce no board calls. These fixture probes remain labelled fixture and are retained separately from the genuine run.

The harness uses a restricted local model catalog, disables built-in execution and all other configured MCP servers for that process, and exposes one native function forwarded by the recorder through real stdio MCP. These are temporary process settings. The assessed model cannot edit the recorder's files or control identity, phase or world. Each run has hard limits of 16 native calls, 32 model items, 120 seconds and 8 MiB of harness output. There is no automatic assessed-run retry or model fallback. Cancellation and failed qualification retain the observed run.

The CLI does not expose individual provider request counts, a provider-returned model identifier, a configurable output-token ceiling, or invoice cost. Those accounting fields remain unknown with an explanation. Available token totals are CLI-reported. The manifest's prompt hash commits the exact task-prompt artifact; the system prompt and restricted catalog are separate retained artifacts. Native harness context can also contain the owner's global instructions. Raw reasoning and authentication headers are not retained. The API route below is available when explicit monetary reservation or direct provider receipts are required.

## Owner-authorized API invocation

Live execution needs explicit authorization for a particular account, exact model identifier and finite spend. None is supplied by this build. The credential-free `capture-live.template.json` deliberately fails validation until those owner fields are completed. It contains no guessed model or price.

Copy the template to `work/owner-reviewed-capture.json`. Set the same available exact model ID in both model and budget.model, a nonsecret account label, the actual authorization reference, approved micro-USD ceiling, and current official input/output pricing in micro-USD per million tokens. Retain the official pricing receipt, its SHA-256, source URL and observation time. The receipt must be at most 24 hours old when capture begins. Check account billing assumptions, including the conservative request overhead. A token limit alone is not a spending authorization. The owner must verify the authorization and pricing receipt are authentic; field and freshness validation cannot establish that.

Keep the code committed and clean. Build it immediately before running the compiled entry point. Provision OPENAI_API_KEY to that process only through an owner-approved secret source; do not put it in commands, JSON, browser variables, logs or this repository. The build has not read or provisioned a key.

After those prerequisites are satisfied, the exact command is:

```sh
node dist/packages/runner/src/capture-cli.js --live --config work/owner-reviewed-capture.json --output work/recordings/owner-live-001
```

The recorder checks actual source cleanliness before credential lookup and writes. It offers only the native board_action function, invokes actual MCP for every admitted board_action call, serializes mutations, bounds iterations/tool calls/output/time, and reserves a conservative charge before each provider request. Retries are bounded to three with backoff and jitter. Malformed envelopes and unknown tool names retain raw rejection receipts and fail before MCP dispatch. Incomplete, malformed, cancelled, unverified or behaviorally wrong attempts cannot become successful demonstrations. Missing observed usage or billed cost remains null. Inspect all retained attempts before selecting the first eligible successful setup under a prospectively declared bounded selection rule; selection does not establish a model success rate.

## Curate the public source

The working public loader reads only the owner-controlled local `apps/web/public/recordings/manifest.json`. Its shipped selection is the committed genuine recording described in [the capture receipt](MODEL_RECORDING.md). Query parameters and visitor uploads cannot select a genuine source.

For the first recorded demonstration, select an unchanged successful stale-queue setup at settled tick 5. It must retain its actual tick-4, due-6, epoch-1 left job, use exactly one clock, live gate and enabled delivery guard. An empty queue can pass continuation scoring but is unsuitable for this inherited-work demonstration. The session separately records the controller's guard-off fault after replay, without advancing time. It never manufactures queued work or rewrites assessed actions.

After an authorized capture, review the actual provider exchanges and manifest, replay and twelve-case Python qualification. Copy the unchanged recording and behavioral-verification JSON to owner-chosen local files beneath `apps/web/public/recordings/curated/`. Hash each exact file's bytes. Set the committed manifest to:

```json
{
  "schema_version": "1.0",
  "selected": {
    "id": "owner-selected-run-001",
    "category": "live_model",
    "recording": { "path": "recordings/curated/owner-run-001.json", "sha256": "OWNER_SET_64_HEX_SHA256" },
    "qualification": { "path": "recordings/curated/owner-behavior-001.json", "sha256": "OWNER_SET_64_HEX_SHA256" }
  }
}
```

This example is intentionally invalid until real hashes are supplied. The shipped manifest contains the exact hashes of the actual selected recording and qualification. The acceptance gate requires genuine-source browser journeys and recording evidence. For any replacement, update the evidence and provenance assertions to that observed model and source. Preserve the engine, Python and replay checks; review the replacement independently. Commit the reviewed selection, run the complete product gate and inspect the actual recorded presentation before considering publication. The loader validates bounded local assets, exact commitments, provenance, command re-execution and qualification. Resume requires the same curated source and original deadline. Hashes bind retained bytes; they do not independently authenticate the provider or who generated them. Curation requires owner review of observed evidence.

The bundled fixture manifest under `recordings/fixtures/` exercises the same loader and recovery path in tests. Its category is fixture and its presentation remains Scripted preview. It is not selected by the default build.

## Fixed construction profile

The optional `--construction` flag follows `--authorised-subscription` on the
Codex capture command. It selects a host-owned setup with both clocks off, a
cached gate and the delivery guard off. Task and world truth are unchanged.
Independent oracle cases reject each missing setting and accept either clock.
The public loader admits only this exact profile and the original canonical
profile. All captured revisions, events, request IDs and pending work remain
unchanged. The real stdio host accepts this flag only with setup mode for the
stale-queue scenario.
