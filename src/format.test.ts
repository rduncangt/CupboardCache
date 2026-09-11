import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, undoCommand } from './commands';
import {
  emptyInventory,
  exportedInventory,
  itemInput,
  metadata,
  newItemInput,
  parseBackup,
  readInventory,
  validateInventory,
} from './model';
import { legacyFixture } from '../tests/legacy-fixture';
import { compactFixture } from '../tests/compact-fixture';

function starterFixture() {
  return {
    app: 'ambry',
    schema_version: 1,
    exported_at: new Date().toISOString(),
    device_label: 'seed',
    counts: { items: 1, events: 0, extras: 0 },
    items: [
      {
        ...newItemInput(),
        ...metadata(),
        name: 'Format test stock',
        notes: 'Keep these notes',
        display_mode: 'ladder',
        threshold: 1,
        quantity: 0,
        flagged: false,
        flag_source: null,
        flagged_at: null,
        restock_amount: 3,
        barcodes: ['0012345678905'],
        verified_at: null,
        merged_into: null,
      },
    ],
    events: [],
    extras: [],
    settings: { retention_days: 365, last_export_at: null, writes_since_export: 0, device_label: 'phone' },
  };
}

describe('preferred starter format', () => {
  it('accepts the original starter envelope and adds only missing metadata', () => {
    const starter = starterFixture();
    const before = structuredClone(starter);
    const { data, migrated } = readInventory(starter);
    expect(migrated).toBe(true);
    expect(starter).toEqual(before);
    expect(data.items).toEqual(starter.items);
    expect(data.items[0].flagged).toBe(false);
    expect(data).toMatchObject({ app: 'ambry', device_label: 'seed', revision: 0, counts: starter.counts });
    expect(data.id).toBeTruthy();
    expect(data.settings.id).toBeTruthy();
    expect(data.id).not.toBe(data.settings.id);
    expect(data.settings).toMatchObject(starter.settings);
    expect(readInventory(data)).toEqual({ data, migrated: false });
    expect(parseBackup(JSON.stringify(data))).toEqual(data);
  });

  it('converts old fields without losing IDs, timestamps, flags, tombstones, or history', () => {
    const old = legacyFixture();
    const original = structuredClone(old);
    const { data, migrated } = readInventory(old);
    expect(migrated).toBe(true);
    expect(old).toEqual(original);
    expect(data.id).toBe(old.id);
    expect(data.created_at).toBe(old.created_at);
    expect(data.updated_at).toBe(old.updated_at);
    expect(data.items[0]).toMatchObject({
      id: old.items[0].id,
      notes: 'For baking',
      threshold: 1,
      flagged: true,
      verified_at: old.items[0].last_checked_at,
      expiry: old.items[0].expires_on,
      display_mode: 'ladder',
      quantity: 0.432,
      never_prompt: true,
      barcodes: [],
      restock_amount: 1,
    });
    expect(data.items[1]).toMatchObject({
      id: old.items[1].id,
      notes: '',
      merged_into: old.items[0].id,
      deleted_at: old.items[1].deleted_at,
    });
    expect(data.events).toEqual(old.quantity_events);
    expect(data.extras).toEqual(old.shopping_extras);
    expect(data.settings).toMatchObject({
      id: old.settings.id,
      created_at: old.settings.created_at,
      updated_at: old.settings.updated_at,
      retention_days: 365,
    });
    for (const name of ['format', 'quantity_events', 'shopping_extras'])
      expect(data).not.toHaveProperty(name);
    for (const name of [
      'description',
      'resupply_threshold',
      'resupply_flag',
      'last_checked_at',
      'merged_into_id',
      'expires_on',
    ])
      expect(data.items[0]).not.toHaveProperty(name);
    expect(parseBackup(JSON.stringify(old))).toEqual(data);
    expect(readInventory(data)).toEqual({ data, migrated: false });
  });

  it('imports compact history without replaying events or losing their meaning', () => {
    const source = compactFixture();
    const before = structuredClone(source);
    const { data, migrated } = readInventory(source);
    expect(migrated).toBe(true);
    expect(source).toEqual(before);
    expect(data.items).toEqual(source.items);
    expect(data.settings).toMatchObject(source.settings);
    expect(data.counts).toEqual(source.counts);
    for (const [index, original] of source.events.entries()) {
      expect(data.events[index]).toEqual({
        id: original.id,
        item_id: original.item_id,
        created_at: original.at,
        updated_at: original.at,
        deleted_at: null,
        reason: original.kind,
        before: {
          quantity: original.qty_before,
          unit: 'unit_before' in original ? original.unit_before : original.unit,
          package_size: null,
        },
        after: { quantity: original.qty_after, unit: original.unit, package_size: null },
        related_item_id: null,
        undo_of_event_id: null,
        note: 'note' in original ? original.note : null,
      });
    }
    expect(readInventory(data)).toEqual({ data, migrated: false });
    const exported = exportedInventory(data);
    expect(parseBackup(JSON.stringify(exported))).toEqual(exported);
    expect(exported.events).toEqual(data.events);
  });

  it('adds new settings only when absent, including to existing CupboardCache documents', () => {
    const data = emptyInventory();
    const { last_trip_ended_at, declared_locations, ...earlierSettings } = data.settings;
    const { data: migrated, migrated: changed } = readInventory({ ...data, settings: earlierSettings });
    expect(changed).toBe(true);
    expect(migrated).toEqual(data);
    expect(migrated.settings).toMatchObject({ last_trip_ended_at: null, declared_locations: [] });
    expect(readInventory(migrated).migrated).toBe(false);
  });

  it.each([
    { at: undefined },
    { at: 'not a timestamp' },
    { kind: 'unknown event' },
    { qty_before: undefined },
    { qty_after: -1 },
    { extra_data: 'must not be discarded' },
    { created_at: '2026-09-01T00:00:00.000Z' },
    { kind: 'unit_change', unit_before: undefined },
  ])('rejects malformed compact events with a useful location: %j', (change) => {
    const source = compactFixture();
    Object.assign(source.events[0], change);
    expect(() => readInventory(source)).toThrow('Invalid inventory at events.0');
  });

  it('rejects malformed legacy records and future files without dropping unknown fields', () => {
    const old = legacyFixture();
    expect(() => readInventory({ ...old, schema_version: 99 })).toThrow('unsupported');
    expect(() => readInventory({ ...old, unexpected: 'do not drop this' })).toThrow('Invalid legacy');
    expect(() => readInventory({ ...old, items: [] })).toThrow('missing item');
    expect(() => readInventory({ ...starterFixture(), unexpected: true })).toThrow('Invalid inventory');
    expect(() => readInventory({ ...starterFixture(), schema_version: 99 })).toThrow('unsupported');
  });

  it('uses canonical names for new data, derives counts, and records export metadata', () => {
    const empty = emptyInventory();
    const added = applyCommand(empty, { type: 'create', input: { ...newItemInput(), name: 'Beans' } });
    expect(added).toMatchObject({
      app: 'ambry',
      counts: { items: 1, events: 1, extras: 0 },
      settings: { writes_since_export: 1 },
    });
    expect(added.items[0]).toMatchObject({
      notes: '',
      unit: 'count',
      display_mode: 'number',
      restock_amount: 1,
      barcodes: [],
    });
    const exported = exportedInventory(added);
    expect(exported.settings).toMatchObject({ last_export_at: exported.exported_at, writes_since_export: 0 });
    expect(exported.items).toEqual(added.items);
    expect(exported.revision).toBe(added.revision);
    expect(added.settings.writes_since_export).toBe(1);
    expect(parseBackup(JSON.stringify(exported))).toEqual(exported);
  });

  it('preserves starter fields on edits and converts the restock amount with its unit', () => {
    const { data } = readInventory(starterFixture());
    const id = data.items[0].id;
    const edited = applyCommand(data, {
      type: 'edit',
      id,
      input: { ...itemInput(data.items[0]), notes: 'Updated notes' },
    });
    expect(edited.items[0]).toMatchObject({
      restock_amount: 3,
      barcodes: ['0012345678905'],
      notes: 'Updated notes',
    });
    const converted = applyCommand(edited, {
      type: 'convert',
      id,
      factor: 1000,
      unit: 'g',
      package_size: null,
    });
    expect(converted.items[0]).toMatchObject({
      restock_amount: 3000,
      threshold: 1000,
      barcodes: ['0012345678905'],
    });
    expect(validateInventory(converted)).toBeTruthy();
  });

  it('keeps flag provenance sticky and restores it on Undo', () => {
    const initial = applyCommand(emptyInventory(), {
      type: 'create',
      input: { ...newItemInput(), name: 'Butter', quantity: 2, threshold: 1 },
    });
    const id = initial.items[0].id;
    const low = applyCommand(initial, { type: 'actual', id, quantity: 1 });
    expect(low.items[0]).toMatchObject({ flagged: true, flag_source: 'threshold' });
    expect(low.items[0].flagged_at).toBeTruthy();
    const recounted = applyCommand(low, { type: 'actual', id, quantity: 4 });
    expect(recounted.items[0].flagged_at).toBe(low.items[0].flagged_at);
    const bought = applyCommand(recounted, { type: 'purchase', id, amount: 2, keep: false });
    expect(bought.items[0]).toMatchObject({ flagged: false, flag_source: null, flagged_at: null });
    expect(undoCommand(bought, recounted).items[0]).toMatchObject({
      flagged: true,
      flag_source: 'threshold',
      flagged_at: low.items[0].flagged_at,
    });
  });

  it.runIf(existsSync('starter-pantry.json'))(
    'validates the complete private starter file without changing its contents',
    () => {
      const source = JSON.parse(readFileSync('starter-pantry.json', 'utf8'));
      const data = parseBackup(JSON.stringify(source));
      expect(data).toEqual({
        ...source,
        settings: { last_trip_ended_at: null, declared_locations: [], ...source.settings },
      });
      expect(source.items).toHaveLength(source.counts.items);
    },
  );

  it.runIf(existsSync('ccdata-backup.json'))(
    'imports every item and history entry from the complete private backup',
    () => {
      const source = JSON.parse(readFileSync('ccdata-backup.json', 'utf8'));
      const data = parseBackup(JSON.stringify(source));
      expect(data.items).toEqual(source.items);
      expect(data.extras).toEqual(source.extras);
      expect(data.settings).toMatchObject(source.settings);
      expect(data.counts).toEqual(source.counts);
      for (const [index, original] of source.events.entries()) {
        expect(data.events[index]).toMatchObject({
          id: original.id,
          item_id: original.item_id,
          created_at: original.at,
          updated_at: original.at,
          reason: original.kind,
          before: { quantity: original.qty_before, unit: original.unit_before ?? original.unit },
          after: { quantity: original.qty_after, unit: original.unit },
          note: original.note ?? null,
        });
      }
      expect(parseBackup(JSON.stringify(exportedInventory(data))).events).toEqual(data.events);
    },
  );
});
