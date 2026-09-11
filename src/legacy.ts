// Frozen pre-starter format: read only, for lossless migration of existing inventories.
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

export { dataSchema as legacyInventorySchema };
