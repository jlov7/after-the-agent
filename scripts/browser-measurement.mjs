/* global document, performance, Worker, MutationObserver, requestAnimationFrame, setTimeout, clearTimeout */
export function measureRepairInBrowser() {
  return new Promise((done, reject) => {
    const start = performance.now();
    const forward = Worker.prototype.postMessage;
    let request = null;
    let receipt = null;
    let active = null;
    let settling = false;
    const cleanup = () => {
      clearTimeout(timeout); observer.disconnect(); Worker.prototype.postMessage = forward;
      if (active) active.worker.removeEventListener('message', active.received);
    };
    const rendered = () => {
      if (!receipt || settling) return;
      const panel = document.querySelector('.debrief');
      const heading = panel?.querySelector('h2');
      const check = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Check repair');
      if (!heading || !check || check.disabled || !/^(Repair held|Repair did not hold|Check incomplete)$/.test(heading.textContent)) return;
      const boundHash = panel.getAttribute('data-candidate-sha256');
      if (boundHash && boundHash !== request.candidate.candidate_sha256) return;
      settling = true;
      requestAnimationFrame(() => {
        const result = receipt.result;
        const complete = result.cases.length === 12 && result.observations.length === 12 && result.candidate_sha256 === request.candidate.candidate_sha256;
        cleanup();
        done({ elapsed_ms: performance.now() - start, request_id: request.id, candidate_sha256: result.candidate_sha256, worker_status: result.status, verdict: heading.textContent, twelve_cases: complete && result.cases.every(item => item.status === 'pass') && panel.querySelector('.check-total')?.textContent === 'All 12 future scenarios passed' });
      });
    };
    const observer = new MutationObserver(rendered);
    const timeout = setTimeout(() => { cleanup(); reject(new Error('The new worker receipt and rendered scoring result did not finish.')); }, 15000);
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message?.type === 'evaluate') {
        if (request) { cleanup(); reject(new Error('More than one evaluation request was posted during a measured check.')); return; }
        request = message;
        active = { worker: this, received: event => { if (event.data?.id === request.id) { receipt = event.data; rendered(); } } };
        this.addEventListener('message', active.received);
      }
      return forward.call(this, message, ...rest);
    };
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Check repair').click();
  });
}
