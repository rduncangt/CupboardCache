# CupboardCache

A personal pantry inventory app for answering “do I already have this?” and keeping a useful shopping list.

Planned home: **https://cupboardcache.sciomedes.com/**, hosted on GitHub Pages. Install it using Add to Home Screen and use it offline after the initial load. Inventory stays on the device in browser storage, with manual JSON export/import for backups. There are no accounts or synchronization in v1.

## Project status

Planning and repository setup are complete. Application development, Pages deployment, and domain configuration are the next steps; the app is not deployed yet.

- [Development plan](DEVELOPMENT_PLAN.md): current architecture, data model, milestones, and open decisions.
- [Original planning brief](cupboardcache-planning-brief.md): product goals and initial constraints. Later hosting and installation clarifications are incorporated in the development plan.

## First milestone

Build a small PWA with TypeScript, Preact, Vite, a service worker, and IndexedDB. Prove that it installs on the phone, relaunches offline, and retains a saved record. Then build the first usable inventory around 20 real items, including backup and restore.

## Hosting

The repository is `rduncangt/CupboardCache`. GitHub Actions will publish the built app to GitHub Pages. When the deployment is ready, configure the custom domain in Pages and add this DNS record:

| Type | Name in sciomedes.com | Target |
| --- | --- | --- |
| CNAME | cupboardcache | rduncangt.github.io |

The development plan includes domain verification, HTTPS, and rollout details. Keep personal inventory files and exported backups out of Git.
