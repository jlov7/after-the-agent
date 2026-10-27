import { useEffect,useRef,useState } from 'react';
import { CAPTURE_FILE_NAMES,CAPTURE_MAX_BYTES,inspectCaptureFiles,type CaptureInspection,type CaptureStop } from '../../../../packages/runner/src/capture-inspection.js';
import './capture-inspection.css';
const labels:Record<CaptureStop,string>={missing:'No artifacts selected',conflicting:'Conflicting retained artifacts',provider_failed:'Provider response missing',tool_rejected:'Tool call rejected',budget_stop:'Budget boundary reached',incomplete:'Recording incomplete',replay_failed:'Replay failed',behavior_failed:'Behavioral verification failed',complete:'Retained checks report complete'};
export function CaptureRunInspector(){
  const [result,setResult]=useState<CaptureInspection|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);const selection=useRef(0);
  useEffect(()=>()=>{selection.current++;},[]);
  async function select(files:FileList|null){
    const token=++selection.current;setResult(null);setError('');if(!files?.length){setLoading(false);return;}setLoading(true);
    try{
      const chosen=Array.from(files);if(chosen.length>CAPTURE_FILE_NAMES.length||chosen.reduce((sum,file)=>sum+file.size,0)>CAPTURE_MAX_BYTES)throw new Error('Choose at most six files, up to 8 MiB total.');
      if(chosen.some(file=>!(CAPTURE_FILE_NAMES as readonly string[]).includes(file.name)))throw new Error('Choose only the listed nonsecret artifact filenames.');
      const entries=await Promise.all(chosen.map(async file=>({name:file.name,raw:await file.text()})));if(token!==selection.current)return;
      setResult(inspectCaptureFiles(entries));
    }catch(cause){if(token===selection.current)setError(cause instanceof Error?cause.message.slice(0,512):'Unable to inspect selected artifacts.');}
    finally{if(token===selection.current)setLoading(false);}
  }
  return <section className="capture-inspection" aria-labelledby="capture-heading">
    <h2 id="capture-heading">Inspect a local capture run</h2>
    <p>Select retained nonsecret artifacts. Files stay in this browser. Inspection makes no provider requests.</p>
    <label className="capture-picker">Capture artifact files<input type="file" multiple accept=".json,.ndjson" onChange={event=>{void select(event.target.files);}}/></label>
    <p className="capture-files">Accepted: {CAPTURE_FILE_NAMES.join(', ')}. Maximum 8 MiB total.</p>
    <p role="status" aria-live="polite">{loading?'Reading selected artifacts…':result?labels[result.stop]:error||'No artifacts selected.'}</p>
    {result&&<><p>These are reported claims from selected files. Authorship, run binding and live model provenance remain unverified.</p>
      <dl><dt>Recording category (claimed)</dt><dd>{result.category}</dd><dt>Completion (reported)</dt><dd>{result.completion}</dd><dt>Replay (reported)</dt><dd>{result.replay}</dd><dt>Behavior (reported)</dt><dd>{result.behavior}</dd><dt>Cost USD (reported)</dt><dd>{result.costUsd===null?'Unknown':String(result.costUsd)}</dd><dt>Provider requests / responses (reported)</dt><dd>{result.providerRequests??'Unknown'} / {result.providerResponses??'Unknown'}</dd><dt>Retained exchanges</dt><dd>{result.exchangeCount}</dd></dl>
      <p>{result.reason}</p><p>Selected: {result.files.join(', ')||'None'}</p><p>Missing: {result.missing.join(', ')||'None'}</p></>}
  </section>;
}
