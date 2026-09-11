# CupboardCache household pilot

The application is ready for a personal pilot at **https://cupboardcache.sciomedes.com/**. Automated browser tests are not a substitute for installing it on your actual phone or checking real shelves.

## Before relying on it

- [ ] Open the URL online in your normal phone browser. In Settings, wait for **App available offline**.
- [ ] Install using Add to Home Screen / Install. Open the installed app and keep that as the one working copy.
- [ ] Add a test item, wait for the dialog to close successfully, and completely close the app.
- [ ] Turn on airplane mode, launch from its home-screen icon, find the item, change its quantity, close, and reopen. The change must remain.
- [ ] Export a JSON backup in Settings. Locate the downloaded file in the phone's file manager.
- [ ] Change the test item, import the exported file, review and confirm replacement. Verify the original quantity returns.
- [ ] Remove/archive the test item and enter about 20 familiar real items. Use it for a day before entering the whole cupboard.

If any installation, offline, or file-recovery step fails, stop adding real inventory and report the phone model, browser, and exact step. Do not clear site data as a troubleshooting shortcut without an exported backup.

## During two shopping cycles

- [ ] Search ten familiar items. Aim for under three seconds per answer; note cold launch separately from searching an already-open app.
- [ ] Record 15 purchases using **Bought**. Aim for under two minutes, but prioritize accurate quantities. Use **Keep on my shopping list** for partial purchases.
- [ ] Correct a shelf count using **Set actual**. An existing shopping need should remain until bought or deliberately canceled.
- [ ] Try a 2.5-container item: setting its open container to Out should leave two full spares. All out means zero total.
- [ ] Walk one shelf, confirm unchanged stock, correct another amount, and skip something you cannot check.
- [ ] If a duplicate appears, choose its survivor and enter the actual combined quantity. Do not assume both rows represent separate stock. Undo is available for the latest action in the current session.
- [ ] Export after the weekly shelf check. Keep a copy off the working device when practical.
- [ ] When an update appears, finish the current edit before updating. Confirm the inventory is unchanged afterward.

## Pilot exit check

After two shopping cycles, physically check 30 representative items. Every in-stock/out-of-stock answer should be correct, and at least 28 quantities should match your chosen granularity. Note any repeated source of drift or slow entry and fix that workflow before adding barcode lookup or other features.

## Working conventions

- One usual location and earliest known expiry per stock type; no batch or per-container identities.
- Custom units, g/kg, and ml/l; mass and volume are not interchangeable.
- Never-prompt suppresses automatic shopping flags, not deliberate manual ones.
- History defaults to 365 days. Shortening it previews and confirms expired events; current quantities and archived records remain.
- Import is a replacement, not a merge or synchronization feature. Other devices/browsers do not automatically share the installed app's inventory.
