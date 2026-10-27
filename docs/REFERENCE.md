# Reference bytes and public packaging

The upstream semantic manifest is `REFERENCE_MANIFEST.json`, SHA-256
`2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f`.
It commits to 19 specification, schema, oracle, fixture, research and guard files.
The original bundle remains unchanged in the retained upstream source.

This public distribution contains **18 byte-identical reference files and one
protocol derivative with owner attribution removed**. No executable semantics,
schema, golden, scoring rule or study design changed. Its separate packaging
manifest is `PUBLIC_REFERENCE_MANIFEST.json`, SHA-256
`b30d96406f0b7344e135bd4f09b70a29543ef3d4e2d6e23ed72d421e33e18901`.
The sanitized protocol SHA-256 is
`5327c740e874889648e985f1602eb22ce2ccbff0c8e2a996a7d6b0ab4e3dde6d`.
The packaging profile is `public-1`; semantic reference version remains 1.0.0.

The shared adapter accepts only the original pinned profile or this exact public
profile. It validates the upstream manifest, all 19 paths and hashes, and the
one permitted document substitution. Unknown packaging profiles, missing files,
symlinks and a second changed file are rejected. Recordings continue to identify
the upstream semantic commitment; current verification records the packaging
profile separately.

```sh
node scripts/check-reference.mjs
npm run reference:prepare -- ../after-the-agent-reference
npm run verify
```

The snapshot command validates bytes before copying and refuses an existing
output. The full product gate requires a retained reference outside the source
checkout, checks it before use and again at completion, and invokes the separate
Python oracle. For an independently retained object, set `ATA_REFERENCE_DIR`.
A snapshot copied from a checkout is a reproducibility aid, not independent
provenance or a security boundary. Preserve a reference you trust separately.

The historical `scripts/verify_reference.py` remains unchanged. To invoke it
against the public document derivative, supply the public packaging manifest:

```sh
uv run --no-project python scripts/verify_reference.py \
  --manifest PUBLIC_REFERENCE_MANIFEST.json \
  --expected-manifest-sha b30d96406f0b7344e135bd4f09b70a29543ef3d4e2d6e23ed72d421e33e18901
```

The retained `verify_pack.py` checks the historical build handoff, including
implementation prompts absent from this source distribution. Its guard helpers
are tested, but its handoff command is not product verification. Use `npm run
verify` for the application.

## Public source scope

The public package includes the pinned scientific protocol and executable
reference checks. Operational launch plans, proposed spending, recruitment copy,
participant observation materials and launch configuration stay outside the
public source and its history. They are not requirements of the software gate.

Some frozen specification text refers to the original handoff or launch
documents. Those historical references do not mean the operational documents
are distributed here. The frozen bytes remain unchanged; the product gate
checks the application, synthetic rehearsal and reference behavior. It does
not establish readiness to recruit participants or run a study.
