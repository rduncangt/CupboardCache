import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  execute,
  exportInventory,
  loadInventory,
  readStoredInventory,
  recoverInventory,
  restoreInventory,
  undoLast,
} from './storage';
import { emptyInventory, newItemInput, parseBackup, readInventory } from './model';
import { legacyFixture } from '../tests/legacy-fixture';
import { compactFixture } from '../tests/compact-fixture';

beforeEach(async () => {
  vi.restoreAllMocks();
  await deleteDB('cupboardcache');
});

describe('transactional persistence', () => {
  it('migrates compact on-device history once, preserving inventory and preferences', async () => {
    await loadInventory();
    const source = compactFixture();
    const database = await openDB('cupboardcache', 1);
    await database.put('inventory', source, 'current');
    database.close();
    const migrated = await loadInventory();
    expect(migrated.revision).toBe(1);
    expect(migrated.items).toEqual(source.items);
    expect(migrated.events).toEqual(readInventory(source).data.events);
    expect(migrated.settings).toMatchObject(source.settings);
    expect(await loadInventory()).toEqual(migrated);
  });
  it('leaves a failed compact-backup restore entirely uncommitted', async () => {
    const empty = await loadInventory();
    const current = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Keep this inventory' } },
      empty.revision,
    );
    const candidate = parseBackup(JSON.stringify(compactFixture()));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await expect(restoreInventory(candidate, current.revision)).rejects.toThrow('Quota exceeded');
    expect(await readStoredInventory()).toEqual(current);
    const restored = await restoreInventory(candidate, current.revision);
    expect(restored.items).toEqual(candidate.items);
    expect(restored.events).toEqual(candidate.events);
  });
  it('migrates old on-device data atomically, exactly once', async () => {
    await loadInventory();
    const old = legacyFixture();
    const database = await openDB('cupboardcache', 1);
    await database.put('inventory', old, 'current');
    database.close();
    const migrated = await loadInventory();
    expect(migrated.id).toBe(old.id);
    expect(migrated.revision).toBe(old.revision + 1);
    expect(migrated.items[0]).toMatchObject({
      id: old.items[0].id,
      notes: 'For baking',
      quantity: 0.432,
      flagged: true,
    });
    expect(migrated.events).toEqual(old.quantity_events);
    expect(await readStoredInventory()).toEqual(migrated);
    expect(await loadInventory()).toEqual(migrated);
  });
  it('leaves the old document intact if committing its migration fails', async () => {
    await loadInventory();
    const old = legacyFixture();
    const database = await openDB('cupboardcache', 1);
    await database.put('inventory', old, 'current');
    database.close();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await expect(loadInventory()).rejects.toThrow('Quota exceeded');
    expect(await readStoredInventory()).toEqual(old);
    expect((await loadInventory()).items[0].id).toBe(old.items[0].id);
  });
  it('records export bookkeeping without invalidating forms or Undo', async () => {
    const empty = await loadInventory();
    const added = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Exported beans' } },
      empty.revision,
    );
    const backup = await exportInventory();
    expect(backup.revision).toBe(added.revision);
    expect(backup.settings.writes_since_export).toBe(0);
    expect(backup.settings.last_export_at).toBe(backup.exported_at);
    expect(await loadInventory()).toEqual(backup);
    const undone = await undoLast(backup.revision);
    expect(undone.items[0].deleted_at).toBeTruthy();
    expect(undone.settings.writes_since_export).toBe(1);
  });
  it('can still export a valid backup when export bookkeeping cannot be saved', async () => {
    const empty = await loadInventory();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const backup = await exportInventory();
    expect(backup.id).toBe(empty.id);
    expect(backup.exported_at).toBeTruthy();
    expect(await readStoredInventory()).toEqual(empty);
  });
  it('saves quantity, shopping flags, and history in the same committed document', async () => {
    const empty = await loadInventory();
    const added = await execute(
      { type: 'create', input: { ...newItemInput(), name: 'Butter', quantity: 0, threshold: 1 } },
      empty.revision,
    );
    const bought = await execute(
      { type: 'purchase', id: added.items[0].id, amount: 4, keep: false },
      added.revision,
    );
    expect(await loadInventory()).toEqual(bought);
    expect(bought.items[0]).toMatchObject({ quantity: 4, flagged: false });
    expect(bought.events.at(-1)?.reason).toBe('purchase');
    const undone = await undoLast(bought.revision);
    expect(undone.items[0]).toMatchObject({ quantity: 0, flagged: true });
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
      { type: 'create', input: { ...newItemInput(), name: 'Coffee', quantity: 0, threshold: 1 } },
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
