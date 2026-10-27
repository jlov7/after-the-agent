import type { CollectorPort } from '../../../../packages/contracts/src/index.js';
const disabled = async () => ({ status: 'research_disabled' as const, reason: 'Research collection is disabled. This local rehearsal has no server receipts.' });
export const collector: CollectorPort = Object.freeze({ start: disabled, action: disabled, candidate: disabled, closed: disabled });
