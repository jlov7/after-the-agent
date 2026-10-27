import { useState } from 'react';
export function TargetStrip({ interactive = false }: { interactive?: boolean }) {
  const [beat, setBeat] = useState(0);
  return <section className="target-strip" aria-label="Normal four-beat target">
    <div className="target-caption"><strong>Normal pattern</strong><span>Active scene, unchanged version</span></div>
    <ol>{[0, 1, 2, 3].map(index => <li key={index} className={interactive && beat === index ? 'example-active' : ''}><span className="beat-label">Beat {index + 1}</span><div className="beat-lamps" aria-label={index % 2 === 0 ? 'Left' : index === 3 ? 'Right and center' : 'Right'}>{(['left', 'center', 'right'] as const).map(lamp => <span key={lamp} className={`mini-lamp ${lamp === (index % 2 === 0 ? 'left' : 'right') || lamp === 'center' && index === 3 ? 'on' : ''}`} aria-hidden="true"/>)}</div><strong>{index % 2 === 0 ? 'Left' : index === 3 ? 'Right + center' : 'Right'}</strong><small>Fire {4 * (index + 1)} · deliver {4 * (index + 1) + 2}</small></li>)}</ol>
    {interactive && <div className="example-controls"><button onClick={() => setBeat((beat + 1) % 4)}>Show next beat</button><p role="status">Example beat {beat + 1}. This illustration does not change the attempt.</p></div>}
  </section>;
}
