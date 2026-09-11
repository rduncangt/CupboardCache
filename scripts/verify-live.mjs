import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

// Always uses an isolated, temporary browser profile. No real inventory is read.
const url = 'https://cupboardcache.sciomedes.com/';
const deadline = Date.now() + 10 * 60 * 1000;
while (true) {
  try {
    const response = await fetch(url);
    if (response.ok && (await response.text()).includes('CupboardCache')) break;
  } catch {
    /* Pages deployment or TLS may still be finishing. */
  }
  if (Date.now() >= deadline) throw new Error('Production deployment did not become ready');
  await delay(5000);
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true });
  let page = await context.newPage();
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  const manifestResponse = await context.request.get(new URL('manifest.webmanifest', url).href);
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  for (const icon of manifest.icons)
    assert.equal((await context.request.get(new URL(icon.src, url).href)).status(), 200);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Deployment check lentils');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  let expected = '2';
  if (process.argv.includes('--wait-for-update')) {
    await page.getByRole('button', { name: 'Set actual quantity for Deployment check lentils' }).click();
    await page.getByLabel('Actual quantity', { exact: true }).fill('3.25');
    console.log('LIVE_READY_FOR_NEXT_DEPLOYMENT: isolated inventory saved; an unfinished edit is open.');
    const updateDeadline = Date.now() + 15 * 60 * 1000;
    while (!(await page.locator('.update-notice').isVisible())) {
      if (Date.now() >= updateDeadline)
        throw new Error('No new deployment arrived during the update verification window');
      await page.evaluate(async () => {
        try {
          await (await navigator.serviceWorker.ready).update();
        } catch {
          /* Retry a transient download failure. */
        }
      });
      await delay(5000);
    }
    await expect(page.getByRole('button', { name: 'Update app', includeHidden: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save actual quantity' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update app' }).click()]);
    expected = '3.25';
  }
  await expect(
    page.getByRole('button', { name: 'Set actual quantity for Deployment check lentils' }),
  ).toContainText(expected);
  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: 'Set actual quantity for Deployment check lentils' }),
  ).toContainText(expected);
  await page.getByRole('link', { name: 'Settings' }).filter({ visible: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const contents = await readFile(await (await download).path(), 'utf8');
  const backup = JSON.parse(contents);
  assert.equal(backup.app, 'ambry');
  assert.equal('format' in backup, false);
  assert.equal('quantity_events' in backup, false);
  assert.equal(typeof backup.items[0].notes, 'string');
  assert.equal(typeof backup.items[0].flagged, 'boolean');
  assert.ok(Array.isArray(backup.events));
  assert.ok(Array.isArray(backup.extras));
  assert.equal(backup.items[0].quantity, Number(expected));
  // Deliberately clear only this script's synthetic inventory, then recover its file.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('cupboardcache');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
  await page.getByLabel('Choose backup file').setInputFiles({
    name: 'deployment-test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contents),
  });
  await page
    .getByRole('checkbox', { name: 'Replace the inventory on this device with this backup.' })
    .check();
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Inventory', exact: true }).filter({ visible: true }).click();
  await expect(
    page.getByRole('button', { name: 'Set actual quantity for Deployment check lentils' }),
  ).toContainText(expected);
  console.log(
    JSON.stringify({
      url,
      https: true,
      manifest: 'valid',
      offlineRelaunch: 'passed',
      backupRecoveryAfterClearingTestStorage: 'passed',
      deploymentUpdate: expected === '3.25' ? 'passed' : 'not requested',
    }),
  );
} finally {
  await browser.close();
}
