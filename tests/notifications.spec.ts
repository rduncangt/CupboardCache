import { expect, test, type Page } from '@playwright/test';
import { fixture, importFixture, stored } from './fixtures';

async function expectClearControls(page: Page) {
  const layout = await page.evaluate(() => {
    const area = document.querySelector('.notification-area')!.getBoundingClientRect();
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    const overlaps = [
      ...document.querySelectorAll('main button, main input, main select, main a, .topbar a, nav a'),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < area.right &&
          rect.right > area.left &&
          rect.top < area.bottom &&
          rect.bottom > area.top
        );
      })
      .map((element) => element.getAttribute('aria-label') ?? element.textContent);
    return {
      overlaps,
      belowHeader: area.top >= header.bottom,
      aboveContent: area.bottom <= main.top,
      withinWidth: area.left >= 0 && area.right <= innerWidth,
      positions: ['.toast', '.undo-inline'].flatMap((selector) => {
        const element = document.querySelector(selector);
        return element ? [getComputedStyle(element).position] : [];
      }),
    };
  });
  expect(layout).toMatchObject({ overlaps: [], belowHeader: true, aboveContent: true, withinWidth: true });
  expect(layout.positions.every((position) => position === 'static')).toBe(true);
}

const contentTop = (page: Page) =>
  page.locator('main').evaluate((element) => element.getBoundingClientRect().top + scrollY);

test('shelf confirmations and Undo occupy their own row without covering or moving controls', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things, in stock.' })).toBeVisible();
  const data = fixture(3, 0);
  data.items.forEach((item, index) =>
    Object.assign(item, {
      name: ['Alpha beans', 'Beta beans', 'Gamma beans'][index],
      quantity: 2,
      unit: 'count',
      display_mode: 'number',
    }),
  );
  await importFixture(page, data);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('link', { name: 'Shelf check' }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Check 3 items' }).click();
  const before = await contentTop(page);
  await page.getByRole('button', { name: 'That is right · next item' }).click();
  await expect(page.locator('.notification-slot')).toHaveText('Alpha beans checked');
  await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled();
  await expectClearControls(page);
  expect(await contentTop(page)).toBeCloseTo(before, 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('shelf-notification.png'), fullPage: true });

  // Correct the next item while the previous confirmation is still present.
  await page.getByLabel('Actual quantity (count)').fill('1.5');
  await page.getByRole('button', { name: 'Save & next' }).click();
  await expect(page.locator('.notification-slot')).toHaveText('Beta beans checked');
  expect((await stored(page)).items[1].quantity).toBe(1.5);
  await expectClearControls(page);
  // Allow the post-paint effect to start its 6.5-second dismissal timer, too.
  await page.clock.runFor(7000);
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await contentTop(page)).toBeCloseTo(before, 1);
  await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last action' }).click();
  await expect(page.locator('.notification-slot')).toHaveText('Last action undone');
  expect((await stored(page)).items[1].quantity).toBe(2);
});

for (const viewport of [
  { width: 320, height: 640 },
  { width: 844, height: 390 },
]) {
  test(`long notifications remain in the page layout at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const data = fixture(1, 0);
    data.items[0].name = 'Long-name-pantry-item-'.repeat(9);
    await importFixture(page, data);
    await page.getByRole('button', { name: `Add one jar of ${data.items[0].name}` }).click();
    await expect(page.locator('.notification-slot')).toHaveText(`${data.items[0].name} updated`);
    await expectClearControls(page);
    const message = await page.locator('.toast > span').evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(message.scrollWidth).toBeLessThanOrEqual(message.width);
    expect(message.scrollHeight).toBeLessThanOrEqual(message.height);
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo last action' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo last action' }).click();
    expect((await stored(page)).items[0].quantity).toBe(data.items[0].quantity);
  });
}

test('notifications stay below the phone safe area and away from a reduced keyboard viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-top', '47px'));
  const data = fixture(1, 0);
  await importFixture(page, data);
  expect((await page.locator('.topbar').boundingBox())!.y).toBeGreaterThanOrEqual(47);
  await expectClearControls(page);
  await page.getByRole('link', { name: 'Shopping', exact: true }).filter({ visible: true }).click();
  await page.getByRole('textbox', { name: 'Add a shopping note' }).fill('Test shopping note');
  await page.setViewportSize({ width: 390, height: 430 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.notification-slot')).toHaveText('Added to shopping');
  await expectClearControls(page);
  await page.getByRole('textbox', { name: 'Add a shopping note' }).fill('Next note');
  await expect(page.getByRole('textbox', { name: 'Add a shopping note' })).toBeFocused();
});
