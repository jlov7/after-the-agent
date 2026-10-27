# Security

The shipped browser instrument runs locally. It has no account system,
research collector, analytics or model connection. The MCP server is a local
stdio process and does not listen on a network port. Browser verdicts and
editable local records are not trusted research receipts or security boundaries.

## Reporting a problem

Once this repository is hosted, use its **Security > Report a vulnerability**
form if private reporting is enabled. Do not post credentials, participant data
or an exploit containing personal information in a public issue. If private
reporting is unavailable, open an issue containing only a high-level request
for a private reporting route. No external reporting service is configured by
this source distribution.

For ordinary defects, include the source revision, browser/runtime version,
fault, minimal actions and expected/observed behavior. Remove private data from
saved attempts and screenshots before sharing them.

## Boundaries

- Uploaded recordings and attempt files are untrusted. Size, structure, action
  contracts and replay are checked; uploads cannot promote a source category.
- The built site loads only local assets. A future host can observe ordinary
  HTTP requests; the no-research-collection statement does not describe that
  host's access logs or policy.
- Live capture is separate Node tooling. It requires explicit authorization,
  an exact model and finite budget. Keep credentials out of files, browser
  variables, command arguments and logs. Never run it on untrusted source.
- The reference hashes detect changed bytes against a pinned version. They
  do not prove authorship, independence, provider provenance or tamper resistance.

Only the current source version is maintained. Reproduce a report against it
before assuming an older archived build has the same behavior. No external
penetration test, formal security proof or production-service audit is claimed.
