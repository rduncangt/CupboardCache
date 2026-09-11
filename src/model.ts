import { z } from 'zod';

const quantity = z.number().finite().min(0).max(1_000_000_000);
const storedQuantity = quantity.refine(
  (value) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000 === value,
  'Stored quantities support at most six decimal places; use a smaller unit for tiny amounts.',
);
const timestamp = z.iso.datetime();
const meta = {
  id: z.uuid(),
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: timestamp.nullable(),
};
export const packageSchema = z.strictObject({
  amount: z.number().finite().positive().max(1_000_000_000),
  unit: z.enum(['g', 'kg', 'ml', 'l']),
});
export const inputSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give this item a name.').max(200),
  description: z.string().max(2000).nullable(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(100),
  category: z.string().trim().min(1).max(100).nullable(),
  location: z.string().trim().min(1).max(100).nullable(),
  quantity,
  unit: z.string().trim().min(1, 'Choose a unit.').max(40),
  package_size: packageSchema.nullable(),
  display_mode: z.enum(['numeric', 'qualitative']),
  expires_on: z.iso.date().nullable(),
  resupply_threshold: quantity.nullable(),
  never_prompt: z.boolean(),
});
const itemSchema = inputSchema.extend({
  ...meta,
  quantity: storedQuantity,
  resupply_threshold: storedQuantity.nullable(),
  resupply_flag: z.boolean(),
  last_checked_at: timestamp.nullable(),
  merged_into_id: z.uuid().nullable(),
});
const snapshotSchema = z.strictObject({
  quantity: storedQuantity,
  unit: z.string().min(1).max(40),
  package_size: packageSchema.nullable(),
});
const eventSchema = z.strictObject({
  ...meta,
  item_id: z.uuid(),
  reason: z.enum(['initial', 'adjust', 'recount', 'purchase', 'unit_change', 'merge', 'undo']),
  before: snapshotSchema.nullable(),
  after: snapshotSchema,
  related_item_id: z.uuid().nullable(),
  undo_of_event_id: z.uuid().nullable(),
  note: z.string().max(2000).nullable(),
});
const extraSchema = z.strictObject({
  ...meta,
  text: z.string().trim().min(1).max(300),
  completed_at: timestamp.nullable(),
});
const settingsSchema = z.strictObject({
  ...meta,
  history_retention_days: z.number().int().min(1).max(36500),
});
const dataSchema = z.strictObject({
  ...meta,
  format: z.literal('cupboardcache'),
  schema_version: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  items: z.array(itemSchema).max(20000),
  quantity_events: z.array(eventSchema).max(200000),
  shopping_extras: z.array(extraSchema).max(20000),
  settings: settingsSchema,
});

export type PackageSize = z.infer<typeof packageSchema>;
export type ItemInput = z.infer<typeof inputSchema>;
export type Item = z.infer<typeof itemSchema>;
export type QuantityEvent = z.infer<typeof eventSchema>;
export type ShoppingExtra = z.infer<typeof extraSchema>;
export type InventoryData = z.infer<typeof dataSchema>;
export type RecordMeta = Pick<Item, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>;

export function metadata(now = new Date().toISOString()): RecordMeta {
  return { id: crypto.randomUUID(), created_at: now, updated_at: now, deleted_at: null };
}

export function emptyInventory(now = new Date().toISOString()): InventoryData {
  return {
    ...metadata(now),
    format: 'cupboardcache',
    schema_version: 1,
    revision: 0,
    items: [],
    quantity_events: [],
    shopping_extras: [],
    settings: { ...metadata(now), history_retention_days: 365 },
  };
}

export function newItemInput(): ItemInput {
  return {
    name: '',
    description: null,
    aliases: [],
    category: null,
    location: 'Pantry',
    quantity: 1,
    unit: 'item',
    package_size: null,
    display_mode: 'numeric',
    expires_on: null,
    resupply_threshold: null,
    never_prompt: false,
  };
}

export function itemInput(item: Item): ItemInput {
  const {
    id: _id,
    created_at: _created,
    updated_at: _updated,
    deleted_at: _deleted,
    resupply_flag: _flag,
    last_checked_at: _checked,
    merged_into_id: _merged,
    ...input
  } = item;
  return input;
}

export function validateInventory(value: unknown): InventoryData {
  if (value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== 1) {
    throw new Error('This backup uses an unsupported version. Your current inventory has not changed.');
  }
  const result = dataSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid inventory at ${issue.path.join('.') || 'file'}: ${issue.message}`);
  }
  const data = result.data;
  const ids = new Set<string>();
  for (const record of [
    data,
    data.settings,
    ...data.items,
    ...data.quantity_events,
    ...data.shopping_extras,
  ]) {
    if (ids.has(record.id)) throw new Error('The backup contains duplicate record IDs.');
    ids.add(record.id);
    if (Date.parse(record.updated_at) < Date.parse(record.created_at))
      throw new Error('A record was updated before it was created.');
  }
  if (data.deleted_at || data.settings.deleted_at)
    throw new Error('The inventory or its settings cannot be deleted.');
  const items = new Map(data.items.map((item) => [item.id, item]));
  for (const item of data.items) {
    if (measures[item.unit] && item.package_size)
      throw new Error(
        'An item counted in g, kg, ml, or l must not also redefine that unit with a package size.',
      );
    const visited = new Set([item.id]);
    let target = item.merged_into_id;
    if (target && !item.deleted_at) throw new Error('A merged item must be archived.');
    while (target) {
      const next = items.get(target);
      if (!next || visited.has(target)) throw new Error('The backup contains an invalid merge reference.');
      visited.add(target);
      target = next.merged_into_id;
    }
  }
  for (const event of data.quantity_events) {
    if (!items.has(event.item_id) || (event.related_item_id && !items.has(event.related_item_id))) {
      throw new Error('An inventory event refers to a missing item.');
    }
    if (event.reason !== 'initial' && !event.before)
      throw new Error('A quantity event is missing its previous amount.');
  }
  return data;
}

export function parseBackup(text: string): InventoryData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a CupboardCache backup.');
  }
  return validateInventory(value);
}

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matches(item: Item, search: string): boolean {
  const haystack = normalize([item.name, ...item.aliases, item.description ?? ''].join(' '));
  return normalize(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function duplicates(items: Item[], name: string, excludeId?: string): Item[] {
  const tokens = normalize(name).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return items
    .filter(
      (item) =>
        item.id !== excludeId &&
        !item.merged_into_id &&
        [item.name, ...item.aliases].some((alias) => {
          const other = normalize(alias).split(' ').filter(Boolean);
          const overlap = tokens.filter((token) => other.includes(token)).length;
          return (
            normalize(alias) === normalize(name) ||
            (tokens.length > 1 && overlap / Math.max(tokens.length, other.length) >= 0.75)
          );
        }),
    )
    .slice(0, 5);
}

export function roundQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)
    throw new Error('Quantity must be a nonnegative number no greater than 1 billion.');
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (value > 0 && rounded === 0)
    throw new Error('That amount is too small for this unit. Choose a smaller unit.');
  return rounded;
}

export const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
export const snapshot = (item: Item) => ({
  quantity: item.quantity,
  unit: item.unit,
  package_size: item.package_size ? { ...item.package_size } : null,
});
export const isLow = (item: Pick<Item, 'quantity' | 'resupply_threshold'>) =>
  item.resupply_threshold !== null && item.quantity <= item.resupply_threshold;
export const spareContainers = (q: number) => Math.max(Math.ceil(q) - 1, 0);
export const setOpenContainer = (q: number, fill: number) => roundQuantity(spareContainers(q) + fill);

export function qualitative(q: number): string {
  if (q === 0) return 'Out';
  if (Number.isInteger(q)) return q === 1 ? 'Full' : `${number(q)} full`;
  const spares = spareContainers(q);
  const fill = q - spares;
  const level = fill <= 0.35 ? 'low' : fill <= 0.75 ? 'half' : 'nearly full';
  return spares ? `${number(spares)} full + ${level}` : level[0].toUpperCase() + level.slice(1);
}

const measures: Record<string, { dimension: string; scale: number }> = {
  g: { dimension: 'mass', scale: 1 },
  kg: { dimension: 'mass', scale: 1000 },
  ml: { dimension: 'volume', scale: 1 },
  l: { dimension: 'volume', scale: 1000 },
};

export function assertUnitConversion(
  item: Item,
  factor: number,
  unit: string,
  pack: PackageSize | null,
): void {
  if (measures[unit] && pack)
    throw new Error('The new unit is already precise. Leave its package size blank.');
  const before =
    measures[item.unit] ??
    (item.package_size
      ? {
          dimension: measures[item.package_size.unit].dimension,
          scale: item.package_size.amount * measures[item.package_size.unit].scale,
        }
      : null);
  const after =
    measures[unit] ??
    (pack
      ? { dimension: measures[pack.unit].dimension, scale: pack.amount * measures[pack.unit].scale }
      : null);
  if (before && after) {
    if (before.dimension !== after.dimension)
      throw new Error('Mass and volume cannot be converted into each other.');
    const expected = before.scale / after.scale;
    if (Math.abs(factor - expected) > Math.max(Math.abs(expected) * 0.000001, Number.EPSILON))
      throw new Error(`The unit and package sizes require a conversion factor of ${number(expected)}.`);
  }
}

export function suggestedPackage(item: Item, factor: number, unit: string): PackageSize | null {
  if (measures[unit] || !(factor > 0)) return null;
  if (item.package_size) return { amount: item.package_size.amount / factor, unit: item.package_size.unit };
  if (measures[item.unit])
    return {
      amount: measures[item.unit].scale / factor,
      unit: measures[item.unit].dimension === 'mass' ? 'g' : 'ml',
    };
  return null;
}

export function convertAmount(
  amount: number,
  fromUnit: string,
  item: Pick<Item, 'unit' | 'package_size'>,
): number {
  const n = roundQuantity(amount);
  if (fromUnit === item.unit) return n;
  const from = measures[fromUnit];
  const to = measures[item.unit];
  if (from && to && from.dimension === to.dimension) return roundQuantity((n * from.scale) / to.scale);
  const pack = item.package_size;
  if (from && pack && from.dimension === measures[pack.unit].dimension)
    return roundQuantity((n * from.scale) / (pack.amount * measures[pack.unit].scale));
  throw new Error(`Cannot convert ${fromUnit} to ${item.unit}. Set a compatible package size first.`);
}

export function entryUnits(item: Pick<Item, 'unit' | 'package_size'>): string[] {
  const measure = measures[item.package_size?.unit ?? item.unit];
  return [
    ...new Set([
      item.unit,
      ...Object.keys(measures).filter((unit) => measures[unit].dimension === measure?.dimension),
    ]),
  ];
}

export function packageDisplay(item: Item): string | null {
  return item.package_size
    ? `${number(item.quantity * item.package_size.amount)} ${item.package_size.unit}`
    : null;
}

export function retentionCount(data: InventoryData, days: number, now = Date.now()): number {
  return data.quantity_events.filter((event) => Date.parse(event.created_at) < now - days * 86_400_000)
    .length;
}
