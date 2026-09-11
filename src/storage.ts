import { openDB, type DBSchema } from 'idb';
import { applyCommand, undoCommand, type Command } from './commands';
import { emptyInventory, retentionCount, validateInventory, type InventoryData } from './model';

interface Database extends DBSchema { inventory: { key: string; value: InventoryData } }
const db = () => openDB<Database>('cupboardcache', 1, {
  upgrade(database) { database.createObjectStore('inventory'); },
  blocking(_old, _new, event) { (event.target as IDBDatabase).close(); },
});
let queue: Promise<unknown> = Promise.resolve();
let undo: { before: InventoryData; revision: number } | null = null;
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cupboardcache-changes') : null;
const listeners = new Set<() => void>();
if (channel) channel.onmessage = () => { undo = null; listeners.forEach(listener => listener()); };

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

export const canUndo = (revision: number) => undo?.revision === revision;
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function loadInventory(): Promise<InventoryData> {
  return serial(async () => {
    const database = await db();
    const tx = database.transaction('inventory', 'readwrite');
    try {
      const saved = await tx.store.get('current');
      let data = saved === undefined ? emptyInventory() : validateInventory(saved);
      if (retentionCount(data, data.settings.history_retention_days)) {
        data = applyCommand(data, { type: 'prune' });
        undo = null;
        await tx.store.put(data, 'current');
      } else if (saved === undefined) await tx.store.put(data, 'current');
      await tx.done;
      return data;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    } finally { database.close(); }
  });
}

async function write(expectedRevision: number, transform: (current: InventoryData) => InventoryData, reversible: boolean): Promise<InventoryData> {
  const database = await db();
  const tx = database.transaction('inventory', 'readwrite');
  try {
    const current = validateInventory(await tx.store.get('current'));
    if (current.revision !== expectedRevision) throw new Error('Your inventory changed in another window. Close this dialog, refresh the inventory, and reopen the item before retrying.');
    const next = validateInventory(transform(current));
    await tx.store.put(next, 'current');
    await tx.done;
    undo = reversible ? { before: current, revision: next.revision } : null;
    channel?.postMessage(next.revision);
    return next;
  } catch (error) {
    try { tx.abort(); } catch { /* No partial state was committed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  } finally { database.close(); }
}

export function execute(command: Command, expectedRevision: number): Promise<InventoryData> {
  return serial(() => write(expectedRevision, current => applyCommand(current, command), !['retention', 'prune'].includes(command.type)));
}

export function undoLast(expectedRevision: number): Promise<InventoryData> {
  return serial(() => {
    const previous = undo;
    if (!previous || previous.revision !== expectedRevision) throw new Error('That action can no longer be undone.');
    return write(expectedRevision, current => undoCommand(current, previous.before), false);
  });
}

export async function restoreInventory(candidate: InventoryData, expectedRevision: number): Promise<InventoryData> {
  const checked = validateInventory(candidate);
  return serial(() => write(expectedRevision, current => ({ ...checked, revision: current.revision + 1 }), false));
}

export async function readStoredInventory(): Promise<unknown> {
  const database = await db();
  try { return await database.get('inventory', 'current'); }
  finally { database.close(); }
}

export function recoverInventory(candidate: InventoryData): Promise<InventoryData> {
  return serial(async () => {
    const checked = validateInventory(candidate);
    const database = await db();
    const tx = database.transaction('inventory', 'readwrite');
    try {
      const previous = await tx.store.get('current');
      let valid = false;
      try { validateInventory(previous); valid = true; } catch { /* Recovery is only for an unreadable document. */ }
      if (valid) throw new Error('A readable inventory is now available. Close this dialog and refresh before restoring.');
      const previousRevision = previous && Number.isSafeInteger(previous.revision) && previous.revision >= 0 ? previous.revision : 0;
      const restored = validateInventory({ ...checked, revision: previousRevision < Number.MAX_SAFE_INTEGER ? previousRevision + 1 : 0 });
      await tx.store.put(restored, 'current');
      await tx.done;
      undo = null;
      channel?.postMessage(restored.revision);
      return restored;
    } catch (error) {
      try { tx.abort(); } catch { /* Failed recovery leaves the existing data intact. */ }
      await tx.done.catch(() => undefined);
      throw error;
    } finally { database.close(); }
  });
}

export function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'This device is out of storage. Your last saved inventory is intact. Free some space and retry, or export a backup.';
  return error instanceof Error ? error.message : 'Could not save to this device. Please retry.';
}
