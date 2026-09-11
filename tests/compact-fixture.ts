import { metadata, newItemInput } from '../src/model';

// Synthetic records with the compact event shape used by earlier Ambry backups.
// Never copy personal inventory into the public test suite.
export function compactFixture() {
  const now = new Date().toISOString();
  const item = {
    ...newItemInput(),
    ...metadata(now),
    name: 'History test beans',
    quantity: 6,
    unit: 'count',
    flagged: true,
    flag_source: 'manual',
    flagged_at: now,
    verified_at: now,
    merged_into: null,
  };
  const event = (kind: string, before: number, after: number, unit = 'jar') => ({
    id: crypto.randomUUID(),
    item_id: item.id,
    at: new Date(Date.parse(now) - 60000).toISOString(),
    kind,
    qty_before: before,
    qty_after: after,
    unit,
  });
  const events = [
    event('use', 0, 0),
    event('add', 0, 1),
    event('purchase', 1, 3),
    { ...event('recount', 3, 2), note: 'Shelf count corrected' },
    { ...event('unit_change', 2, 6, 'count'), unit_before: 'jar' },
  ];
  return {
    app: 'ambry',
    schema_version: 1,
    exported_at: now,
    device_label: 'phone',
    counts: { items: 1, events: events.length, extras: 0 },
    items: [item],
    events,
    extras: [],
    settings: {
      retention_days: 365,
      last_export_at: now,
      writes_since_export: 7,
      device_label: 'phone',
      last_trip_ended_at: now,
      declared_locations: ['Pantry', 'Garage shelf'],
    },
  };
}
