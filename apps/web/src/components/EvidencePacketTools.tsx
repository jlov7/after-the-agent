import { useState } from 'react';
import type { SessionPlaybackSource } from '../../../../packages/engine/src/session.js';
import { createEvidencePacket } from '../../../../packages/runner/src/evidence-packet.js';

export function EvidencePacketTools({ getAttempt, playbackSource = null }: { getAttempt: () => string; playbackSource?: SessionPlaybackSource | null }) {
  const [message, setMessage] = useState('');
  const download = () => {
    try {
      const raw = createEvidencePacket(getAttempt(), playbackSource), url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'after-the-agent-evidence-packet.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Packet downloaded. Independent submission verification requires the local Python oracle command below.');
    } catch { setMessage('Packet could not be created. Export requires a compact attempt of at most 8 MiB, 10,000 commands and 128 checks.'); }
  };
  return <section aria-label="Independent verification packet"><h3>Keep a complete verification packet</h3><p>Includes the original compact attempt and any available playback source. Export stays on this device. Imported identities, timestamps and model claims remain unverified.</p><button onClick={download}>Download verification packet</button><p>From the local application checkout, independently reconstruct every retained check and run the separately retained Python oracle:</p><pre><code>npm run evidence:verify -- after-the-agent-evidence-packet.json</code></pre><p>A reproduced mismatch remains a failed repair. Missing sources, pending results or an unavailable reference produce an incomplete result. This browser export does not run Python or certify a repair.</p>{message && <p role="status">{message}</p>}</section>;
}
