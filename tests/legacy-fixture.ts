import { metadata } from '../src/model';

// Synthetic data in the released pre-starter format; never used for new app writes.
export function legacyFixture() {
  const meta = metadata();
  const item = {
    ...metadata(),
    name: 'Migration flour',
    description: 'For baking',
    aliases: ['White flour'],
    category: 'Baking',
    location: 'Pantry',
    quantity: 0.432,
    unit: 'bag',
    package_size: { amount: 1, unit: 'kg' as const },
    display_mode: 'qualitative' as const,
    expires_on: '2027-12-01',
    resupply_threshold: 1,
    resupply_flag: true,
    never_prompt: true,
    last_checked_at: meta.created_at,
    merged_into_id: null,
  };
  const archived = {
    ...item,
    ...metadata(),
    name: 'Earlier flour',
    description: null,
    deleted_at: meta.created_at,
    merged_into_id: item.id,
  };
  const snapshot = { quantity: item.quantity, unit: item.unit, package_size: item.package_size };
  const event = {
    ...metadata(),
    item_id: item.id,
    reason: 'merge' as const,
    before: snapshot,
    after: snapshot,
    related_item_id: archived.id,
    undo_of_event_id: null,
    note: 'Shelf correction',
  };
  return {
    ...meta,
    format: 'cupboardcache' as const,
    schema_version: 1 as const,
    revision: 7,
    items: [item, archived],
    quantity_events: [event],
    shopping_extras: [{ ...metadata(), text: 'A synthetic shopping note', completed_at: meta.created_at }],
    settings: { ...metadata(), history_retention_days: 365 },
  };
}
