import { useMemo } from 'react';
import type { CanonicalPlant, DomainEvent } from '../../../../packages/contracts/src/index.js';
export function Installation({ plant, events, setup = false }: { plant: CanonicalPlant; events: readonly DomainEvent[]; setup?: boolean }) {
  const pulses = useMemo(() => events.filter(event => event.type === 'pulse'), [events]);
  const nextFire = (Math.floor(plant.tick / 4) + 1) * 4;
  const due = plant.queue.length ? Math.min(...plant.queue.map(job => job.due_tick)) : null;
  const gateOpen = plant.config.gate_mode === 'live' ? plant.world.active : plant.gate_cache.active;
  return <section className="installation" aria-label={setup ? 'Actual setup state' : 'Current installation state'}>
    <div className="installation-context"><span>Scene <strong>{plant.world.scene_id}</strong> · {plant.world.active ? 'active' : 'inactive'} · version {plant.world.epoch}</span><span>Guard {plant.config.epoch_guard ? 'on' : 'off'} · settled tick {plant.tick}</span></div>
    <div className="lights">{(['left', 'center', 'right'] as const).map(lamp => <div className="light" key={lamp}><div className={`lamp${pulses.some(event => event.lamp === lamp && event.tick === plant.tick) ? ' signal' : ''}`} aria-hidden="true"/><span>{lamp.toUpperCase()}</span><strong aria-label={`${lamp.charAt(0).toUpperCase()}${lamp.slice(1)} pulse count`}>{pulses.filter(event => event.lamp === lamp).length}</strong><small>delivered pulses</small></div>)}</div>
    <div className="topology" aria-label="Fixed topology: clocks through gate and queue to lights"><div className="signal-source"><strong>Clocks</strong><span>Primary {plant.config.clocks.primary ? 'on' : 'off'} / standby {plant.config.clocks.shadow ? 'on' : 'off'}</span></div><span className="connector" aria-hidden="true">→</span><div><strong>Scene gate</strong><span>{plant.config.gate_mode === 'live' ? 'Live' : 'Cached'} · {gateOpen ? 'open' : 'closed'}</span></div><span className="connector" aria-hidden="true">→</span><div className="signal-queue"><strong>Queue</strong><span>{plant.queue.length} pending · guard {plant.config.epoch_guard ? 'on' : 'off'}</span></div><span className="connector" aria-hidden="true">→</span><div><strong>Outputs</strong><span>{pulses.length} delivered</span></div></div>
    <p className="upcoming">Next nominal firing <strong>tick {nextFire}</strong> · {due === null ? 'No queued delivery' : <>Earliest queued delivery <strong>tick {due}</strong></>}. A scheduled firing is not a guaranteed pulse.</p>
    {setup && <ul className="setup-queue">{plant.queue.map(job => <li key={job.id}><code>{job.id}</code><span>{job.lamp} · Due tick {job.due_tick} · queued version {job.enqueue_epoch} / current {plant.world.epoch}</span></li>)}{!plant.queue.length && <li>No pending work. The first firing is tick 4.</li>}</ul>}
  </section>;
}
