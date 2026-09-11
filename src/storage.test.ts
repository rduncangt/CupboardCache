import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  execute,
  loadInventory,
  readStoredInventory,
  recoverInventory,
  restoreInventory,
  undoLast,
} from './storage';
import { emptyInventory, newItemInput } from './model';

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDB('cupboardcache');
});

describe('transactional persistence', () => {
  it('saves quantity, shopping flags, and history in the same committed document', async () => {
    const empty = await loadInventory();
    const added = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Butter', quantity: 0, resupply_threshold: 1 } },
      empty.revision,
    );
    const bought = await execute(
      { type: 'purchase', id: added.items[0].id, amount: 4, keep: false },
      added.revision,
    );
    expect(await loadInventory()).toEqual(bought);
    expect(bought.items[0]).toMatchObject({ quantity: 4, resupply_flag: false });
    expect(bought.quantity_events.at(-1)?.reason).toBe('purchase');
    const undone = await undoLast(bought.revision);
    expect(undone.items[0]).toMatchObject({ quantity: 0, resupply_flag: true });
    expect(await loadInventory()).toEqual(undone);
  });
  it('rejects a stale writer without losing the first change', async () => {
    const empty = await loadInventory();
    const added = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Rice' } },
      empty.revision,
    );
    await expect(
      execute({ type: 'create', input: { ...newItemInput(), name: 'Stale item' } }, empty.revision),
    ).rejects.toThrow('another window');
    expect(await loadInventory()).toEqual(added);
  });
  it('preserves the last committed state when a write fails', async () => {
    const empty = await loadInventory();
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await expect(
      execute({ type: 'create', input: { ...newItemInput(), name: 'Rice' } }, empty.revision),
    ).rejects.toThrow('Quota exceeded');
    spy.mockRestore();
    expect(await loadInventory()).toEqual(empty);
  });
  it('restores IDs and flags while advancing the local revision', async () => {
    const empty = await loadInventory();
    const backup = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Coffee', quantity: 0, resupply_threshold: 1 } },
      empty.revision,
    );
    const changed = await execute({ type: 'actual', id: backup.items[0].id, quantity: 2 }, backup.revision);
    const restored = await restoreInventory(backup, changed.revision);
    expect(restored.revision).toBe(changed.revision + 1);
    expect(restored.items).toEqual(backup.items);
    await expect(
      restoreInventory({ ...backup, schema_version: 8 } as never, restored.revision),
    ).rejects.toThrow();
    expect(await loadInventory()).toEqual(restored);
  });
  it.each([false, null, { schema_version: 999, revision: 17 }])(
    'preserves unreadable stored data instead of silently resetting it: %j',
    async (badData) => {
      await loadInventory();
      const database = await openDB('cupboardcache', 1);
      await database.put('inventory', badData, 'current');
      database.close();
      await expect(loadInventory()).rejects.toThrow();
      expect(await readStoredInventory()).toEqual(badData);
      const backup = emptyInventory();
      const recovered = await recoverInventory(backup);
      expect(recovered.id).toBe(backup.id);
      expect(await loadInventory()).toEqual(recovered);
    },
  );
  it('does not let a recovery dialog overwrite a subsequently repaired inventory', async () => {
    const current = await loadInventory();
    await expect(recoverInventory(emptyInventory())).rejects.toThrow('readable inventory');
    expect(await loadInventory()).toEqual(current);
  });
});
