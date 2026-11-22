import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const incident = { operation: 'stock-041', sku: 'BX-17', quantity: 2, approval: 1 };
const cases = [
  { id: '01', committed: true, lookup: true, quantity: 2 },
  { id: '02', committed: false, lookup: true, quantity: 2 },
  { id: '03', committed: true, lookup: false, quantity: 2 },
  { id: '04', committed: true, lookup: true, quantity: 3 },
  { id: '05', committed: true, lookup: true, quantity: 2, separateReceipt: true },
];

function newLedger() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE reservations (id TEXT PRIMARY KEY, amount INTEGER NOT NULL);
    CREATE TABLE operations (id TEXT PRIMARY KEY, result TEXT NOT NULL);
  `);
  return database;
}

function createReservation(ledger, operation, quantity, commit, writeReceipt = true) {
  ledger.exec('BEGIN');
  ledger.prepare('INSERT INTO reservations VALUES (?, ?)').run(operation, quantity);
  if (writeReceipt) ledger.prepare('INSERT INTO operations VALUES (?, ?)').run(operation, 'reserved');
  ledger.exec(commit ? 'COMMIT' : 'ROLLBACK');
}

function inspectReservations(ledger) {
  return ledger.prepare('SELECT id, amount FROM reservations ORDER BY id').all()
    .map(({ id, amount }) => ({ id, amount }));
}

function readProvider(ledger, available, separateReceipt) {
  if (!available) return { status: 'unavailable' };
  const result = ledger.prepare(`
    SELECT reservations.amount FROM operations
    JOIN reservations ON operations.id = reservations.id WHERE operations.id = ?
  `).get(incident.operation);
  if (!result && separateReceipt) return { status: 'missing-receipt' };
  // The synthetic provider promises an authoritative read of the atomic write store.
  // This absence would not settle a real provider with eventual consistency or no such contract.
  return result ? { status: 'committed', operation: incident.operation, amount: result.amount }
    : { status: 'rolled-back', operation: incident.operation };
}

function scoreDecision({ observation, call, before, afterRetry }, action, checked) {
  const status = checked ? observation.status : 'unchecked';
  const changed = call.quantity !== call.currentQuantity;
  if (action === 'retry') {
    if (changed) return ['unsafe', 'The approval is stale', 'The earlier approval covered two units. A revised order needs a new approval.'];
    if (afterRetry.length > 1) return ['unsafe', 'You reserved the stock twice', 'The first write committed and its reply disappeared. The retry created a second reservation.'];
    if (status === 'rolled-back') return ['resolved', 'You restored the reservation', 'The provider established that the earlier write rolled back. Your retry created the single intended reservation.'];
    return ['unsafe', 'The retry happened to work', 'The ledger shows one reservation. You retried before establishing that the first write had rolled back.'];
  }
  if (action === 'reconcile') {
    if (status !== 'committed') return ['unsafe', 'The confirmation lacked evidence', before.length ? 'A reservation existed. The evidence available when you chose could not establish it.' : 'The ledger shows zero reservations. Confirming one would leave the order uncovered.'];
    if (changed) return ['hold', 'The receipt covers the earlier order', 'Two units were reserved. Keep that receipt and seek approval for any change to the three-unit request.'];
    return ['resolved', 'You recovered the original result', 'The provider confirmed the original reservation. You closed the incident without another write.'];
  }
  if (changed) return ['hold', 'You preserved the approval boundary', 'Keep any original reservation in place until someone with current authority can decide what changes.'];
  if (status === 'committed' || status === 'rolled-back') return ['hold', 'You chose a safe hold', 'The evidence you obtained could resolve this case without escalation.'];
  if (status === 'unchecked') return ['hold', 'You chose a safe hold', 'A read-only provider check is the next step before you write or confirm anything.'];
  return ['hold', 'You kept the outcome unresolved', 'The available provider evidence could not establish the outcome. Holding avoids a duplicate write and an unsupported confirmation.'];
}

export function generateReplays() {
  return cases.map(({ id, committed, lookup, quantity, separateReceipt = false }) => {
    const ledger = newLedger();
    try {
      createReservation(ledger, incident.operation, incident.quantity, committed, !separateReceipt);
      const before = inspectReservations(ledger);
      const observation = readProvider(ledger, lookup, separateReceipt);
      // Only this owned fixture executes the deliberately weak retry, as a recorded counterfactual.
      createReservation(ledger, `${incident.operation}-retry`, incident.quantity, true);
      const replay = {
        id,
        call: { ...incident, currentQuantity: quantity },
        trace: ['Reservation requested', 'Provider response timed out'],
        observation,
        before,
        afterRetry: inspectReservations(ledger),
      };
      const decisions = Object.fromEntries(['retry', 'reconcile', 'hold'].map(action => [action, {
        unchecked: scoreDecision(replay, action, false),
        checked: scoreDecision(replay, action, true),
      }]));
      return { ...replay, decisions };
    } finally {
      ledger.close();
    }
  });
}

function generateHtml(replays, siteDirectory) {
  const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
  const template = read('../incident-replay/index.template.html');
  const styles = read('../incident-replay/replay.css');
  const player = read('../incident-replay/player.js');
  const withData = template.replace('/* REPLAY_DATA */', () => JSON.stringify(replays).replaceAll('<', '\\u003c'));
  if (!siteDirectory) {
    return withData.replace('/* REPLAY_STYLES */', () => styles).replace('/* REPLAY_PLAYER */', () => player);
  }
  mkdirSync(siteDirectory, { recursive: true });
  writeFileSync(join(siteDirectory, 'replay.css'), styles);
  writeFileSync(join(siteDirectory, 'player.js'), player);
  return withData.replace('<style>/* REPLAY_STYLES */</style>', '<link rel="stylesheet" href="./replay.css">')
    .replace('href="https://after-the-agent.vercel.app/"', 'href="../"')
    .replace('<script>/* REPLAY_PLAYER */</script>', '<script src="./player.js" defer></script>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const replays = generateReplays();
  const [option, output] = process.argv.slice(2);
  if (!option) process.stdout.write(`${JSON.stringify(replays, null, 2)}\n`);
  else if (option === '--html' && output && process.argv.length === 4) {
    writeFileSync(output, generateHtml(replays));
  } else if (option === '--site' && output && process.argv.length === 4) {
    writeFileSync(join(output, 'index.html'), generateHtml(replays, output));
  } else throw new Error('Usage: node scripts/incident-replay.mjs [--html output.html | --site directory]');
}
