/* global document */
'use strict';

const byId = id => document.getElementById(id);
const replays = JSON.parse(byId('replay-data').textContent);
const checking = byId('check');
const outcome = byId('outcome');
const actionButtons = [...document.querySelectorAll('[data-action]')];
let current = 0;
let checked = false;
let decided = false;

function describe(rows) {
  const units = rows.reduce((total, row) => total + row.amount, 0);
  return `${rows.length} ${rows.length === 1 ? 'reservation' : 'reservations'}, ${units} units`;
}

const tabs = replays.map((replay, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Case ${replay.id}`;
  button.addEventListener('click', () => showCase(index));
  byId('cases').append(button);
  return button;
});

function showCase(index, focus = true) {
  current = index;
  checked = false;
  decided = false;
  const { id, call, trace } = replays[index];
  byId('case-number').textContent = `Case ${id} / ${String(replays.length).padStart(2, '0')}`;
  byId('request').textContent = `Operation ${call.operation}. Approved request: ${call.quantity} units of ${call.sku}.`;
  if (call.currentQuantity !== call.quantity) {
    byId('request').textContent += ` The order now asks for ${call.currentQuantity} units.`;
  }
  byId('trace').textContent = trace.join(' → ');
  byId('provider').textContent = 'Unchecked';
  tabs.forEach((button, tabIndex) => {
    if (index === tabIndex) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  checking.disabled = false;
  checking.removeAttribute('aria-disabled');
  checking.textContent = 'Check provider record';
  actionButtons.forEach(button => { button.disabled = false; });
  outcome.hidden = true;
  if (focus) byId('case-heading').focus();
}

function readRecord() {
  if (checked || decided) return;
  checked = true;
  const { observation } = replays[current];
  const messages = {
    committed: `Committed: ${observation.amount} units reserved under ${observation.operation}.`,
    'rolled-back': 'The authoritative store confirms the original write rolled back.',
    unavailable: 'Provider lookup unavailable. The original outcome is still unknown.',
    'missing-receipt': 'The lookup found no receipt. This provider can commit before recording a receipt, so the outcome is unknown.',
  };
  byId('provider').textContent = messages[observation.status];
  checking.setAttribute('aria-disabled', 'true');
  checking.textContent = 'Provider record checked';
}

function decide(action) {
  if (decided) return;
  decided = true;
  const replay = replays[current];
  const [score, heading, reason] = replay.decisions[action][checked ? 'checked' : 'unchecked'];
  outcome.dataset.score = score;
  byId('outcome-type').textContent = { unsafe: 'Unsafe decision', resolved: 'Resolved', hold: 'Held for review' }[score];
  byId('outcome-heading').textContent = heading;
  byId('reason').textContent = reason;
  byId('before').textContent = describe(replay.before);
  byId('after').textContent = describe(action === 'retry' ? replay.afterRetry : replay.before);
  byId('retry-comparison').hidden = action === 'retry';
  byId('retry-effect').textContent = describe(replay.afterRetry);
  byId('next').textContent = current === replays.length - 1 ? 'Return to case 01' : 'Try the next case';
  checking.disabled = true;
  actionButtons.forEach(button => { button.disabled = true; });
  outcome.hidden = false;
  byId('outcome-heading').focus();
}

checking.addEventListener('click', readRecord);
actionButtons.forEach(button => button.addEventListener('click', () => decide(button.dataset.action)));
byId('next').addEventListener('click', () => showCase((current + 1) % replays.length));
showCase(0, false);
