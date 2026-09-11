import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fixture, importFixture, stored } from './fixtures';
import { legacyFixture } from './legacy-fixture';
import { compactFixture } from './compact-fixture';
import { readInventory } from '../src/model';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things, in stock.' })).toBeVisible();
});

test('imports starter names, preserves barcode metadata, and uses the restock amount', async ({ page }) => {
  const data = fixture(1);
  Object.assign(data.items[0], {
    notes: 'Preferred-format notes',
    quantity: 0,
    threshold: 1,
    flagged: false,
    restock_amount: 3,
    barcodes: ['0012345678905'],
  });
  const { id, revision, created_at, updated_at, deleted_at, settings, ...document } = data;
  const { id: settingsId, created_at: sc, updated_at: su, deleted_at: sd, ...preferences } = settings;
  await importFixture(page, {
    ...document,
    exported_at: new Date().toISOString(),
    device_label: 'seed',
    settings: preferences,
  });
  let saved = await stored(page);
  expect(saved.items[0]).toMatchObject({
    id: data.items[0].id,
    notes: 'Preferred-format notes',
    flagged: false,
    restock_amount: 3,
    barcodes: ['0012345678905'],
  });
  await page.getByRole('button', { name: 'Smoked paprika', exact: true }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Edited notes');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Smoked paprika', exact: true }).click();
  await page.getByRole('button', { name: 'Bought more' }).click();
  await expect(page.getByLabel('Amount bought')).toHaveValue('3');
  await page.getByRole('button', { name: 'Record purchase', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  saved = await stored(page);
  expect(saved.items[0]).toMatchObject({ quantity: 3, notes: 'Edited notes', barcodes: ['0012345678905'] });
});

test('migrates an existing on-device inventory and exports only the starter format', async ({ page }) => {
  const old = legacyFixture();
  await page.evaluate(
    (legacy) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('cupboardcache', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction('inventory', 'readwrite');
          tx.objectStore('inventory').put(legacy, 'current');
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onabort = () => {
            database.close();
            reject(tx.error);
          };
        };
      }),
    old,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Migration flour', exact: true })).toBeVisible();
  const migrated = await stored(page);
  expect(migrated.id).toBe(old.id);
  expect(migrated.revision).toBe(old.revision + 1);
  expect(migrated.items[0]).toMatchObject({
    id: old.items[0].id,
    quantity: 0.432,
    notes: 'For baking',
    flagged: true,
  });
  expect(migrated.events).toEqual(old.quantity_events);
  await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const contents = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(contents.app).toBe('ambry');
  expect(contents.exported_at).toBeTruthy();
  expect(contents).not.toHaveProperty('format');
  expect(contents).not.toHaveProperty('quantity_events');
  expect(contents.items).toEqual(migrated.items);
  expect(contents.events).toEqual(old.quantity_events);
  expect(contents.extras).toEqual(old.shopping_extras);
  expect(contents.counts).toEqual({ items: 2, events: 1, extras: 1 });
  await page.reload();
  expect((await stored(page)).revision).toBe(migrated.revision);
});

test('restores an old backup even after exporting the current inventory from the review dialog', async ({
  page,
}) => {
  await importFixture(page, fixture(1));
  const old = legacyFixture();
  await page.getByLabel('Choose backup file').setInputFiles({
    name: 'older-cupboardcache-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(old)),
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current inventory first' }).click();
  await download;
  await page
    .getByRole('checkbox', { name: 'Replace the inventory on this device with this backup.' })
    .check();
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Migration flour', exact: true })).toBeVisible();
  expect((await stored(page)).items[0].id).toBe(old.items[0].id);
});

test('imports compact history, displays notes and unit changes, and round-trips the backup', async ({
  page,
}) => {
  const source = compactFixture();
  const expected = readInventory(source).data;
  await importFixture(page, source);
  let saved = await stored(page);
  expect(saved.items).toEqual(source.items);
  expect(saved.events).toEqual(expected.events);
  expect(saved.settings).toMatchObject(source.settings);
  await page.getByRole('button', { name: 'History test beans', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(5);
  await expect(page.locator('.history-row').filter({ hasText: 'unit change' })).toContainText(
    '2 jar → 6 count',
  );
  await expect(page.locator('.history-row').filter({ hasText: 'recount' })).toContainText(
    'Shelf count corrected',
  );
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.locator('#locations option[value="Garage shelf"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  saved = await stored(page);
  expect(saved.events).toEqual(expected.events);
  await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(backup.events).toEqual(expected.events);
  expect(backup.settings.last_trip_ended_at).toBe(source.settings.last_trip_ended_at);
  expect(backup.settings.declared_locations).toEqual(source.settings.declared_locations);
  await importFixture(page, backup);
  expect((await stored(page)).events).toEqual(expected.events);
});

test('rejects a malformed compact history without replacing the saved inventory', async ({ page }) => {
  await importFixture(page, fixture(1));
  const original = await stored(page);
  const source = compactFixture();
  source.events[0].at = 'invalid date';
  await page.getByLabel('Choose backup file').setInputFiles({
    name: 'invalid-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid inventory at events.0.at');
  expect(await stored(page)).toEqual(original);
});

// These files stay on the developer's device. CI runs the synthetic equivalent above.
for (const file of ['starter-pantry.json', 'ccdata-backup.json']) {
  test(`imports and exports the complete private ${file}`, async ({ page }) => {
    test.skip(!existsSync(file), 'Personal inventory is never published to CI.');
    const source = JSON.parse(await readFile(file, 'utf8'));
    const expected = readInventory(source).data;
    await importFixture(page, source);
    const saved = await stored(page);
    expect(saved.items).toEqual(source.items);
    expect(saved.events).toEqual(expected.events);
    expect(saved.extras).toEqual(source.extras);
    expect(saved.settings).toMatchObject(source.settings);
    expect(saved.counts).toEqual(source.counts);
    await page.reload();
    expect((await stored(page)).events).toEqual(expected.events);
    await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup', exact: true }).click();
    const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(backup.items).toEqual(source.items);
    expect(backup.events).toEqual(expected.events);
    expect(backup.extras).toEqual(source.extras);
    await importFixture(page, backup);
    expect((await stored(page)).events).toEqual(expected.events);
  });
}
