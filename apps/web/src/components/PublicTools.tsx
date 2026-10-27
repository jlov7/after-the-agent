import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SubmissionRecord } from '../../../../packages/engine/src/session.js';
import type { SessionPlaybackSource } from '../../../../packages/engine/src/index.js';
import './public-tools.css';
const ReplayViewer = lazy(() => import('./ReplayViewer.js').then(module => ({ default: module.ReplayViewer })));
const AttemptNotebook = lazy(() => import('./AttemptNotebook.js').then(module => ({ default: module.AttemptNotebook })));
const RecordingGallery = lazy(() => import('./RecordingGallery.js').then(module => ({ default: module.RecordingGallery })));
const CaptureRunInspector = lazy(() => import('./CaptureRunInspector.js').then(module => ({ default: module.CaptureRunInspector })));
const RepairLab = lazy(() => import('./RepairLab.js').then(module => ({ default: module.RepairLab })));
type Tool = 'replay' | 'notebook' | 'gallery' | 'capture' | 'lab';
type ReplayInput = { raw?: string; kind?: 'attempt' | 'recording'; trust?: string };
class ToolBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <><p role="alert">This local tool could not load. Save your attempt before reloading to retry.</p><button onClick={this.props.onClose}>Close unavailable tool</button></> : this.props.children; }
}
export function PublicTools({ submissions = [], remainingMs, getCurrent, onRestore, canUseSource, onUseSource }: { submissions?: readonly SubmissionRecord[]; remainingMs: number; getCurrent: () => string; onRestore: (raw: string) => Promise<void>; canUseSource: boolean; onUseSource: (source: SessionPlaybackSource) => void }) {
  const [tool, setTool] = useState<Tool | null>(null), [input, setInput] = useState<ReplayInput>({});
  const container = useRef<HTMLDivElement>(null), trigger = useRef<Tool>('replay');
  useEffect(() => { if (tool) container.current?.focus(); }, [tool]);
  const open = (next: Tool) => { trigger.current = next; setInput({}); setTool(next); };
  const close = () => { setTool(null); document.getElementById(trigger.current === "lab" ? "repair-lab-trigger" : `${trigger.current}-trigger`)?.focus(); };
  const inspect = (raw: string, kind: 'attempt' | 'recording', trust?: string) => { setInput({ raw, kind, ...(trust ? { trust } : {}) }); setTool('replay'); };
  return <section className="public-tools panel" aria-label="Local replay and evidence tools"><h2>Optional tools</h2><p>Explore past attempts, recordings and repairs on this device. The recovery deadline keeps running while you inspect.</p><div className="public-tool-buttons"><button id="repair-lab-trigger" aria-expanded={tool === "lab"} onClick={() => open("lab")}>Open repair laboratory</button><button id="replay-trigger" aria-expanded={tool === 'replay'} onClick={() => open('replay')}>Open replay viewer</button><button id="notebook-trigger" aria-expanded={tool === 'notebook'} onClick={() => open('notebook')}>Open attempt notebook</button><button id="gallery-trigger" aria-expanded={tool === 'gallery'} onClick={() => open('gallery')}>Open recording gallery</button><button id="capture-trigger" aria-expanded={tool === 'capture'} onClick={() => open('capture')}>Inspect capture run</button></div>
    {tool && <div className="public-tool-content" ref={container} tabIndex={-1}><ToolBoundary key={tool} onClose={close}><Suspense fallback={<p role="status">Loading local tool…</p>}>
      {tool === "lab" && <RepairLab submissions={submissions} remainingMs={remainingMs} onClose={close}/>}
      {tool === 'replay' && <ReplayViewer remainingMs={remainingMs} {...(input.raw === undefined ? {} : { initialRaw: input.raw })} {...(input.kind === undefined ? {} : { initialKind: input.kind })} {...(input.trust === undefined ? {} : { trustedLiveSha256: input.trust })} onClose={close}/>}
      {tool === 'notebook' && <AttemptNotebook getCurrent={getCurrent} onRestore={onRestore} onInspect={raw => inspect(raw, 'attempt')} onClose={close}/>}
      {tool === 'gallery' && <RecordingGallery canUse={canUseSource} onUse={onUseSource} onInspect={(raw, trust) => inspect(raw, 'recording', trust)} onClose={close}/>}
      {tool === 'capture' && <><button onClick={close}>Close capture inspection</button><CaptureRunInspector/></>}
    </Suspense></ToolBoundary></div>}
  </section>;
}
