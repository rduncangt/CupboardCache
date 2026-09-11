import { useEffect, useState } from 'preact/hooks';
import { EmptyState, Field, Icon, dateLabel } from './components';
import { number, qualitative, retentionCount, type InventoryData, type Item } from './model';
import type { Commit } from './dialogs';

export function ShelfCheck({ data, busy, commit }: { data: InventoryData; busy: boolean; commit: Commit }) {
  const [location, setLocation] = useState('');
  const [walk, setWalk] = useState<{
    ids: string[];
    index: number;
    checked: number;
    corrected: number;
    skipped: number;
  } | null>(null);
  const [actual, setActual] = useState('');
  const locations = [
    ...new Set(
      data.items.filter((item) => !item.deleted_at).flatMap((item) => (item.location ? [item.location] : [])),
    ),
  ].sort();
  const items = data.items
    .filter((item) => !item.deleted_at && (!location || item.location === location))
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = walk ? data.items.find((item) => item.id === walk.ids[walk.index]) : undefined;
  useEffect(() => {
    setActual(String(current?.quantity ?? ''));
  }, [current?.id, current?.quantity]);
  const step = async (quantity?: number) => {
    if (!walk) return;
    if (
      quantity !== undefined &&
      current &&
      !(await commit({ type: 'actual', id: current.id, quantity }, `${current.name} checked`))
    )
      return;
    setWalk({
      ...walk,
      index: walk.index + 1,
      checked: walk.checked + (quantity === undefined ? 0 : 1),
      corrected: walk.corrected + (quantity !== undefined && quantity !== current?.quantity ? 1 : 0),
      skipped: walk.skipped + (quantity === undefined ? 1 : 0),
    });
  };
  if (walk && walk.index >= walk.ids.length)
    return (
      <EmptyState
        icon="check"
        title="A little more peace of mind."
        action={
          <button class="button primary" onClick={() => setWalk(null)}>
            Finish shelf check
            <Icon name="check" />
          </button>
        }
      >
        You checked {walk.checked} items, corrected {walk.corrected}, and skipped {walk.skipped}. Your changes
        are saved.
      </EmptyState>
    );
  if (walk && current)
    return (
      <div class="walk-layout">
        <div class="walk-progress">
          <span>
            Item {walk.index + 1} of {walk.ids.length}
          </span>
          <button class="text-button" onClick={() => setWalk(null)} disabled={busy}>
            Finish later
          </button>
        </div>
        <progress value={walk.index} max={walk.ids.length} aria-label="Shelf check progress" />
        <div class="walk-card">
          <div class="item-symbol large">
            <Icon name="jar" size={38} />
          </div>
          <p class="eyebrow">{current.location || 'ON YOUR SHELF'}</p>
          <h2>{current.name}</h2>
          <p class="walk-current">
            {number(current.quantity)} <span>{current.unit}</span>
          </p>
          {current.display_mode === 'qualitative' && <span class="tag">{qualitative(current.quantity)}</span>}
          <p class="helper">Last checked: {dateLabel(current.last_checked_at)}</p>
          {current.deleted_at ? (
            <>
              <p>This item was archived in another window.</p>
              <button class="button secondary" onClick={() => void step()}>
                Skip item
              </button>
            </>
          ) : (
            <>
              <button class="button primary full" disabled={busy} onClick={() => void step(current.quantity)}>
                <Icon name="check" /> That is right · next item
              </button>
              <div class="walk-divider">
                <span>or correct the amount</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void step(Number(actual));
                }}
              >
                <div class="walk-input">
                  <Field label={`Actual quantity (${current.unit})`}>
                    <input
                      type="number"
                      value={actual}
                      onInput={(event) => setActual(event.currentTarget.value)}
                      min="0"
                      step="any"
                      inputMode="decimal"
                      required
                    />
                  </Field>
                  <button class="button secondary" disabled={busy}>
                    Save & next
                    <Icon name="arrow" />
                  </button>
                </div>
              </form>
              <div class="button-row spread">
                <button class="text-button" disabled={busy} onClick={() => void step(0)}>
                  All out
                </button>
                <button class="text-button" disabled={busy} onClick={() => void step()}>
                  Skip for now
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">KEEP IT TRUSTWORTHY</p>
          <h1>A walk around the shelves.</h1>
          <p>Confirm what is there. Correct what has changed.</p>
        </div>
        <span class="page-symbol">
          <Icon name="shelf" size={35} />
        </span>
      </div>
      <div class="shelf-intro">
        <div>
          <h2>A few minutes, one shelf at a time.</h2>
          <p>
            You do not have to count everything at once. Start with a location and skip anything you cannot
            check today.
          </p>
          <Field label="Where are you checking?">
            <select value={location} onChange={(event) => setLocation(event.currentTarget.value)}>
              <option value="">Everywhere</option>
              {locations.map((location) => (
                <option value={location}>{location}</option>
              ))}
            </select>
          </Field>
          <button
            class="button primary"
            disabled={!items.length || busy}
            onClick={() =>
              setWalk({ ids: items.map((item) => item.id), index: 0, checked: 0, corrected: 0, skipped: 0 })
            }
          >
            Check {items.length} items
            <Icon name="arrow" />
          </button>
        </div>
        <div class="shelf-art" aria-hidden="true">
          <Icon name="shelf" size={150} />
          <span>A place for everything.</span>
        </div>
      </div>
      <section class="recent-checks">
        <div class="section-heading">
          <h2>Ready for a second look</h2>
          <span>Least recently checked</span>
        </div>
        {items.length ? (
          [...items]
            .sort((a, b) => (a.last_checked_at ?? '').localeCompare(b.last_checked_at ?? ''))
            .slice(0, 8)
            .map((item) => (
              <div class="simple-row" key={item.id}>
                <span class="item-symbol small">
                  <Icon name="jar" size={19} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.location || 'No location'}</small>
                </div>
                <span>{dateLabel(item.last_checked_at)}</span>
              </div>
            ))
        ) : (
          <p class="helper">Add some inventory first, then come back for a shelf check.</p>
        )}
      </section>
    </>
  );
}

export function Settings({
  data,
  busy,
  commit,
  onExport,
  onImport,
  onOpen,
  persistent,
  onPersist,
  installed,
  installAvailable,
  onInstall,
  cached,
}: {
  data: InventoryData;
  busy: boolean;
  commit: Commit;
  onExport: () => void;
  onImport: () => void;
  onOpen: (item: Item) => void;
  persistent: string;
  onPersist: () => void;
  installed: boolean;
  installAvailable: boolean;
  onInstall: () => void;
  cached: boolean;
}) {
  const [days, setDays] = useState(String(data.settings.history_retention_days));
  useEffect(() => {
    setDays(String(data.settings.history_retention_days));
  }, [data.settings.history_retention_days]);
  const archived = data.items.filter((item) => item.deleted_at);
  const expiryCount =
    Number.isInteger(Number(days)) && Number(days) > 0 ? retentionCount(data, Number(days)) : 0;
  return (
    <>
      <div class="page-heading">
        <div>
          <p class="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>A few useful things.</h1>
          <p>Your backups, preferences, and app settings.</p>
        </div>
      </div>
      <div class="settings-grid">
        <section class="settings-card">
          <div class="section-icon">
            <Icon name="download" />
          </div>
          <h2>Keep a spare copy.</h2>
          <p>
            Your inventory is saved automatically on this device. Export a backup occasionally, especially
            before switching devices or browsers.
          </p>
          <div class="button-row">
            <button class="button primary" disabled={busy} onClick={onExport}>
              <Icon name="download" /> Export backup
            </button>
            <button class="button secondary" disabled={busy} onClick={onImport}>
              <Icon name="upload" /> Import backup
            </button>
          </div>
          <small>Import replaces the inventory on this device after you review it.</small>
        </section>
        <section class="settings-card">
          <div class="section-icon">
            <Icon name="phone" />
          </div>
          <h2>Always close at hand.</h2>
          <p>
            {installed
              ? 'You are using the installed app.'
              : 'Add CupboardCache to your home screen for a quick way back to your shelves.'}
          </p>
          <div class="status-line">
            <span class={`status-dot ${cached ? '' : 'muted'}`} />
            {cached ? 'App available offline' : 'Preparing the app for offline use'}
          </div>
          {!installed &&
            (installAvailable ? (
              <button class="button secondary" onClick={onInstall}>
                Install CupboardCache
                <Icon name="phone" />
              </button>
            ) : (
              <p class="helper">
                On iPhone or iPad: open in Safari, tap Share, then Add to Home Screen. On Android: open the
                browser menu and choose Install app or Add to Home Screen.
              </p>
            ))}
          <small>After the first online visit, you can search and update inventory offline.</small>
        </section>
        <section class="settings-card">
          <div class="section-icon">
            <Icon name="clock" />
          </div>
          <h2>A useful memory.</h2>
          <p>
            Keep quantity history for as long as it helps. Older events expire; current quantities and
            archived items stay intact.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                expiryCount &&
                !confirm(
                  `Permanently remove ${expiryCount} older quantity events? Your inventory stays unchanged. Existing backup files are unaffected.`,
                )
              )
                return;
              await commit({ type: 'retention', days: Number(days) }, 'History preference saved');
            }}
          >
            <div class="retention-form">
              <Field label="Days of history">
                <input
                  value={days}
                  onInput={(event) => setDays(event.currentTarget.value)}
                  type="number"
                  min="1"
                  max="36500"
                  step="1"
                  required
                />
              </Field>
              <button
                class="button secondary"
                disabled={busy || Number(days) === data.settings.history_retention_days}
              >
                Save preference
              </button>
            </div>
            <small>
              {data.quantity_events.length} events retained.
              {expiryCount > 0 && ` This change will remove ${expiryCount} older events.`}
            </small>
          </form>
        </section>
        <section class="settings-card">
          <div class="section-icon">
            <Icon name="cupboard" />
          </div>
          <h2>Saved here, for you.</h2>
          <p>No account is needed. Inventory stays on this device and is not sent to GitHub.</p>
          <div class="status-line">
            <span class={`status-dot ${persistent === 'protected' ? '' : 'muted'}`} />
            {persistent === 'protected'
              ? 'Persistent storage granted'
              : persistent === 'unavailable'
                ? 'Standard browser storage'
                : 'Using standard browser storage'}
          </div>
          {persistent !== 'protected' && persistent !== 'unavailable' && (
            <button class="button secondary" onClick={onPersist}>
              Request persistent storage
            </button>
          )}
          <small>
            Clearing site data or losing this device can remove your inventory. An exported backup is your
            recovery copy.
          </small>
        </section>
      </div>
      <section class="archive-section">
        <details>
          <summary>
            <span>Archived items</span>
            <span class="count-badge">{archived.length}</span>
          </summary>
          {archived.length === 0 ? (
            <p class="helper">Items you archive will appear here.</p>
          ) : (
            archived.map((item) => (
              <div class="simple-row" key={item.id}>
                <span class="item-symbol small">
                  <Icon name="jar" size={19} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {number(item.quantity)} {item.unit} ·{' '}
                    {item.merged_into_id
                      ? 'Merged into another item'
                      : `Archived ${dateLabel(item.deleted_at)}`}
                  </small>
                </div>
                {item.merged_into_id ? (
                  <button
                    class="text-button"
                    onClick={() => {
                      const target = data.items.find((target) => target.id === item.merged_into_id);
                      if (target) onOpen(target);
                    }}
                  >
                    View item
                    <Icon name="arrow" size={16} />
                  </button>
                ) : (
                  <button
                    class="button secondary small"
                    disabled={busy}
                    onClick={() => void commit({ type: 'restore', id: item.id }, `${item.name} restored`)}
                  >
                    Restore
                  </button>
                )}
              </div>
            ))
          )}
        </details>
      </section>
      <p class="app-footnote">CupboardCache · 0.1.0 · A little order at home.</p>
    </>
  );
}
