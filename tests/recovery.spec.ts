import { expect, test } from '@playwright/test';
import { fixture, importFixture, stored } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things, in stock.' })).toBeVisible();
});

test('qualitative controls preserve spare jars and merge can be undone', async ({ page }) => {
  const data = fixture(2);
  await importFixture(page, data);
  await page.getByRole('button', { name: 'Smoked paprika', exact: true }).click();
  await page.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' })).toContainText('2 full');
  await page.getByRole('button', { name: 'Smoked paprika', exact: true }).click();
  await page.getByRole('button', { name: 'Merge a duplicate' }).click();
  await page.getByLabel('Duplicate to combine').selectOption(data.items[1].id);
  await page.getByLabel('Actual combined quantity (jar)', { exact: true }).fill('2.5');
  await page.getByRole('checkbox', { name: 'I reviewed the units, quantity, and details for the combined item.' }).check();
  await page.getByRole('button', { name: 'Merge into Smoked paprika' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const merged = await stored(page);
  expect(merged.items[0]).toMatchObject({ quantity: 2.5, resupply_flag: true, aliases: ['Plain flour'] });
  expect(merged.items[1].merged_into_id).toBe(data.items[0].id);
  await page.getByRole('button', { name: 'Undo last action' }).click();
  await expect(page.getByRole('button', { name: 'Plain flour', exact: true })).toBeVisible();
  expect((await stored(page)).items[0].quantity).toBe(2);
});

test('package entry and explicit unit conversion preserve actual stock', async ({ page }) => {
  const data = fixture(1);
  Object.assign(data.items[0], { name: 'Flour', unit: 'bag', package_size: { amount: 1, unit: 'kg' }, resupply_threshold: 1 });
  await importFixture(page, data);
  await page.getByRole('button', { name: 'Set actual quantity for Flour' }).click();
  await page.getByLabel('Measure', { exact: true }).selectOption('g');
  await page.getByLabel('Actual quantity', { exact: true }).fill('432');
  await page.getByRole('button', { name: 'Save actual quantity' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await stored(page)).items[0].quantity).toBe(0.432);
  await page.getByRole('button', { name: 'Flour', exact: true }).click();
  await page.getByRole('button', { name: 'Change unit' }).click();
  await page.getByLabel('New unit', { exact: true }).fill('g');
  await page.getByLabel('New units in one old bag').fill('1000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Convert unit', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await stored(page)).items[0]).toMatchObject({ quantity: 432, unit: 'g', package_size: null, resupply_threshold: 1000, resupply_flag: true });
});

test('a failed save preserves both the previous stock and attempted input', async ({ page }) => {
  await importFixture(page, fixture(1));
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      IDBObjectStore.prototype.put = original;
      throw new DOMException('Test quota failure', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' }).click();
  await page.getByLabel('Actual quantity', { exact: true }).fill('0.75');
  await page.getByRole('button', { name: 'Save actual quantity' }).click();
  await expect(page.getByRole('alert')).toContainText('last saved inventory is intact');
  await expect(page.getByLabel('Actual quantity', { exact: true })).toHaveValue('0.75');
  expect((await stored(page)).items[0].quantity).toBe(2.5);
  await page.getByRole('button', { name: 'Save actual quantity' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await stored(page)).items[0].quantity).toBe(0.75);
});

test('a stale form in another tab cannot overwrite a newer save', async ({ page, context }) => {
  await importFixture(page, fixture(1));
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Set actual quantity for Smoked paprika' }).click();
  await other.getByLabel('Actual quantity', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Add one jar of Smoked paprika' }).click();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' })).toContainText('3 full');
  await other.getByRole('button', { name: 'Save actual quantity' }).click();
  await expect(other.getByRole('alert')).toContainText('another window');
  expect((await stored(page)).items[0].quantity).toBe(3.5);
});

test('duplicate suggestions include archived items and restore their identity', async ({ page }) => {
  const data = fixture(1);
  data.items[0].name = 'Canned tomatoes';
  data.items[0].deleted_at = new Date().toISOString();
  await importFixture(page, data);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Tomatoes, canned');
  await expect(page.getByRole('checkbox', { name: 'This is a different item' })).toBeVisible();
  await page.getByRole('button', { name: 'Canned tomatoes Archived · restore' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await stored(page)).items[0]).toMatchObject({ id: data.items[0].id, deleted_at: null });
});

test('1000 items and a year of events remain searchable and recoverable', async ({ page }, info) => {
  const data = fixture(1000, 8000);
  const start = performance.now();
  await importFixture(page, data);
  const importMs = performance.now() - start;
  const searchStart = performance.now();
  await page.getByRole('searchbox').fill('0999 pantry');
  await expect(page.getByRole('button', { name: 'Pantry item 0999', exact: true })).toBeVisible();
  const searchMs = performance.now() - searchStart;
  expect(searchMs).toBeLessThan(3000);
  const commitStart = performance.now();
  await page.getByRole('button', { name: 'Add one jar of Pantry item 0999' }).click();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Pantry item 0999' })).toContainText('3 full');
  const commitMs = performance.now() - commitStart;
  const saved = await stored(page);
  expect(saved.items).toHaveLength(1000);
  expect(saved.quantity_events).toHaveLength(8001);
  const launchStart = performance.now();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pantry item 0999', exact: true })).toBeAttached();
  const launchMs = performance.now() - launchStart;
  console.log(JSON.stringify({ project: info.project.name, items: 1000, events: 8000, bytes: JSON.stringify(data).length, importMs, searchMs, commitMs, launchMs }));
});

test('populated desktop and phone layouts keep controls inside the viewport', async ({ page }, info) => {
  await importFixture(page, fixture());
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('inventory.png'), fullPage: true });
  await page.getByRole('button', { name: 'Smoked paprika', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('item-details.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
