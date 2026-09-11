import { useEffect, useId, useRef } from 'preact/hooks';
import { cloneElement, isValidElement, toChildArray, type ComponentChildren } from 'preact';

const paths = {
  cupboard: 'M4 3h16v17H4zM4 11h16M12 3v8M9 6v2m6-2v2M9 15h6M6 20v1m12-1v1',
  search: 'm21 21-5-5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z',
  bag: 'M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2',
  check: 'm5 12 4 4L19 6',
  shelf: 'M3 10h18M3 20h18M5 10V4h5v6m4 0V2h5v8M6 20v-6h5v6m4 0v-6h3v6',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  back: 'M20 12H4m6-6-6 6 6 6',
  leaf: 'M19 3C6 1 2 9 7 16c7 5 15 1 12-13ZM5 21 15 9',
  jar: 'M8 3h8v3H8zM7 6h10l1 3v11H6V9l1-3ZM6 11h12',
  fridge: 'M6 2h12v20H6zM6 10h12M9 5v2m0 7v3',
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3',
  edit: 'm16 3 5 5-12 12H4v-5L16 3Zm-2 2 5 5',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  undo: 'M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  clock: 'M12 8v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  swap: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  merge: 'M4 3v4c0 5 8 3 8 8v6M20 3v4c0 5-8 3-8 8m-4 2 4 4 4-4',
  wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  phone: 'M7 2h10v20H7zM11 18h2',
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Modal({ title, children, onClose, busy = false, dirty = false, wide = false }: { title: string; children: ComponentChildren; onClose: () => void; busy?: boolean; dirty?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous.current?.focus(); };
  }, []);
  const close = () => { if (!busy && (!dirty || confirm('Discard your unsaved changes?'))) onClose(); };
  return <dialog ref={ref} class={`modal ${wide ? 'modal-wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === ref.current) close(); }}>
    <div class="modal-heading"><h2>{title}</h2><button type="button" class="icon-button" aria-label="Close dialog" onClick={close} disabled={busy}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

export function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: string }) {
  const id = useId();
  return <label class="field"><span id={id}>{label}</span>{toChildArray(children).map(child =>
    isValidElement(child) && typeof child.type === 'string' && /^(input|select|textarea)$/.test(child.type)
      ? cloneElement(child, { 'aria-labelledby': id, 'aria-describedby': hint ? `${id}-hint` : undefined } as Record<string, string | undefined>)
      : child
  )}{hint && <small id={`${id}-hint`}>{hint}</small>}</label>;
}

export function EmptyState({ icon = 'cupboard', title, children, action }: { icon?: IconName; title: string; children: ComponentChildren; action?: ComponentChildren }) {
  return <div class="empty-state"><div class="empty-illustration"><Icon name={icon} size={54} /><span class="empty-sprig"><Icon name="leaf" size={25} /></span></div><h2>{title}</h2><p>{children}</p>{action}</div>;
}

export const ErrorMessage = ({ message }: { message: string | null }) => message ? <div class="inline-error" role="alert"><Icon name="alert" /><span>{message}</span></div> : null;
export const dateLabel = (date: string | null, includeTime = false) => date ? new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } as const : {}) }) : 'Not checked yet';
