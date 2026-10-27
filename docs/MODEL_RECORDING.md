# Selected genuine recording

On 26 October 2026, an assessed Codex run used the existing ChatGPT subscription
through Codex CLI 0.160.1, requesting `gpt-6.1-sol`. Its only advertised native
tool was `board_action`, forwarded through the real stdio MCP adapter.

The selected run is `d6f9f175-a8f0-4921-8f10-4b31fb3b5a8b`. It began with both
clocks off, a cached gate and the delivery guard off. Task and world truth were
unchanged. The first assessed attempt completed in 18,810 ms with five calls:

1. Inspect the board at tick 0.
2. Enable the delivery guard.
3. Switch the gate to live.
4. Enable the primary clock.
5. Advance five ticks.

All three configuration edits changed the actual starting state. Independent
Python cases show that omitting any of these settings fails; either single
clock is valid. Replay reproduced every retained result, revision and event.
The actual pending `primary.4.left` job remains enqueued at tick 4, due at tick
6 and bound to scene version 1. Independent Python qualification passed all
twelve continuations. The public session then applies a separate controller
action to turn the guard off. That fault and the captions are authored.

| Item | Retained value |
| --- | --- |
| Requested model | `gpt-6.1-sol` |
| Provider-returned model identity | Unavailable, null |
| Individual provider request count | Unavailable, null |
| Actual native board calls | 5 |
| CLI-reported token totals | 25,203 input, 261 output |
| Invoice cost | Unavailable, null |
| Capture source commit | `ad569447495af9bacbd28874042add32f3b9ba6a` |
| Source custody | Clean and unchanged throughout capture |
| MCP SDK / protocol | 2.3.1 / 2026-07-28 |

The [owner selection](../apps/web/public/recordings/manifest.json) pins unchanged
[recording bytes](../apps/web/public/recordings/curated/codex-2026-10-26-001.json)
and [qualification bytes](../apps/web/public/recordings/curated/codex-2026-10-26-001-qualification.json).
The capture commit identifies the original local source context. The public
distribution has fresh, sanitized Git history; that private-context commit is
not a claim about a reachable public ancestor. Packaging does not rewrite the
captured manifest.

Before the assessed call, credential-free native-harness probes observed only
`functions.board_action`. Six fixture calls configured the same construction
profile through real MCP and qualified successfully. A forced unadvertised
`apply_patch` produced zero board calls and left the board unchanged. These
probes are fixtures. Temporary process settings disabled the native shell and
other MCP tools; the outer recorder retained identity, phase and world authority.
Limits were 16 native calls, 32 model items, 120 seconds and 8 MiB of output.

The prospectively committed rule allowed at most three assessed attempts and
selected the first unchanged qualified construction with its inherited job.
One preflight stopped on generated screenshot changes before a model call;
those screenshots were retained separately. The first assessed attempt then
qualified, so no further attempt was made. This is a selected demonstration,
not a success-rate estimate or comparison with another model. There was no paid
API fallback, credit purchase, new credential provisioning or publication.

## Earlier recording retained

The gallery also retains the unchanged 20 October run
`00de235e-71e7-41ff-9b7c-ad134f2130c6`. It inspected existing correct settings
and advanced five ticks; it made no configuration edit. Its two calls replay
and its twelve-case qualification remains available. The fixture keeps its
separate label. Old source-bound saved attempts can still find their source.

## Evidence limits

The local controller observed the existing authenticated harness. No
independently signed provider receipt is available. Hashes establish retained
byte consistency; they do not authenticate authorship or make local evidence
tamper-proof. The task prompt and separate system/catalog artifacts were
retained locally. Native harness context can include global instructions.
The source prompt hash does not claim to cover that entire context.

The acceptance gate exercises the actual selected default in a production
browser, distinguishes the fixture, reproduces failed and repaired exports
with Python, and checks source-bound resume and the original deadline. It
never makes another model request. Human usability remains unobserved.
Research collection remains disabled. Hosted CI and deployment have not run.
