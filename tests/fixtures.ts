import { expect, type Page } from '@playwright/test';
import { emptyInventory, metadata, newItemInput, snapshot, type InventoryData } from '../src/model';

export function fixture(count = 8, eventCount = count): InventoryData {
  const data = emptyInventory();
  const names = [
    'Smoked paprika',
    'Plain flour',
    'Salted butter',
    'Basmati rice',
    'Chickpeas',
    'Olive oil',
    'Ground coffee',
    'Frozen peas',
  ];
  data.items = Array.from({ length: count }, (_, index) => ({
    ...newItemInput(),
    ...metadata(),
    name: count > 8 ? `Pantry item ${String(index).padStart(4, '0')}` : names[index],
    quantity: index % 3 === 0 ? 2.5 : index % 3 === 1 ? 0 : 2,
    unit: 'jar',
    category: index % 2 ? 'Everyday essentials' : 'Cooking',
    location: index === 2 ? 'Fridge' : index === 7 ? 'Freezer' : 'Pantry',
    display_mode: index % 3 === 0 ? ('ladder' as const) : ('number' as const),
    flagged: index % 3 === 1,
    flag_source: null,
    flagged_at: null,
    verified_at: null,
    merged_into: null,
  }));
  data.events = Array.from({ length: eventCount }, (_, index) => {
    const item = data.items[index % count];
    return {
      ...metadata(new Date(Date.now() - (index % 360) * 86_400_000).toISOString()),
      item_id: item.id,
      reason: 'recount' as const,
      before: snapshot(item),
      after: snapshot(item),
      related_item_id: null,
      undo_of_event_id: null,
      note: null,
    };
  });
  return data;
}

export async function importFixture(page: Page, data: unknown) {
  await page.getByLabel('Choose backup file').setInputFiles({
    name: 'test-inventory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page
    .getByRole('checkbox', { name: 'Replace the inventory on this device with this backup.' })
    .check();
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

export async function stored(page: Page): Promise<InventoryData> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('cupboardcache', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction('inventory').objectStore('inventory').get('current');
          get.onsuccess = () => {
            database.close();
            resolve(get.result);
          };
          get.onerror = () => {
            database.close();
            reject(get.error);
          };
        };
      }),
  );
}
