import { useEffect, useId, useRef, useState } from 'react';
import './command-menu.css';
export interface CommandItem { id: string; label: string; disabled: boolean; run: () => void }
export interface CommandMenuProps { items: readonly CommandItem[]; sections?: readonly CommandItem[]; acceleratorEnabled?: boolean }
export function CommandMenu({ items, sections = [], acceleratorEnabled = false }: CommandMenuProps) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useId();
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => {
    if (!acceleratorEnabled) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('input,textarea,select') || target.isContentEditable)) return;
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'k' && !event.repeat) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [acceleratorEnabled]);
  const command = (item: CommandItem) => <button key={item.id} type="button" disabled={item.disabled} onClick={() => { if (item.disabled) return; close(); item.run(); }}>{item.label}</button>;
  return <div className="command-menu"><button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Commands</button>
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}>
      <div className="command-menu-heading"><h2 id={heading}>Commands</h2><button type="button" onClick={close} aria-label="Close commands">Close</button></div>
      {acceleratorEnabled && <p className="hint">Alt + Shift + K opens commands outside text fields.</p>}
      <div className="command-menu-list" aria-label="Attempt commands">{items.map(command)}</div>
      {sections.length > 0 && <><h3>Go to section</h3><div className="command-menu-list" aria-label="Section commands">{sections.map(command)}</div></>}
    </dialog>
  </div>;
}
