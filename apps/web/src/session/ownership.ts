export type OwnershipState = 'acquiring' | 'owner' | 'readonly' | 'unavailable' | 'released';
export interface OwnershipStatus { state: OwnershipState; message: string }
export interface AttemptOwnership {
  acquire(): Promise<OwnershipStatus>;
  requestTransfer(): Promise<OwnershipStatus>;
  ownsLock(): boolean;
  dispose(): Promise<void>;
}
const validId = /^attempt\.\d+\.\d+$/;
/** A live lock is the editing authority. Notifications must pause root controls before release. */
export function createAttemptOwnership(attemptId: string, onStatus: (status: OwnershipStatus) => void, options: { beforeAcquire?: () => Promise<void>; beforeTransfer?: () => Promise<void> } = {}): AttemptOwnership {
  if (!validId.test(attemptId)) throw new Error('Invalid attempt identity.');
  let status: OwnershipStatus = { state: 'readonly', message: 'Checking editing ownership.' };
  let disposed = false, transferring = false, generation = 0, release: (() => void) | null = null, pending: Promise<OwnershipStatus> | null = null;
  let abort: AbortController | null = null, disposal: Promise<void> | null = null;
  const lockRequests = new Set<Promise<unknown>>();
  const publish = (state: OwnershipState, message: string) => { status = { state, message }; onStatus(status); return status; };
  let channel: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`after-the-agent.owner.${attemptId}`); } catch { /* Locks still protect editing when transfer messaging is unavailable. */ }
  const relinquish = () => { const unlock = release; release = null; unlock?.(); };
  if (channel) channel.onmessage = event => {
    if (event.data !== 'request-transfer' || !release || transferring) return;
    transferring = true;
    const current = generation;
    publish('readonly', 'Pausing and saving the latest state before editing transfers.');
    void Promise.resolve().then(() => { if (!options.beforeTransfer) throw new Error('A latest-state flush is required before transfer.'); return options.beforeTransfer(); }).then(() => {
      if (disposed || generation !== current) return;
      publish('readonly', 'Editing transferred to another tab. This tab is paused and read-only.'); relinquish();
    }).catch(() => { if (!disposed && generation === current) publish('readonly', 'Transfer cancelled because the latest state could not be saved. This tab retains the editing lock and is read-only. Download this attempt before closing it.'); }).finally(() => { transferring = false; });
  };
  const request = (transfer: boolean): Promise<OwnershipStatus> => {
    if (disposed) return Promise.resolve(status);
    if (status.state === 'owner' || release) return Promise.resolve(status);
    if (pending) return pending;
    if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(publish('unavailable', 'Cross-tab editing protection is unavailable. Keep this attempt read-only or download it.'));
    if (transfer && !channel) return Promise.resolve(publish('unavailable', 'Editing transfer is unavailable. Close the other tab and retry ownership.'));
    const current = ++generation, controller = new AbortController(); abort = controller;
    publish('acquiring', transfer ? 'Requesting editing transfer.' : 'Checking editing ownership.');
    let settle: (value: OwnershipStatus) => void = () => {};
    const result = new Promise<OwnershipStatus>(resolve => { settle = resolve; }); pending = result;
    const timer = setTimeout(() => controller.abort(), transfer ? 5000 : 2000);
    if (transfer) channel!.postMessage('request-transfer');
    const lockOptions: LockOptions = transfer ? { signal: controller.signal } : { ifAvailable: true };
    const lockRequest = navigator.locks.request(`after-the-agent.edit.${attemptId}`, lockOptions, async lock => {
      clearTimeout(timer);
      if (disposed || current !== generation) { settle(status); return; }
      if (!lock) { settle(publish('readonly', 'Another tab owns this attempt. This tab is read-only. Transfer editing here to continue.')); return; }
      if (!transfer && options.beforeAcquire) {
        try { await options.beforeAcquire(); }
        catch (error) { if (!disposed && current === generation) settle(publish('readonly', `Editing blocked: ${error instanceof Error ? error.message : 'Latest saved state could not be checked.'}`)); else settle(status); return; }
        if (disposed || current !== generation) { settle(status); return; }
      }
      const held = new Promise<void>(resolve => { release = resolve; });
      settle(publish('owner', 'Editing in this tab.')); await held;
    }).catch(() => { if (!disposed && current === generation) settle(publish('readonly', 'Editing ownership was not acquired. Close the other tab or retry transfer.')); else settle(status); }).finally(() => { clearTimeout(timer); if (current === generation) { pending = null; abort = null; } });
    lockRequests.add(lockRequest);
    void lockRequest.finally(() => lockRequests.delete(lockRequest));
    // Acquisition settles before the lock request ends, which intentionally remains held.
    void result.then(() => { if (current === generation) pending = null; });
    return result;
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true; generation++; abort?.abort(); publish('released', 'Editing ownership released.'); relinquish(); channel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', dispose);
    // Resolving held work only starts release. A replacement must wait for LockManager completion.
    disposal = Promise.allSettled([...lockRequests]).then(() => {}); return disposal;
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', dispose);
  return { acquire: () => request(false), requestTransfer: () => request(true), ownsLock: () => !disposed && release !== null, dispose };
}
