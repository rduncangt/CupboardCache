import {
  inputSchema,
  isLow,
  metadata,
  roundQuantity,
  snapshot,
  normalize,
  assertUnitConversion,
  type InventoryData,
  type Item,
  type ItemInput,
  type PackageSize,
  type QuantityEvent,
} from './model';

type MergeFields = Pick<
  ItemInput,
  'quantity' | 'category' | 'location' | 'expires_on' | 'resupply_threshold' | 'never_prompt'
>;
export type Command =
  | { type: 'create'; input: ItemInput }
  | { type: 'edit'; id: string; input: ItemInput }
  | { type: 'adjust'; id: string; delta: number }
  | { type: 'actual'; id: string; quantity: number }
  | { type: 'purchase'; id: string; amount: number; keep: boolean }
  | { type: 'flag'; id: string; value: boolean }
  | { type: 'delete' | 'restore'; id: string }
  | { type: 'convert'; id: string; factor: number; unit: string; package_size: PackageSize | null }
  | { type: 'merge'; source: string; target: string; fields: MergeFields }
  | { type: 'extra-add'; text: string }
  | { type: 'extra-complete'; id: string; value: boolean }
  | { type: 'extra-delete'; id: string }
  | { type: 'retention'; days: number }
  | { type: 'prune' };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function touch<T extends { created_at: string; updated_at: string }>(record: T, now: string): T {
  record.updated_at = Date.parse(now) < Date.parse(record.created_at) ? record.created_at : now;
  return record;
}

function event(
  data: InventoryData,
  item: Item,
  before: Item | null,
  reason: QuantityEvent['reason'],
  now: string,
  related: string | null = null,
  undoOf: string | null = null,
) {
  data.quantity_events.push({
    ...metadata(now),
    item_id: item.id,
    reason,
    before: before ? snapshot(before) : null,
    after: snapshot(item),
    related_item_id: related,
    undo_of_event_id: undoOf,
    note: null,
  });
}

function active(data: InventoryData, id: string): Item {
  const item = data.items.find((item) => item.id === id && !item.deleted_at);
  if (!item) throw new Error('This item is no longer active. Refresh and try again.');
  return item;
}

function crossing(before: Item, item: Item): void {
  if (
    !item.never_prompt &&
    item.resupply_threshold !== null &&
    before.quantity > item.resupply_threshold &&
    item.quantity <= item.resupply_threshold
  )
    item.resupply_flag = true;
}

function normalizedInput(input: ItemInput): ItemInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return {
    ...parsed.data,
    quantity: roundQuantity(parsed.data.quantity),
    resupply_threshold:
      parsed.data.resupply_threshold === null ? null : roundQuantity(parsed.data.resupply_threshold),
  };
}

export function applyCommand(
  current: InventoryData,
  command: Command,
  now = new Date().toISOString(),
): InventoryData {
  const data = structuredClone(current);
  switch (command.type) {
    case 'create': {
      const input = normalizedInput(command.input);
      const item: Item = {
        ...input,
        ...metadata(now),
        resupply_flag: !input.never_prompt && isLow(input),
        last_checked_at: null,
        merged_into_id: null,
      };
      data.items.push(item);
      event(data, item, null, 'initial', now);
      break;
    }
    case 'edit': {
      const item = active(data, command.id);
      const before = structuredClone(item);
      const input = normalizedInput(command.input);
      if (input.unit !== item.unit)
        throw new Error('Use Change unit to convert the quantity and threshold together.');
      if (item.quantity > 0 && !same(input.package_size, item.package_size))
        throw new Error(
          'Use the existing stock before changing package size, or convert to a stable unit first.',
        );
      Object.assign(item, input);
      if (
        !item.never_prompt &&
        isLow(item) &&
        (before.resupply_threshold !== item.resupply_threshold || before.never_prompt)
      )
        item.resupply_flag = true;
      crossing(before, item);
      if (before.quantity !== item.quantity) {
        item.last_checked_at = now;
        event(data, item, before, 'recount', now);
      }
      touch(item, now);
      break;
    }
    case 'adjust':
    case 'actual':
    case 'purchase': {
      const item = active(data, command.id);
      const before = structuredClone(item);
      if (command.type === 'purchase' && (!Number.isFinite(command.amount) || command.amount <= 0))
        throw new Error('Enter the amount you bought, greater than zero.');
      item.quantity = roundQuantity(
        command.type === 'actual'
          ? command.quantity
          : item.quantity + (command.type === 'adjust' ? command.delta : command.amount),
      );
      if (command.type === 'purchase') item.resupply_flag = command.keep;
      else crossing(before, item);
      if (command.type === 'actual') item.last_checked_at = now;
      touch(item, now);
      if (item.quantity !== before.quantity)
        event(
          data,
          item,
          before,
          command.type === 'actual' ? 'recount' : command.type === 'purchase' ? 'purchase' : 'adjust',
          now,
        );
      break;
    }
    case 'flag': {
      touch(active(data, command.id), now).resupply_flag = command.value;
      break;
    }
    case 'delete': {
      touch(active(data, command.id), now).deleted_at = now;
      break;
    }
    case 'restore': {
      const item = data.items.find((item) => item.id === command.id && item.deleted_at);
      if (!item) throw new Error('This archived item was not found.');
      if (item.merged_into_id)
        throw new Error(
          'This item was merged. Use Undo immediately after a merge, or correct the surviving item.',
        );
      touch(item, now).deleted_at = null;
      break;
    }
    case 'convert': {
      const item = active(data, command.id);
      const before = structuredClone(item);
      if (!Number.isFinite(command.factor) || command.factor <= 0)
        throw new Error('The conversion factor must be greater than zero.');
      assertUnitConversion(item, command.factor, command.unit.trim(), command.package_size);
      const input = normalizedInput({
        name: item.name,
        description: item.description,
        aliases: item.aliases,
        category: item.category,
        location: item.location,
        quantity: roundQuantity(item.quantity * command.factor),
        unit: command.unit,
        package_size: command.package_size,
        display_mode: item.display_mode,
        expires_on: item.expires_on,
        resupply_threshold:
          item.resupply_threshold === null ? null : roundQuantity(item.resupply_threshold * command.factor),
        never_prompt: item.never_prompt,
      });
      Object.assign(item, input);
      touch(item, now);
      event(data, item, before, 'unit_change', now);
      break;
    }
    case 'merge': {
      if (command.source === command.target) throw new Error('Choose two different items.');
      const source = active(data, command.source);
      const target = active(data, command.target);
      const before = structuredClone(target);
      const fields = command.fields;
      const checked = inputSchema.parse({
        name: target.name,
        description: target.description,
        aliases: target.aliases,
        unit: target.unit,
        package_size: target.package_size,
        display_mode: target.display_mode,
        ...fields,
      });
      Object.assign(target, checked, { quantity: roundQuantity(fields.quantity) });
      const aliases = [...target.aliases, source.name, ...source.aliases];
      target.aliases = [
        ...new Map(
          aliases
            .filter((alias) => normalize(alias) !== normalize(target.name))
            .map((alias) => [normalize(alias), alias]),
        ).values(),
      ];
      target.resupply_flag = target.resupply_flag || source.resupply_flag;
      target.last_checked_at = now;
      touch(target, now);
      touch(source, now);
      source.deleted_at = now;
      source.merged_into_id = target.id;
      event(data, target, before, 'merge', now, source.id);
      break;
    }
    case 'extra-add': {
      const text = command.text.trim();
      if (!text || text.length > 300) throw new Error('Enter a shopping note of 1–300 characters.');
      data.shopping_extras.push({ ...metadata(now), text, completed_at: null });
      break;
    }
    case 'extra-complete':
    case 'extra-delete': {
      const extra = data.shopping_extras.find((extra) => extra.id === command.id && !extra.deleted_at);
      if (!extra) throw new Error('This shopping note is no longer active.');
      touch(extra, now);
      if (command.type === 'extra-delete') extra.deleted_at = now;
      else extra.completed_at = command.value ? now : null;
      break;
    }
    case 'retention':
    case 'prune': {
      if (command.type === 'retention') {
        if (!Number.isInteger(command.days) || command.days < 1 || command.days > 36500)
          throw new Error('Choose between 1 and 36,500 days of history.');
        touch(data.settings, now).history_retention_days = command.days;
      }
      const cutoff = Date.parse(now) - data.settings.history_retention_days * 86_400_000;
      data.quantity_events = data.quantity_events.filter((event) => Date.parse(event.created_at) >= cutoff);
      break;
    }
  }
  touch(data, now);
  data.revision = current.revision + 1;
  return data;
}

export function undoCommand(
  current: InventoryData,
  before: InventoryData,
  now = new Date().toISOString(),
): InventoryData {
  const data = structuredClone(current);
  for (const item of data.items) {
    const old = before.items.find((other) => other.id === item.id);
    const changed = structuredClone(item);
    if (!old) {
      if (!item.deleted_at) {
        item.deleted_at = now;
        touch(item, now);
      }
    } else if (!same(item, old)) {
      Object.assign(item, old);
      touch(item, now);
      if (!same(snapshot(changed), snapshot(item))) {
        const original = current.quantity_events.findLast(
          (event) =>
            event.item_id === item.id && !before.quantity_events.some((oldEvent) => oldEvent.id === event.id),
        );
        event(data, item, changed, 'undo', now, null, original?.id ?? null);
      }
    }
  }
  for (const extra of data.shopping_extras) {
    const old = before.shopping_extras.find((other) => other.id === extra.id);
    if (!old) {
      extra.deleted_at = now;
      touch(extra, now);
    } else if (!same(extra, old)) {
      Object.assign(extra, old);
      touch(extra, now);
    }
  }
  data.revision = current.revision + 1;
  touch(data, now);
  return data;
}
