# Publish a verified instrument

The current source and static build are prepared for a public experimental
instrument release, including one qualified genuine recording. Its five calls
inspect the board, enable the delivery guard, select the live gate, enable the
primary clock and advance to tick 5. The three configuration edits change the
starting state. A separate controller then applies the authored recovery fault.
Keep this attribution, the explicit limits in MODEL_RECORDING.md and the disabled
collector. Human usability and
research outcomes remain unobserved and are not claims of this release.
Publication itself is an owner decision.

## Before uploading

1. Use the prepared public source directory and its fresh Git history. Preserve
   its license, third-party notices and reference packaging documentation.
2. Run `npm ci --ignore-scripts`, prepare or supply the retained external
   reference, install Playwright Chromium, Firefox and WebKit, then run `npm run verify` from clean
   source. `npm run report:portable` produces shareable command receipts with
   machine paths removed. The raw local logs are not publication files.
3. Run `npm run check:public` on the intended public history and
   `node scripts/public-surface.mjs --static apps/web/dist` on the actual site.
   Run the local secret/history scanner. Review every finding and the archive
   manifest; no scanner proves the absence of all sensitive information.
4. Inspect the actual welcome, setup, failed/held repair, resume, mobile and
   keyboard flows. Confirm that query parameters cannot enable research.

## Repository hosting

Create or select the intended repository only after choosing its visibility.
Use only the separately prepared public source and its sanitized history. The
private working repository contains operational plans and raw local evidence;
do not push it or copy its history. Push the reviewed public source, fresh-clone
that exact remote revision, and rerun installation/build and the complete gate.
Inspect the hosted Actions run;
a workflow file or local success does not prove remote CI passed.

Set a factual description, license and appropriate topics. Do not add badges
that imply an unobserved passing hosted run. Enable private vulnerability
reporting and repository secret scanning where available. Apply branch
protection and required checks appropriate to the actual host/account. These
settings are not configured by the source files.

## Static hosting

For a repository site, build with `BASE=/repository-name/`. For a domain root,
use `BASE=/`. The checked distribution uses `/after-the-agent/`. Serve the
contents of `apps/web/dist` at the matching path and retain all worker, source
excerpt, recording and license assets. Vite preview is a local check server.

The manual Pages workflow verifies the source before building/deploying and
uses the `public-release` environment. Configure any required reviewers in that
environment before dispatching it. Do not dispatch until publication is approved.
No automated push-trigger deployment is included.

After deployment, check the real URL from a clean browser, failed and held
repairs, worker loading, source/license links, mobile layout and the host's
logging/privacy policy. Consider host response headers such as
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a suitable
Content Security Policy. Verify actual behavior after configuration.

The workflow follows [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
with pinned action revisions, read-only verification permissions, no persisted
checkout credentials and no privileged untrusted pull-request execution.
Subpath handling follows [Vite's production build documentation](https://vite.dev/guide/build).

Hosted configuration, deployment and post-deploy verification remain unobserved
until performed against the chosen remote. Research launch, provider calls and
recruitment are separate decisions.
