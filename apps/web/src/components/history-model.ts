import type { CommandRecord, DomainEvent } from '../../../../packages/contracts/src/index.js';
import { eventText } from '../session/labels.js';
export interface HistoryRow { readonly key:string; readonly tick:number; readonly type:string; readonly text:string; readonly job:string; readonly request:string; readonly search:string }
export interface HistoryFilters { readonly query:string; readonly from:string; readonly to:string; readonly type:string; readonly job:string; readonly request:string }
export function historyRows(events:readonly DomainEvent[],commands:readonly CommandRecord[]):HistoryRow[] {
 const requests=new Map<number,Set<string>>();
 for(const command of commands) if(command.result.outcome==='accepted') for(const event of command.result.events){const ids=requests.get(event.seq)??new Set<string>();ids.add(command.request.request_id);requests.set(event.seq,ids);}
 const rows:HistoryRow[]=events.map(event=>{
  const job=event.type==='job_enqueued'?event.job.id:'job_id' in event?event.job_id:event.type==='jobs_dropped'?event.job_ids.join(' '):'';
  const request=[...(requests.get(event.seq)??[])].join(' '),text=eventText(event);
  return {key:'event.'+event.seq,tick:event.tick,type:event.type,text,job,request,search:JSON.stringify(event)+' '+request+' '+text};
 });
 for(const command of commands) if(command.result.outcome==='rejected'){
  const action=command.request?.action;
  const text='Rejected '+(action?.type??'invalid request')+': '+(command.result.error?.code??'unknown')+' '+(command.result.error?.message??'');
  const job=action?.type==='drop_jobs'&&Array.isArray(action.job_ids)?action.job_ids.join(' '):'';
  rows.push({key:'command.'+command.seq,tick:command.tick,type:'rejected_command',text,job,request:command.result.request_id,search:JSON.stringify(command.request)+' '+text});
 }
 return rows.sort((a,b)=>a.tick-b.tick);
}
export function filterHistory(rows:readonly HistoryRow[],filters:HistoryFilters):HistoryRow[]{
 const from=filters.from.trim()?Number(filters.from):0,to=filters.to.trim()?Number(filters.to):Infinity;
 if(!Number.isSafeInteger(from)||from<0||(to!==Infinity&&(!Number.isSafeInteger(to)||to<0))||from>to)return [];
 const includes=(haystack:string,needle:string)=>haystack.toLowerCase().includes(needle.trim().toLowerCase());
 return rows.filter(row=>row.tick>=from&&row.tick<=to&&(filters.type==='all'||row.type===filters.type)&&includes(row.search,filters.query)&&includes(row.job,filters.job)&&includes(row.request,filters.request));
}
export function historyPage(rows:readonly HistoryRow[],requested:number){
 const pages=Math.max(1,Math.ceil(rows.length/50)),page=Math.max(0,Math.min(pages-1,Number.isSafeInteger(requested)?requested:0));
 return {rows:rows.slice(page*50,page*50+50),page,pages,total:rows.length};
}
