import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { z } from 'zod';
import { inspectPublicFile } from './public-surface.mjs';
import { assertCleanVerifiedSource } from './verification-source.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = z.object({ implementation_commit: z.string().regex(/^[a-f0-9]{40}$/), clean_at_start: z.literal(true), software: z.object({ status: z.literal('passed') }), commands: z.array(z.object({ name: z.string(), executable: z.string(), arguments: z.array(z.string()), exit_code: z.literal(0), log: z.string(), log_sha256: z.string(), tests: z.unknown().optional() }).passthrough()).min(19), artifacts: z.array(z.object({ path: z.string(), sha256: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(readFileSync('evidence/product-verification.json', 'utf8')));
const git = spawnSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000 });
if (git.status !== 0 || git.stdout.trim() !== report.implementation_commit) throw new Error('Portable report must be generated on the exact successfully verified commit');
assertCleanVerifiedSource(report.implementation_commit);
const root = process.cwd();
for (const artifact of report.artifacts) {
  const path = resolve(artifact.path);
  if (!path.startsWith(root + sep) || hash(readFileSync(path)) !== artifact.sha256) throw new Error('Verification artifact is outside source or its bytes changed');
}
const prefixes = [root, process.env.ATA_REFERENCE_DIR, process.execPath, homedir()].filter(Boolean).sort((a, b) => b.length - a.length);
function portable(raw) {
  let value = raw;
  for (const prefix of prefixes) value = value.split(prefix).join('<local>');
  return value.replace(/\/(?:Users|home)\/[^\s`'"<>]+|\/private\/var\/[^\s`'"<>]+|\/var\/folders\/[^\s`'"<>]+/g, '<local>');
}
mkdirSync('verification/commands', { recursive: true });
const files = [];
function publish(path, bytes) {
  const value = Buffer.from(portable(bytes.toString('utf8')));
  if (inspectPublicFile(path, value).length) throw new Error(`Portable evidence still has a public-surface finding: ${path}`);
  writeFileSync(path, value); files.push({ path, bytes: value.length, sha256: hash(value) });
}
const commands = report.commands.map(command => {
  if (hash(readFileSync(command.log)) !== command.log_sha256) throw new Error('Command log differs from verified bytes');
  const log = `verification/commands/${basename(command.log)}`;
  publish(log, readFileSync(command.log));
  return { name: command.name, executable: basename(command.executable), arguments: command.arguments, scope: command.name === 'external-reference' ? 'retained_reference' : 'product', exit_code: command.exit_code, started_at: command.started_at, finished_at: command.finished_at, tests: command.tests ?? null, log, original_log_sha256: command.log_sha256, published_log_sha256: files.at(-1).sha256 };
});
publish('verification/mutants.json', readFileSync('evidence/mutants.json'));
const benchmark = JSON.parse(readFileSync('evidence/quality/benchmark.json', 'utf8'));
publish('verification/benchmark.json', Buffer.from(JSON.stringify(benchmark, null, 2) + '\n'));
const upgrade = JSON.parse(readFileSync('evidence/instrument-upgrade.json', 'utf8'));
publish('verification/instrument-upgrade.json', Buffer.from(JSON.stringify(upgrade, null, 2) + '\n'));
const full = JSON.parse(readFileSync('evidence/full-roadmap/software.json', 'utf8'));
publish('verification/full-roadmap.json', Buffer.from(JSON.stringify(full, null, 2) + '\n'));
const twelve = JSON.parse(readFileSync('evidence/twelve/software.json', 'utf8'));
publish('verification/twelve-additions.json', Buffer.from(JSON.stringify(twelve, null, 2) + '\n'));
const portability = JSON.parse(readFileSync('evidence/portability/software.json', 'utf8'));
publish('verification/portability.json', Buffer.from(JSON.stringify(portability, null, 2) + '\n'));
publish('verification/v1.json', readFileSync('evidence/v1/software.json'));
mkdirSync('verification/clarity', { recursive: true });
publish('verification/clarity/construction-oracle.json', readFileSync('evidence/clarity/construction-oracle.json'));
for (const browser of ['chromium', 'firefox', 'webkit']) {
  mkdirSync(`verification/clarity/${browser}`, { recursive: true });
  for (const width of [1440, 390]) {
    publish(`verification/clarity/${browser}/journey-${width}.json`, readFileSync(`evidence/clarity/browser/${browser}/journey-${width}.json`));
    const source = `evidence/clarity/browser/${browser}/result-${width}.png`, path = `verification/clarity/${browser}/result-${width}.png`, bytes = readFileSync(source);
    copyFileSync(source, path); files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
}
for (const browser of ['chromium', 'firefox', 'webkit']) {
  mkdirSync(`verification/v1/${browser}`, { recursive: true });
  for (const name of readdirSync(`evidence/v1/browser/${browser}`)) {
    const source = `evidence/v1/browser/${browser}/${name}`, path = `verification/v1/${browser}/${name}`;
    if (name.endsWith('.json')) publish(path, readFileSync(source));
    else if (name.endsWith('.png')) { const bytes = readFileSync(source); copyFileSync(source, path); files.push({ path, bytes: bytes.length, sha256: hash(bytes) }); }
  }
}
for (const name of ['packet-roundtrip', 'notebook-roundtrip', 'autosave-rescue', 'offline-audit']) publish(`verification/portability-${name}.json`, readFileSync(`evidence/portability/browser/${name}.json`));
publish('verification/reproducible-builds.json', readFileSync('evidence/twelve/reproducible/receipt.json'));
publish('verification/full-packet.json', readFileSync('evidence/twelve/browser/packet-verification.json'));
publish('verification/packet-tamper-rejection.json', readFileSync('evidence/twelve/browser/packet-tamper-rejection.json'));
publish('verification/genuine-browser.json', readFileSync('evidence/genuine-browser/verification.json'));
publish('verification/recording-status.json', readFileSync('evidence/recording-status.json'));
publish('verification/offline.json', readFileSync('evidence/offline-verification.json'));
publish('verification/stateful-negative-control.json', readFileSync('evidence/full-roadmap/stateful-negative-control.json'));
publish('verification/browser-diagnostic.json', readFileSync('evidence/full-roadmap/browser-diagnostic.json'));
mkdirSync('verification/screenshots', { recursive: true });
for (const screenshot of [...upgrade.screenshots, ...full.screenshots, ...twelve.screenshots]) {
  const path = `verification/screenshots/${basename(screenshot.path)}`;
  copyFileSync(screenshot.path, path);
  files.push({ path, bytes: readFileSync(path).length, sha256: hash(readFileSync(path)) });
}
for (const name of ['desktop.png', 'mobile.png', 'gallery.png']) {
  const path = `verification/screenshots/genuine-${name}`;
  copyFileSync(`evidence/genuine-browser/${name}`, path);
  files.push({ path, bytes: readFileSync(path).length, sha256: hash(readFileSync(path)) });
}
for (const screenshot of portability.screenshots) {
  const path = `verification/screenshots/portability-${basename(screenshot.path)}`;
  copyFileSync(screenshot.path, path); files.push({ path, bytes: readFileSync(path).length, sha256: hash(readFileSync(path)) });
}
const environment = JSON.parse(readFileSync('evidence/product-environment.json', 'utf8'));
const summary = { schema_version: '1.0', evidence_class: 'local_software_verification', implementation_commit: report.implementation_commit, clean_at_start: true, started_at: report.started_at, finished_at: report.finished_at, software: report.software, commands, required_artifact_checks: report.artifact_checks, environment, genuine_model_recording: report.genuine_model_recording, human_usability_observation: report.human_usability_observation, research: report.research, hosted_release: { status: 'not_run' }, published_files: files, log_transformation: 'Known local source/runtime/home/reference prefixes and remaining machine paths replaced with <local>. Original and published log hashes remain distinct. Full raw artifacts stay local.', claim_ceiling: 'Local reproducible software evidence and one observed assessed-model recording. Local custody is not independent provider authentication. Human outcomes, research validity, hosted CI and deployment are not established.' };
publish('verification/product-verification.json', Buffer.from(JSON.stringify(summary, null, 2) + '\n'));
const counts = commands.filter(command => command.tests).map(command => `| ${command.name} | ${command.tests.passed} | ${command.tests.failed} | ${command.tests.skipped} |`).join('\n');
const killed = JSON.parse(readFileSync('evidence/mutants.json', 'utf8')).mutants;
const text = `# Build report\n\nLocal software verification **passed** on ${report.finished_at}.\n\nChecked source commit: \`${report.implementation_commit}\`. The generated report\nand this document are retained afterward; they do not claim that a later source\nchange was tested. [Portable command evidence](verification/product-verification.json)\nrecords actual exits and runtime/dependency versions. Raw machine-specific logs\nremain local.\n\n| Suite | Passed | Failed | Skipped |\n| --- | ---: | ---: | ---: |\n${counts}\n\nAll ${commands.length} required commands exited 0. The reference adapter and\nindependent Python oracle, real stdio MCP, replay, production browser journeys\nand final-drain checks ran. ${killed.filter(item => item.status === 'killed').length}\nnamed broken behaviors were detected; the valid standby-only repair was accepted.\n[Mutation evidence](verification/mutants.json) and\n[browser timings](verification/benchmark.json) are retained. Timing p95 was\n${benchmark.summary.interaction.p95_ms} ms for interaction and\n${benchmark.summary.scoring.p95_ms} ms for rendered twelve-case scoring, against\nfixed 100/150 ms local ceilings.\n\nThe public packaging profile preserves 18 upstream reference files byte for byte\nand one protocol derivative with owner attribution removed. Executable oracle,\nschemas, goldens and guard tests are unchanged. See [reference custody](docs/REFERENCE.md).\n\nVersion ${JSON.parse(readFileSync("package.json", "utf8")).version} retains the public mobile action dock, three isolated engine lessons,\ntick-by-tick frozen continuations, actual job lineage and frozen repair comparison.\nThe [upgrade evidence](verification/instrument-upgrade.json) retains actual journey\nnames and [screenshots](verification/screenshots/mobile-edit.png). Tests check that\ninspection and lessons preserve the live board and original deadline, and that\nmatched local rehearsal receives none of these public aids. Frozen reference and\nscoring semantics remain unchanged.\n\nAll sixteen software additions are implemented. The [complete feature evidence](verification/full-roadmap.json) records actual browser journeys and seven additional screenshots. It covers command replay and first divergence, complete searchable history, printable reports, one-case reproducers, local notebook, capture inspection, owner gallery, offline installation, real MCP playground and generated stateful sequences. [Offline evidence](verification/offline.json) records a closed-browser reopen, all three repairs and original-deadline resume. [Stateful negative control](verification/stateful-negative-control.json) records the minimized deliberately broken clone; no new engine defect is claimed. The gallery contains the unchanged qualified genuine Codex recording and a separately labelled fixture. [Genuine browser verification](verification/genuine-browser.json) checks both verdicts with independent Python, exact model calls, the separately authored controller fault, preserved queued work, accessibility and source-bound resume. [Recording details](docs/MODEL_RECORDING.md) state the actual configuration changes and the unavailable provider metadata.\n\nAll twelve further additions are implemented. [Version 0.4 evidence](verification/twelve-additions.json) records actual production journeys, including trace explanations, edit receipts, event-stop Run, pulse counts, two-tab saving/transfer, reset retirement, same-base repair branches, replay notes, keyboard commands and browser checks. [Full-packet verification](verification/full-packet.json) reconstructs every browser-exported check through the independent oracle; a [later forged verdict is rejected](verification/packet-tamper-rejection.json). The schema-guided MCP builder is exercised over real stdio. [Reproducibility](verification/reproducible-builds.json) records two clean builds with identical distributable bytes and a detected changed-file control.\n\nFour portability additions are implemented. [Portability evidence](verification/portability.json) records exact packet reopening, atomic notebook migration, retained-autosave rescue, corruption/conflict/concurrent-quota rejection, keyboard phone reflow and offline cache-loss detection. Browser packet inspection does not run Python or authenticate provenance.\n\nVersion 1.1 clarifies edit feedback, explains the twelve future scenarios before technical details, and separates resumable progress files from evidence exports. The selected genuine setup made three necessary configuration edits, with its five calls replayed unchanged. The earlier inspect/advance source remains in the gallery. [Construction oracle checks](verification/clarity/construction-oracle.json) reject every omitted setting and accept either clock. The per-browser receipts and screenshots under verification/clarity retain desktop and phone save/export, replay and deadline checks.\n\nV1 adds replay-validated stale-restore rejection, ownership-race protection, verified offline repair and clearer settings/results. [V1 software evidence](verification/v1.json) and the per-browser receipts/screenshots under verification/v1 record all three faults at desktop, 390px and 320px in Chromium, Firefox and WebKit, original-deadline restoration, packet roundtrips, offline recovery, keyboard and 200% CSS zoom. Automated checks do not establish human usability.\n\n| Evidence class | Status |\n| --- | --- |\n| Local software | Passed, on the checked commit above |\n| Genuine assessed-model recording | Passed: one observed, unchanged, replayed and qualified subscription run |\n| Human usability | Unobserved; automated interaction is software evidence |\n| Research | Collection disabled; synthetic rehearsal only, no study launched |\n| Hosted CI and deployment | Not run |\n\nThe MIT license covers the source. The build emits exact bundled dependency\nlicenses. The default genuine recording replays locally. Public play sends no research events or\nparticipant text to a server/model. Browser scores and hashes are local\nconsistency evidence, not authoritative research receipts or provider provenance.\n\nThe known limits are unmeasured first-use conceptual difficulty and learning benefit,\nunobserved unfamiliar-human/assistive-technology use and unobserved hosted\nconfiguration. Research service/review/sample/budget decisions\nand recruitment are separate work. No public release action was performed by\nthis local verification. Follow [publication steps](docs/PUBLICATION.md) when approved.\n`;
publish('BUILD_REPORT.md', Buffer.from(text));
process.stdout.write(JSON.stringify({ event: 'portable_evidence_written', commands: commands.length, files: files.length, source_commit: report.implementation_commit }) + '\n');
