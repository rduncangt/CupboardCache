# CupboardCache

A personal pantry inventory app for answering “do I already have this?” and keeping a useful shopping list.

Home: **https://cupboardcache.sciomedes.com/**, hosted on GitHub Pages. Install it using Add to Home Screen and use it offline after the initial load. Inventory stays on the device in IndexedDB, with manual JSON export/import for backups. There are no accounts, analytics, application backend, or synchronization.

## Project status

The M0–M4 feature set is implemented and deployed over HTTPS, with passing automated checks. Actual phone installation and the household pilot remain human acceptance gates: start with the [pilot checklist](PILOT_CHECKLIST.md).

The app supports item editing, search and filters, fractional quantities with spare containers, package conversion, sticky shopping flags, purchases, shopping notes, shelf checks, duplicate merging, archiving/restoration, latest-action Undo, bounded quantity history, and validated JSON backups.

- [Development plan](DEVELOPMENT_PLAN.md): architecture, data model, milestones, and implementation assumptions.
- [Original planning brief](cupboardcache-planning-brief.md): product goals and initial constraints. Later hosting and installation clarifications are incorporated in the development plan.

## Use it

1. Open the custom-domain URL online. Settings should say **App available offline**.
2. Use Safari's Share → Add to Home Screen on iPhone/iPad, or the browser's Install action on Android or a laptop.
3. Open the installed app and use it as the one working inventory. Add an item, wait for its successful save, then test closing and reopening in airplane mode.
4. Export a backup in Settings and verify that you can import it. Import replaces this device's inventory after review; it does not merge copies.

The working data is browser-managed storage, not a live JSON file in your Documents folder. Exports are ordinary dated JSON files. Clearing site data, changing browsers/origins, or losing the device can lose the working inventory. Installation is not a backup. Keep occasional exports somewhere safe, preferably off the working device.

Use **Bought** to add purchased stock and clear its shopping flag. **Set actual** corrects the shelf count but preserves an existing shopping need. Qualitative mode keeps spares: 2.5 jars is two full jars plus half; **Out** affects the open container, while **All out** sets the entire stock to zero.

## Develop and verify

Use Node 22.12+ (Node 22 is used in CI) and npm.

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

```sh
npm test
npm run build
npm run test:e2e
```

`npm run check` runs all three checks. Browser tests run against the production build, not the development server. `npm run preview` serves that build locally. Source modules separate the model, pure commands, transactional storage, and UI; production inventory is never used in tests.

`npm run verify:live` checks HTTPS, the manifest/icons, offline relaunch, and backup recovery against the live site in an isolated browser profile containing only synthetic test inventory. Add `-- --wait-for-update` before a deployment to verify an actual old-to-new release. `npm run format` formats the app and test sources.

The initial implementation passes 30 domain/storage tests and 45 browser checks across desktop Chromium, phone-sized Chromium, and phone-sized WebKit. The scale fixture contains 1,000 items and 8,000 history events (about 3.5 MB). In the final local run, warm searches took 0.22–0.65 seconds and reloads took 2.85–3.55 seconds; these are development-machine measurements with concurrent tests, not actual-phone guarantees. Phone installation and the household accuracy/usability gates remain in the pilot checklist.

The PWA needs HTTPS (or localhost for development); opening `index.html` using `file://` is not supported. After installation and caching, normal use needs no network.

## Hosting

The public repository is [rduncangt/CupboardCache](https://github.com/rduncangt/CupboardCache). Pushes to `main` run type/build, unit, and desktop/mobile browser checks before publishing only `dist/` to GitHub Pages. Failed checks do not deploy. Pages uses GitHub Actions, the custom domain below, and enforced HTTPS.

| Type | Name in sciomedes.com | Target |
| --- | --- | --- |
| CNAME | cupboardcache | rduncangt.github.io |

Richard has configured this CNAME. GitHub has issued its certificate. The app uses root-relative assets, manifest scope, and service-worker scope for the custom domain; do not start real inventory at a temporary GitHub project URL.

Keep personal inventory files and exported backups out of Git. Common backup directories and filenames are ignored. The deployed artifact contains application assets only; JSON exports, tests, and planning documents are not included.
