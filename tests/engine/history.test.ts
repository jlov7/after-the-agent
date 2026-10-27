import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { History } from '../../apps/web/src/components/History.js';
import type { BoardRequest, DomainEvent } from '../../packages/contracts/src/index.js';
import { dispatch, engineAudit } from '../../packages/engine/src/engine.js';
import { createScenario } from '../../packages/engine/src/scenarios.js';
import { historyRows, filterHistory, historyPage } from '../../apps/web/src/components/history-model.js';
const events: DomainEvent[] = Array.from({length:137},(_,i)=>({seq:i+1,tick:i,type:'pulse',job_id:i%2?'odd':'even',lamp:'left'}));
it('returns every matching event exactly once across bounded stable pages including settled ticks',()=>{
 const rows=historyRows([...events,{seq:138,tick:137,type:'settled_tick'}],[]);
 expect(rows).toHaveLength(138);
 const found=filterHistory(rows,{query:'',from:'',to:'',type:'all',job:'',request:''});
 const paged=[0,1,2].flatMap(page=>historyPage(found,page).rows);
 expect(paged.map(r=>r.key)).toEqual(rows.map(r=>r.key));
 expect(new Set(paged.map(r=>r.key)).size).toBe(138);
 expect(historyPage(found,999).rows).toHaveLength(38);
 expect(historyPage(found,0).rows).toHaveLength(50);
});
it('combines tick/type/job/request filters and exposes only actual rejected command rows',()=>{
 const scenario=createScenario('valid-pending'),commands=scenario.commands;
 dispatch(scenario.engine,{schema_version:'1.0',request_id:'rejected.90',expected_revision:999,action:{type:'refresh_gate'}},{actor_id:'test-human',role:'human',phase:'recovery'});
 const rejected=engineAudit(scenario.engine).at(-1)!;
 const rows=historyRows(events,[...commands,rejected]);
 expect(rows.filter(r=>r.type==='rejected_command')).toHaveLength(1);
 expect(filterHistory(rows,{query:'REVISION_CONFLICT',from:'4',to:'6',type:'rejected_command',job:'',request:'rejected.90'}).map(r=>r.key)).toEqual(['command.'+rejected.seq]);
 expect(filterHistory(rows,{query:'',from:'4',to:'8',type:'pulse',job:'even',request:''}).map(r=>r.tick)).toEqual([4,6,8]);
 expect(filterHistory(rows,{query:'',from:'bogus',to:'',type:'all',job:'',request:''})).toEqual([]);
});

it('preserves the simple matched-rehearsal history, focus targets and last24 omission rule',()=>{
 const html=renderToStaticMarkup(createElement(History,{events:[...events,{seq:138,tick:137,type:'settled_tick'}]}));
 expect(html).toContain('id="history"');expect(html).toContain('id="history-heading" tabindex="-1"');expect(html).toContain('id="history-events"');
 expect(html.match(/<li>/g)).toHaveLength(24);expect(html).not.toContain('Search history');expect(html).not.toContain('Tick settled');expect(html).toContain('Tick 136');
});

it('renders actual malformed-request rejections even when the engine audit cannot promise a canonical request',()=>{
 const scenario=createScenario('valid-pending');
 dispatch(scenario.engine,null as unknown as BoardRequest,{actor_id:'test-human',role:'human',phase:'recovery'});
 const rows=historyRows([],engineAudit(scenario.engine));
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({type:'rejected_command',request:'invalid'});expect(rows[0]!.text).toContain('INVALID_REQUEST');
});
