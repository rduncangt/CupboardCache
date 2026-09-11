import { expect, test, type Page } from '@playwright/test';
import { fixture, importFixture, stored } from './fixtures';
import { serveProduction } from './serve';

async function updateAttempt(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const finished = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker update timed out')), 15000);
      registration.addEventListener(
        'updatefound',
        () => {
          const worker = registration.installing!;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' || worker.state === 'redundant') {
              clearTimeout(timeout);
              resolve(worker.state);
            }
          });
        },
        { once: true },
      );
    });
    await registration.update();
    return finished;
  });
}

test('a failed worker install preserves the old app; successful updates wait for the form', async ({
  page,
  context,
}) => {
  const host = await serveProduction();
  try {
    await page.goto(host.url);
    await importFixture(page, fixture(1));
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    const before = await stored(page);
    host.release(1, true);
    expect(await updateAttempt(page)).toBe('redundant');
    await expect(page.getByRole('button', { name: 'Update app' })).toBeHidden();
    expect(await stored(page)).toEqual(before);
    host.offline();
    await page.close();
    page = await context.newPage();
    await page.goto(host.url);
    await expect(page.getByRole('button', { name: 'Smoked paprika', exact: true })).toBeVisible();
    expect(await stored(page)).toEqual(before);
    host.online();
    await page.getByRole('button', { name: 'Set actual quantity for Smoked paprika' }).click();
    await page.getByLabel('Actual quantity', { exact: true }).fill('1.75');
    host.release(2);
    expect(await updateAttempt(page)).toBe('installed');
    await expect(page.getByRole('button', { name: 'Update app', includeHidden: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save actual quantity' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Update app' })).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update app' }).click()]);
    await expect(page.getByRole('button', { name: 'Smoked paprika', exact: true })).toBeVisible();
    expect((await stored(page)).items[0]).toMatchObject({ id: before.items[0].id, quantity: 1.75 });
    host.offline();
    await page.close();
    page = await context.newPage();
    await page.goto(host.url);
    await expect(page.getByRole('button', { name: 'Smoked paprika', exact: true })).toBeVisible();
    expect((await stored(page)).items[0].quantity).toBe(1.75);
  } finally {
    await host.close();
  }
});
