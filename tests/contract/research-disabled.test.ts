import { expect, it } from 'vitest';
import { collector } from '../../apps/web/src/study/collector.js';
it('the default collector cannot start, mutate, admit a candidate or fabricate a closed receipt', async () => {
  for (const method of [collector.start, collector.action, collector.candidate, collector.closed]) {
    const result = await (method as (...args: never[]) => Promise<unknown>)();
    expect(result).toEqual({ status: 'research_disabled', reason: 'Research collection is disabled. This local rehearsal has no server receipts.' });
    expect(result).not.toHaveProperty('receipt');
  }
});
