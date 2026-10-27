import type { DomainEvent, Lamp } from '../../../../packages/contracts/src/index.js';
import './interaction.css';
const lamps: readonly Lamp[] = ['left', 'right', 'center'];
export function PulseTimeline({ tick, events }: { tick: number; events: readonly DomainEvent[] }) {
  const ticks = Array.from({ length: Math.min(16, tick + 1) }, (_, index) => Math.max(0, tick - 15) + index);
  const settled = new Set(events.filter(event => event.type === 'settled_tick').map(event => event.tick));
  const counts = new Map<string, number>();
  for (const event of events) if (event.type === 'pulse' && event.tick >= tick - 15 && event.tick <= tick) { const key = `${event.tick}.${event.lamp}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  return <section className="ata-pulse-timeline" aria-label="Recent actual pulses"><div className="ata-pulse-scroll" role="region" aria-label="Scrollable pulse counts" tabIndex={0}><table><caption>Actual output, last {ticks.length} settled ticks. Counts include duplicates.</caption><thead><tr><th scope="col">Lamp / tick</th>{ticks.map(value => <th scope="col" key={value}>{value}</th>)}</tr></thead><tbody>{lamps.map(lamp => <tr key={lamp}><th scope="row">{lamp}</th>{ticks.map(value => { const known = value === 0 || settled.has(value), count = counts.get(`${value}.${lamp}`) ?? 0; return <td key={value} data-pulse-count={known ? count : undefined} className={count > 1 ? 'ata-pulse-duplicate' : count ? 'ata-pulse-output' : ''}>{known ? count : <span title="Settled tick is absent from the supplied event history">Unknown</span>}</td>; })}</tr>)}</tbody></table></div></section>;
}
