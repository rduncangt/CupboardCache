import { describe, expect, it } from 'vitest';
import { applyCommand, undoCommand } from './commands';
import { convertAmount, duplicates, emptyInventory, itemInput, matches, newItemInput, parseBackup, qualitative, roundQuantity, setOpenContainer, validateInventory, type ItemInput } from './model';

const now = '2026-09-11T18:00:00.000Z';
const later = '2026-09-11T18:01:00.000Z';
function setup(overrides: Partial<ItemInput> = {}) {
  const data = applyCommand(emptyInventory(now), { type: 'create', input: { ...newItemInput(), name: 'Butter', quantity: 4, unit: 'stick', resupply_threshold: 1, ...overrides } }, now);
  return { data, id: data.items[0].id };
}

describe('quantity and resupply rules', () => {
  it('raises at equality and keeps the flag when a recount increases stock', () => {
    const { data, id } = setup();
    const low = applyCommand(data, { type: 'actual', id, quantity: 1 }, later);
    expect(low.items[0].resupply_flag).toBe(true);
    const recounted = applyCommand(low, { type: 'actual', id, quantity: 7 }, later);
    expect(recounted.items[0].resupply_flag).toBe(true);
    expect(recounted.items[0].last_checked_at).toBe(later);
    expect(data.items[0].quantity).toBe(4);
  });
  it('supports zero thresholds and initial-low items', () => {
    expect(setup({ quantity: 0, resupply_threshold: 0 }).data.items[0].resupply_flag).toBe(true);
    expect(setup({ quantity: 0, resupply_threshold: null }).data.items[0].resupply_flag).toBe(false);
  });
  it('never-prompt blocks automatic flags while allowing deliberate manual flags', () => {
    const { data, id } = setup({ never_prompt: true });
    const low = applyCommand(data, { type: 'actual', id, quantity: 0 }, later);
    expect(low.items[0].resupply_flag).toBe(false);
    expect(applyCommand(low, { type: 'flag', id, value: true }, later).items[0].resupply_flag).toBe(true);
  });
  it('enabling never-prompt preserves an existing need', () => {
    const { data, id } = setup({ quantity: 1 });
    const edited = applyCommand(data, { type: 'edit', id, input: { ...itemInput(data.items[0]), never_prompt: true } }, later);
    expect(edited.items[0].resupply_flag).toBe(true);
  });
  it('does not re-raise a canceled flag while still below threshold', () => {
    const { data, id } = setup({ quantity: 1 });
    const canceled = applyCommand(data, { type: 'flag', id, value: false }, later);
    const lower = applyCommand(canceled, { type: 'actual', id, quantity: 0.5 }, later);
    expect(lower.items[0].resupply_flag).toBe(false);
    expect(parseBackup(JSON.stringify(lower)).items[0].resupply_flag).toBe(false);
  });
  it('adding a threshold or re-enabling prompts handles already-low stock', () => {
    const { data, id } = setup({ quantity: 1, resupply_threshold: null });
    const edited = applyCommand(data, { type: 'edit', id, input: { ...itemInput(data.items[0]), resupply_threshold: 2 } }, later);
    expect(edited.items[0].resupply_flag).toBe(true);
    const never = setup({ quantity: 1, never_prompt: true });
    expect(applyCommand(never.data, { type: 'edit', id: never.id, input: { ...itemInput(never.data.items[0]), never_prompt: false } }, later).items[0].resupply_flag).toBe(true);
  });
  it('records a partial purchase atomically without immediately reflagging', () => {
    const { data, id } = setup({ quantity: 0 });
    const next = applyCommand(data, { type: 'purchase', id, amount: 0.5, keep: false }, later);
    expect(next.items[0]).toMatchObject({ quantity: 0.5, resupply_flag: false, last_checked_at: null });
    expect(next.quantity_events.at(-1)).toMatchObject({ reason: 'purchase', before: { quantity: 0 }, after: { quantity: 0.5 } });
    expect(applyCommand(data, { type: 'purchase', id, amount: 0.5, keep: true }, later).items[0].resupply_flag).toBe(true);
  });
  it('only physical checks update last_checked_at, including an unchanged check', () => {
    const { data, id } = setup();
    const renamed = applyCommand(data, { type: 'edit', id, input: { ...itemInput(data.items[0]), name: 'Salted butter' } }, later);
    expect(renamed.items[0].last_checked_at).toBeNull();
    const checked = applyCommand(renamed, { type: 'actual', id, quantity: 4 }, later);
    expect(checked.items[0].last_checked_at).toBe(later);
    expect(checked.quantity_events).toHaveLength(1);
  });
  it('rejects invalid changes without changing the input state', () => {
    const { data, id } = setup();
    for (const delta of [-5, NaN, Infinity]) expect(() => applyCommand(data, { type: 'adjust', id, delta }, later)).toThrow();
    expect(() => applyCommand(data, { type: 'purchase', id, amount: 0, keep: false }, later)).toThrow();
    expect(data.items[0].quantity).toBe(4);
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(() => roundQuantity(0.00000001)).toThrow();
  });
});

describe('units and qualitative display', () => {
  it('retains spares while setting the open container', () => {
    expect(qualitative(2.5)).toBe('2 full + half');
    expect(qualitative(2)).toBe('2 full');
    expect(qualitative(0.01)).toBe('Low');
    expect(qualitative(0)).toBe('Out');
    expect(setOpenContainer(2.5, 0)).toBe(2);
    expect(setOpenContainer(2, 0.5)).toBe(1.5);
    expect(setOpenContainer(2.5, 1)).toBe(3);
  });
  it('converts precise package entries and rejects mass-to-volume guesses', () => {
    const item = setup({ unit: 'bag', package_size: { amount: 1, unit: 'kg' } }).data.items[0];
    expect(convertAmount(432, 'g', item)).toBe(0.432);
    expect(convertAmount(2, 'kg', { unit: 'g', package_size: null })).toBe(2000);
    expect(() => convertAmount(432, 'ml', item)).toThrow();
  });
  it('converts quantity and threshold together while preserving historical units', () => {
    const { data, id } = setup({ unit: 'bag', quantity: 0.5, resupply_threshold: 1, package_size: { amount: 1, unit: 'kg' } });
    const next = applyCommand(data, { type: 'convert', id, factor: 1000, unit: 'g', package_size: null }, later);
    expect(next.items[0]).toMatchObject({ quantity: 500, unit: 'g', resupply_threshold: 1000, resupply_flag: true });
    expect(next.quantity_events[0].after).toMatchObject({ quantity: 0.5, unit: 'bag', package_size: { amount: 1, unit: 'kg' } });
    expect(next.quantity_events.at(-1)?.reason).toBe('unit_change');
  });
  it('blocks silently redefining units or occupied packages', () => {
    const { data, id } = setup({ unit: 'bag', package_size: { amount: 1, unit: 'kg' } });
    expect(() => applyCommand(data, { type: 'edit', id, input: { ...itemInput(data.items[0]), unit: 'kg' } }, later)).toThrow('Change unit');
    expect(() => applyCommand(data, { type: 'edit', id, input: { ...itemInput(data.items[0]), package_size: { amount: 2, unit: 'kg' } } }, later)).toThrow('package');
  });
});

describe('duplicates, history, and undo', () => {
  it('matches word order and aliases without a search index', () => {
    const { data } = setup({ name: 'Tomatoes, canned', aliases: ['Tinned tomatoes'] });
    expect(matches(data.items[0], 'canned tom')).toBe(true);
    expect(matches(data.items[0], 'tinned')).toBe(true);
    expect(duplicates(data.items, 'Canned tomatoes')).toHaveLength(1);
    expect(duplicates(data.items, 'Fresh basil')).toHaveLength(0);
  });
  it('merges into an explicitly counted total and can undo the merge', () => {
    const { data, id } = setup({ name: 'Canned tomatoes', quantity: 2 });
    const two = applyCommand(data, { type: 'create', input: { ...newItemInput(), name: 'Tomatoes, canned', quantity: 2, resupply_threshold: 3 } }, later);
    const source = two.items[1].id;
    const merged = applyCommand(two, { type: 'merge', source, target: id, fields: { quantity: 2, category: 'Cans', location: 'Pantry', expires_on: null, resupply_threshold: 1, never_prompt: false } }, later);
    expect(merged.items[0]).toMatchObject({ quantity: 2, resupply_flag: true, aliases: ['Tomatoes, canned'] });
    expect(merged.items[1]).toMatchObject({ deleted_at: later, merged_into_id: id });
    expect(merged.quantity_events.some(event => event.item_id === source)).toBe(true);
    expect(validateInventory(merged)).toBeTruthy();
    const undone = undoCommand(merged, two, later);
    expect(undone.items[1].deleted_at).toBeNull();
    expect(undone.items[0].resupply_flag).toBe(false);
    expect(undone.items[0].aliases).toEqual([]);
  });
  it('undo restores the previous quantity and flag with a compensating event', () => {
    const { data, id } = setup({ quantity: 0 });
    const bought = applyCommand(data, { type: 'purchase', id, amount: 4, keep: false }, later);
    const reverted = undoCommand(bought, data, later);
    expect(reverted.items[0]).toMatchObject({ quantity: 0, resupply_flag: true });
    expect(reverted.quantity_events.at(-1)).toMatchObject({ reason: 'undo', undo_of_event_id: bought.quantity_events.at(-1)?.id });
    expect(reverted.quantity_events).toHaveLength(3);
  });
  it('undoing creation uses a tombstone rather than destroying the record', () => {
    const before = emptyInventory(now);
    const created = applyCommand(before, { type: 'create', input: { ...newItemInput(), name: 'Coffee' } }, now);
    const undone = undoCommand(created, before, later);
    expect(undone.items).toHaveLength(1);
    expect(undone.items[0].deleted_at).toBe(later);
    expect(undone.quantity_events).toHaveLength(1);
  });
  it('prunes expired events but retains quantities and deleted item identities', () => {
    const { data, id } = setup();
    const archived = applyCommand(data, { type: 'delete', id }, later);
    const pruned = applyCommand(archived, { type: 'retention', days: 1 }, '2026-09-20T18:00:00.000Z');
    expect(pruned.quantity_events).toHaveLength(0);
    expect(pruned.items[0]).toEqual(archived.items[0]);
    expect(validateInventory(pruned)).toBeTruthy();
  });
});

describe('backup validation', () => {
  it('round-trips all record identities, flags, units, and tombstones', () => {
    const { data, id } = setup({ quantity: 0.432, unit: 'bag', package_size: { amount: 1, unit: 'kg' }, never_prompt: true });
    const flagged = applyCommand(data, { type: 'flag', id, value: true }, later);
    const extra = applyCommand(flagged, { type: 'extra-add', text: 'Dish soap' }, later);
    const archived = applyCommand(extra, { type: 'delete', id }, later);
    expect(parseBackup(JSON.stringify(archived))).toEqual(archived);
  });
  it('rejects malformed, future, duplicate-ID, and orphaned data', () => {
    const { data } = setup();
    expect(() => parseBackup('not JSON')).toThrow('JSON');
    expect(() => validateInventory({ ...data, schema_version: 9 })).toThrow('unsupported');
    expect(() => validateInventory({ ...data, items: [...data.items, data.items[0]] })).toThrow('duplicate');
    expect(() => validateInventory({ ...data, items: [] })).toThrow('missing');
    expect(() => validateInventory({ ...data, items: [{ ...data.items[0], quantity: -1 }] })).toThrow();
    expect(() => validateInventory({ ...data, surprise: 'unknown field' })).toThrow();
  });
});
