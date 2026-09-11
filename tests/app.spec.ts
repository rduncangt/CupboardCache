import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveProduction } from './serve';

async function addItem(page: Page, name: string, quantity = '2', unit = 'jar', threshold = '') {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Item name', { exact: true }).fill(name);
  await dialog.getByLabel('Quantity', { exact: true }).fill(quantity);
  await dialog.getByLabel('Unit', { exact: true }).fill(unit);
  if (threshold) await dialog.getByLabel(/Shopping threshold/).fill(threshold);
  await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function navigate(page: Page, name: string) {
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name }).filter({ visible: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things, in stock.' })).toBeVisible();
});

test('add, search, reconcile, and reopen without losing an item', async ({ page }) => {
  await addItem(page, 'Smoked paprika', '2.5');
  await page.getByRole('searchbox', { name: 'Search inventory' }).fill('paprika smoked');
  await expect(page.getByRole('button', { name: 'Smoked paprika', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' }).click();
  await page.getByLabel('Actual quantity', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Save actual quantity' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' })).toContainText('0.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sticky shopping flags clear only on purchase or deliberate cancellation', async ({ page }) => {
  await addItem(page, 'Butter', '0', 'stick', '1');
  await page.getByRole('button', { name: 'Set actual quantity for Butter' }).click();
  await page.getByLabel('Actual quantity', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save actual quantity' }).click();
  await navigate(page, 'Shopping');
  await expect(page.getByRole('button', { name: 'Record purchase of Butter' })).toBeVisible();
  await page.getByRole('button', { name: 'Bought', exact: true }).click();
  await page.getByLabel('Amount bought').fill('4');
  await page.getByRole('button', { name: 'Record purchase', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All stocked up, for now.' })).toBeVisible();
  await navigate(page, 'Inventory');
  await expect(page.getByRole('button', { name: 'Set actual quantity for Butter' })).toContainText('7');
  await page.getByRole('button', { name: 'Undo last action' }).click();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Butter' })).toContainText('3');
  await expect(page.getByRole('button', { name: 'Remove Butter from shopping' })).toBeVisible();
});

test('ad-hoc shopping notes do not create stock', async ({ page }) => {
  await navigate(page, 'Shopping');
  await page.getByRole('textbox', { name: 'Add a shopping note' }).fill('Dish soap');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Complete Dish soap' }).click();
  await expect(page.getByRole('heading', { name: 'All stocked up, for now.' })).toBeVisible();
  await navigate(page, 'Inventory');
  await expect(page.getByRole('heading', { name: 'Every good kitchen starts somewhere.' })).toBeVisible();
});

test('exports and restores a backup and rejects invalid input', async ({ page }) => {
  await addItem(page, 'Coffee', '0.5', 'bag');
  await navigate(page, 'Settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!, 'utf8');
  const backup = JSON.parse(contents);
  expect(backup.items[0].name).toBe('Coffee');
  expect(backup.items[0].id).toBeTruthy();
  await page.getByLabel('Choose backup file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schema_version":999}') });
  await expect(page.getByRole('alert')).toContainText('unsupported');
  await page.getByLabel('Choose backup file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  await page.getByRole('checkbox', { name: 'Replace the inventory on this device with this backup.' }).check();
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await navigate(page, 'Inventory');
  await expect(page.getByRole('button', { name: 'Coffee', exact: true })).toBeVisible();
});

test('walks the shelf and records an actual count', async ({ page }) => {
  await addItem(page, 'Rice', '2', 'bag');
  await navigate(page, 'Shelf check');
  await page.getByRole('button', { name: 'Check 1 items' }).click();
  await page.getByLabel('Actual quantity (bag)').fill('1.5');
  await page.getByRole('button', { name: 'Save & next' }).click();
  await expect(page.getByRole('heading', { name: 'A little more peace of mind.' })).toBeVisible();
  await navigate(page, 'Inventory');
  await expect(page.getByRole('button', { name: 'Set actual quantity for Rice' })).toContainText('1.5');
});

test('relaunches offline with cached app and persistent inventory', async ({ page, context, browserName }) => {
  const host = await serveProduction();
  try {
  await page.goto(host.url);
  await addItem(page, 'Offline lentils', '2');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  host.offline();
  if (browserName !== 'webkit') await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  await page.goto(host.url);
  await expect(page.getByRole('button', { name: 'Offline lentils', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add one jar of Offline lentils' }).click();
  await expect(page.getByRole('button', { name: 'Set actual quantity for Offline lentils' })).toContainText('3');
  await page.close();
  page = await context.newPage();
  await page.goto(host.url);
  await expect(page.getByRole('button', { name: 'Set actual quantity for Offline lentils' })).toContainText('3');
  expect(await page.evaluate(async () => { try { await fetch('/uncached-network-probe'); return false; } catch { return true; } })).toBe(true);
  } finally { await host.close(); }
});
