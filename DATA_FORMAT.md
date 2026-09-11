# Inventory file format

CupboardCache now stores and exports the format in the local `starter-pantry.json`. The file's `app: "ambry"` marker and `schema_version: 1` are retained for compatibility; the app is still called CupboardCache.

The starter inventory is personal data and is excluded from Git and the deployed website. Import it through Settings when you want to use those items. Updating the app does not replace an existing inventory with the starter list.

## Names used throughout the app

| Earlier CupboardCache field/value | Preferred field/value |
| --- | --- |
| `format: "cupboardcache"` | `app: "ambry"` |
| `description` (nullable) | `notes` (string, empty when absent) |
| `resupply_threshold` | `threshold` |
| `resupply_flag` | `flagged` |
| `last_checked_at` | `verified_at` |
| `merged_into_id` | `merged_into` |
| `expires_on` | `expiry` |
| `display_mode: "numeric"` | `display_mode: "number"` |
| `display_mode: "qualitative"` | `display_mode: "ladder"` |
| `quantity_events` | `events` |
| `shopping_extras` | `extras` |
| `settings.history_retention_days` | `settings.retention_days` |

The old names are recognized only by the compatibility reader and its tests. New records, in-memory state, IndexedDB writes, UI fields, and exported backups use the preferred names. The runtime schema in [src/model.ts](src/model.ts) is authoritative.

## Additions to the starter file

Every existing item field has an equivalent in the preferred format, so no duplicate item fields were added. The only missing fields were:

- Document: `id`, `created_at`, `updated_at`, `deleted_at`, and `revision`.
- Settings: `id`, `created_at`, `updated_at`, and `deleted_at`.

These are now present in the local starter file. Its 128 item records are unchanged. Document/settings IDs are distinct UUIDs; their timestamp baseline is the starter's original export time; `deleted_at` is null and the initial revision is zero. An original starter file without these additions is also accepted, with missing metadata filled once during import.

## Existing starter fields

- `counts` is derived from the lengths of `items`, `events`, and `extras`, including archived records; it is not another source of inventory truth. Stale counts are recomputed on validation/export.
- `exported_at` records when a backup was generated. It is null in a new, never-exported working document and when an old-format file has no known export time.
- `device_label` identifies the export source. Exports use `settings.device_label`; this is a label, not a device identity or sync mechanism. The starter's `seed`/`phone` values survive import.
- `flag_source` and `flagged_at` describe a shopping need. New flags use `manual`, `threshold`, or `purchase`; existing provenance is preserved while a flag remains sticky. Clearing the flag clears its provenance. Unknown historical provenance stays null.
- `restock_amount` supplies the initial amount in the purchase dialog. It can be edited under More details and converts with the item's quantity and threshold when changing units.
- `barcodes` is retained as an array of strings, including leading zeros, across edits, merges, import, and export. This change does not add barcode scanning or lookup.
- `settings.retention_days` controls quantity-history retention.
- `settings.last_export_at` and `settings.writes_since_export` track backup generation and subsequent saved changes. Export bookkeeping does not change the inventory revision or invalidate an open form/Undo. If bookkeeping cannot be saved, a valid backup can still be downloaded. These fields cannot prove that a download was kept safely.

## Events, extras, and package sizes

The starter's empty `events` and `extras` arrays do not specify a different record shape. Existing fields are retained:

- Each event has UUID/timestamps/soft-delete metadata, `item_id`, `reason`, `before`, `after`, `related_item_id`, `undo_of_event_id`, and `note`. A quantity snapshot contains `quantity`, `unit`, and `package_size`; `before` is null for creation.
- Each extra has UUID/timestamps/soft-delete metadata, `text`, and `completed_at`.
- `package_size` is null or `{ "amount": 1, "unit": "kg" }`, using g/kg/ml/l. Quantities and thresholds support six decimal places, not separate numeric and ladder quantities.

## Migration and recovery

Existing on-device CupboardCache data is validated, converted, and committed atomically on opening the updated app. Migration increments the local revision once, preserves record IDs, timestamps, quantities, flags, archived records, settings, and history, and never re-runs shopping-threshold rules. A failed migration leaves the old stored document intact. Ordinary retention still applies when the inventory is opened.

Old CupboardCache JSON backups remain importable, but all subsequent exports use the preferred format. Import still requires confirmation and replaces the working inventory; it does not merge devices. Unsupported versions and unknown fields are rejected without silently discarding data.

Exception: if stored data is unreadable, the emergency Export stored data action preserves the raw document for recovery instead of pretending it can be converted.
