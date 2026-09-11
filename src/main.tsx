import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import {
  canUndo,
  execute,
  loadInventory,
  readStoredInventory,
  recoverInventory,
  restoreInventory,
  storageError,
  subscribe,
  undoLast,
} from './storage';
import {
  matches,
  number,
  packageDisplay,
  parseBackup,
  qualitative,
  type InventoryData,
  type Item,
} from './model';
import type { Command } from './commands';
import { Icon, EmptyState, ErrorMessage, Modal, dateLabel, type IconName } from './components';
import { ItemEditor, ItemDetails, QuantityDialog, ConvertDialog, MergeDialog } from './dialogs';
import { Settings, ShelfCheck } from './pages';
import './styles.css';

type View = 'inventory' | 'shopping' | 'shelves' | 'settings';
type OpenModal = { revision: number } & (
  | { kind: 'edit'; id?: string }
  | { kind: 'detail' | 'convert' | 'merge'; id: string }
  | { kind: 'quantity'; id: string; mode: 'actual' | 'purchase' }
  | { kind: 'import'; candidate: InventoryData }
);
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
const nav: { id: View; name: string; icon: IconName }[] = [
  { id: 'inventory', name: 'Inventory', icon: 'cupboard' },
  { id: 'shopping', name: 'Shopping', icon: 'bag' },
  { id: 'shelves', name: 'Shelf check', icon: 'shelf' },
  { id: 'settings', name: 'Settings', icon: 'settings' },
];
const locationIcon = (location: string | null): IconName =>
  /freez/i.test(location ?? '') ? 'snow' : /fridge|refrig/i.test(location ?? '') ? 'fridge' : 'jar';

function App() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const registration = useRef<ServiceWorkerRegistration>();
  const [view, setView] = useState<View>(() => {
    const requested = location.hash.slice(1) as View;
    return nav.some((item) => item.id === requested) ? requested : 'inventory';
  });
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState('name');
  const [modal, setModal] = useState<OpenModal | null>(null);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [cached, setCached] = useState(false);
  const [persistent, setPersistent] = useState('standard');
  const [installed, setInstalled] = useState(
    matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [extra, setExtra] = useState('');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) {
      registration.current = value;
    },
    onOfflineReady() {
      setCached(true);
    },
    onRegisterError() {
      setError(
        'Offline setup did not finish. Keep this page open online and reload to retry. Your inventory is still saved on this device.',
      );
    },
  });

  const refresh = async () => {
    try {
      const saved = await loadInventory();
      setData(saved);
    } catch (error) {
      setError(storageError(error));
    }
  };
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => void refresh());
    const checkForUpdate = () => {
      if (navigator.onLine) void registration.current?.update().catch(() => undefined);
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        checkForUpdate();
      }
    };
    const onNetwork = () => {
      setOnline(navigator.onLine);
      checkForUpdate();
    };
    const updateTimer = setInterval(checkForUpdate, 60 * 60 * 1000);
    const onHash = () => {
      const next = location.hash.slice(1) as View;
      setView(nav.some((item) => item.id === next) ? next : 'inventory');
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(() => setCached(true));
    if (navigator.storage?.persisted)
      void navigator.storage
        .persisted()
        .then((value) => setPersistent(value ? 'protected' : 'standard'))
        .catch(() => setPersistent('standard'));
    else setPersistent('unavailable');
    return () => {
      unsubscribe();
      clearInterval(updateTimer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);

  const persist = async () => {
    if (!navigator.storage?.persist) {
      setPersistent('unavailable');
      return;
    }
    try {
      setPersistent((await navigator.storage.persist()) ? 'protected' : 'standard');
    } catch {
      setPersistent('standard');
    }
  };
  const run = async (command: Command, message: string, expected = data?.revision): Promise<boolean> => {
    if (working.current || expected === undefined) return false;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await execute(command, expected);
      setData(next);
      setToast(message);
      if (command.type === 'create' && next.items.filter((item) => !item.deleted_at).length === 1)
        void persist();
      return true;
    } catch (error) {
      setError(storageError(error));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!data || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      setData(await undoLast(data.revision));
      setToast('Last action undone');
    } catch (error) {
      setError(storageError(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const open = (
    next:
      | Omit<Extract<OpenModal, { kind: 'edit' }>, 'revision'>
      | Omit<Extract<OpenModal, { kind: 'detail' | 'convert' | 'merge' }>, 'revision'>
      | Omit<Extract<OpenModal, { kind: 'quantity' }>, 'revision'>,
  ) => {
    if (data) {
      setError(null);
      setModal({ ...next, revision: data.revision } as OpenModal);
    }
  };
  const exportBackup = async () => {
    try {
      let saved: unknown;
      try {
        const current = await loadInventory();
        setData(current);
        saved = current;
      } catch {
        saved = await readStoredInventory();
        if (saved === undefined) throw new Error('There is no stored inventory to export.');
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cupboardcache-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setToast('Backup download started. Keep the file somewhere safe.');
    } catch (error) {
      setError(storageError(error));
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error('This backup is larger than 50 MB. Choose a smaller CupboardCache backup.');
      const candidate = parseBackup(await file.text());
      setError(null);
      setModal({ kind: 'import', candidate, revision: data?.revision ?? -1 });
    } catch (error) {
      setError(storageError(error));
    }
  };
  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    }
  };
  const items = data?.items.filter((item) => !item.deleted_at) ?? [];
  const shopping = items.filter((item) => item.resupply_flag);
  const extras = data?.shopping_extras.filter((extra) => !extra.deleted_at) ?? [];
  const shoppingCount = shopping.length + extras.filter((extra) => !extra.completed_at).length;
  const locations = [...new Set(items.flatMap((item) => (item.location ? [item.location] : [])))].sort();
  const categories = [...new Set(items.flatMap((item) => (item.category ? [item.category] : [])))].sort();
  const filtered = items
    .filter(
      (item) =>
        matches(item, search) &&
        (!locationFilter || item.location === locationFilter) &&
        (!category || item.category === category) &&
        (!stock || (stock === 'out' ? item.quantity === 0 : item.quantity > 0)),
    )
    .sort((a, b) =>
      sort === 'checked'
        ? (a.last_checked_at ?? '').localeCompare(b.last_checked_at ?? '') || a.name.localeCompare(b.name)
        : sort === 'expiry'
          ? (a.expires_on ?? '9999').localeCompare(b.expires_on ?? '9999') || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
  const modalItem = modal && 'id' in modal ? data?.items.find((item) => item.id === modal.id) : undefined;
  const close = () => {
    setModal(null);
    setError(null);
    if (!data) void refresh();
  };
  const modalProps = {
    busy,
    error,
    onClose: close,
    commit: (command: Command, message: string) => run(command, message, modal?.revision),
  };

  return (
    <div class="app-layout">
      <aside class="sidebar">
        <a href="#inventory" class="brand">
          <span class="brand-icon">
            <Icon name="cupboard" size={27} />
          </span>
          <span>
            Cupboard
            <span>
              Cache<span class="brand-period">.</span>
            </span>
          </span>
        </a>
        <p class="brand-note">A little order at home.</p>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <a
              href={`#${item.id}`}
              class={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {item.id === 'shopping' && shoppingCount > 0 && <span class="nav-count">{shoppingCount}</span>}
            </a>
          ))}
        </nav>
        <div class="sidebar-footer">
          <span class="status-line">
            <span class={`status-dot ${cached ? '' : 'muted'}`} />
            {online ? (cached ? 'Ready for offline use' : 'Saved on this device') : 'You are offline'}
          </span>
          <p>Your shelves, always nearby.</p>
        </div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <a class="mobile-brand" href="#inventory">
            <Icon name="cupboard" size={24} />
            CupboardCache<span>.</span>
          </a>
          <span class="topbar-date">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          <div class="save-status" role="status">
            <span class={`status-dot ${busy ? 'saving' : ''}`} />
            {busy
              ? 'Saving…'
              : error
                ? 'Needs attention'
                : !data
                  ? 'Opening inventory…'
                  : !online
                    ? 'Offline · saved locally'
                    : 'Saved on this device'}
          </div>
        </header>
        <main id="main-content">
          {needRefresh && (
            <div class="update-notice">
              <Icon name="leaf" />
              <div>
                <strong>A fresh version is ready.</strong>
                <span>
                  {modal ? 'Finish this dialog before updating.' : 'Your inventory will stay right here.'}
                </span>
              </div>
              <button
                class="button secondary small"
                disabled={busy || !!modal}
                onClick={() => void updateServiceWorker(true)}
              >
                Update app
              </button>
            </div>
          )}
          {!modal && error && (
            <div class="error-banner">
              <ErrorMessage message={error} />
              <button
                class="text-button"
                onClick={() => {
                  setError(null);
                  void refresh();
                }}
              >
                Refresh inventory
              </button>
            </div>
          )}
          {!data ? (
            error ? (
              <EmptyState
                icon="alert"
                title="Your inventory could not be opened."
                action={
                  <div class="button-row">
                    <button class="button secondary" onClick={() => void exportBackup()}>
                      Export stored data
                    </button>
                    <button class="button primary" onClick={() => fileInput.current?.click()}>
                      Restore a backup
                    </button>
                  </div>
                }
              >
                Your stored data has not been replaced. Retry opening it, or export the stored data and
                restore a known backup.
              </EmptyState>
            ) : (
              <div class="loading-state" role="status">
                <Icon name="cupboard" size={42} />
                <p>Opening your cupboard…</p>
              </div>
            )
          ) : (
            <>
              {view === 'inventory' && (
                <>
                  <div class="page-heading">
                    <div>
                      <p class="eyebrow">YOUR KITCHEN, AT A GLANCE</p>
                      <h1>Good things, in stock.</h1>
                      <p>
                        {items.length
                          ? `${items.length} ${items.length === 1 ? 'item' : 'items'} across your shelves. A little less guesswork.`
                          : 'Know what you have. Make room for what matters.'}
                      </p>
                    </div>
                    <button class="button primary" disabled={busy} onClick={() => open({ kind: 'edit' })}>
                      <Icon name="plus" /> Add item
                    </button>
                  </div>
                  <div class="search-box">
                    <Icon name="search" size={22} />
                    <input
                      aria-label="Search inventory"
                      placeholder="Do I already have…"
                      value={search}
                      onInput={(event) => setSearch(event.currentTarget.value)}
                      type="search"
                      autoComplete="off"
                    />
                    <span class="search-count">
                      {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <div class="inventory-toolbar">
                    <div class="location-tabs" aria-label="Filter by location">
                      <button class={!locationFilter ? 'selected' : ''} onClick={() => setLocationFilter('')}>
                        All shelves
                      </button>
                      {locations.map((location) => (
                        <button
                          class={locationFilter === location ? 'selected' : ''}
                          onClick={() => setLocationFilter(location)}
                        >
                          <Icon name={locationIcon(location)} size={16} />
                          {location}
                        </button>
                      ))}
                    </div>
                    <div class="filter-selects">
                      <select
                        aria-label="Filter by category"
                        value={category}
                        onChange={(event) => setCategory(event.currentTarget.value)}
                      >
                        <option value="">All categories</option>
                        {categories.map((category) => (
                          <option value={category}>{category}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter by stock"
                        value={stock}
                        onChange={(event) => setStock(event.currentTarget.value)}
                      >
                        <option value="">Any stock</option>
                        <option value="in">In stock</option>
                        <option value="out">Out of stock</option>
                      </select>
                      <select
                        aria-label="Sort inventory"
                        value={sort}
                        onChange={(event) => setSort(event.currentTarget.value)}
                      >
                        <option value="name">Name A–Z</option>
                        <option value="checked">Least recently checked</option>
                        <option value="expiry">Earliest expiry</option>
                      </select>
                    </div>
                  </div>
                  {items.length === 0 ? (
                    <EmptyState
                      title="Every good kitchen starts somewhere."
                      action={
                        <div class="button-row">
                          <button class="button primary" onClick={() => open({ kind: 'edit' })}>
                            Add your first item
                            <Icon name="plus" />
                          </button>
                          <button class="text-button" onClick={() => fileInput.current?.click()}>
                            Restore a backup
                          </button>
                        </div>
                      }
                    >
                      Start with the things you reach for most: coffee, flour, the jar of paprika. Your
                      cupboard will come together, one item at a time.
                    </EmptyState>
                  ) : filtered.length === 0 ? (
                    <EmptyState
                      icon="search"
                      title="Nothing on this shelf yet."
                      action={
                        <button
                          class="text-button"
                          onClick={() => {
                            setSearch('');
                            setLocationFilter('');
                            setCategory('');
                            setStock('');
                          }}
                        >
                          Clear search and filters
                        </button>
                      }
                    >
                      Try another name or take a look on all shelves.
                    </EmptyState>
                  ) : (
                    <div class="inventory-grid">
                      {filtered.map((item) => (
                        <article class={`item-card ${item.quantity === 0 ? 'item-out' : ''}`} key={item.id}>
                          <div class="item-card-top">
                            <span class={`item-symbol ${item.display_mode === 'qualitative' ? 'warm' : ''}`}>
                              <Icon name={locationIcon(item.location)} size={24} />
                            </span>
                            <div class="item-name">
                              <button onClick={() => open({ kind: 'detail', id: item.id })}>
                                {item.name}
                              </button>
                              <span>
                                {[item.category, item.location].filter(Boolean).join(' · ') ||
                                  'On your shelf'}
                              </span>
                            </div>
                            <button
                              class="icon-button"
                              aria-label={`Details for ${item.name}`}
                              onClick={() => open({ kind: 'detail', id: item.id })}
                            >
                              <Icon name="more" />
                            </button>
                          </div>
                          {item.description && <p class="item-description">{item.description}</p>}
                          <div class="item-card-bottom">
                            <button
                              class="quantity-button"
                              onClick={() => open({ kind: 'quantity', id: item.id, mode: 'actual' })}
                              aria-label={`Set actual quantity for ${item.name}`}
                            >
                              <strong>
                                {item.display_mode === 'qualitative'
                                  ? qualitative(item.quantity)
                                  : number(item.quantity)}
                              </strong>
                              <span>
                                {item.display_mode === 'qualitative'
                                  ? `${number(item.quantity)} ${item.unit}`
                                  : item.unit}
                                {item.package_size && ` · ${packageDisplay(item)}`}
                              </span>
                            </button>
                            <div class="stepper">
                              <button
                                aria-label={`Use one ${item.unit} of ${item.name}`}
                                disabled={busy || item.quantity === 0}
                                onClick={() =>
                                  void run(
                                    { type: 'adjust', id: item.id, delta: -Math.min(1, item.quantity) },
                                    `${item.name} updated`,
                                  )
                                }
                              >
                                <Icon name="minus" size={18} />
                              </button>
                              <button
                                aria-label={`Add one ${item.unit} of ${item.name}`}
                                disabled={busy}
                                onClick={() =>
                                  void run({ type: 'adjust', id: item.id, delta: 1 }, `${item.name} updated`)
                                }
                              >
                                <Icon name="plus" size={18} />
                              </button>
                            </div>
                          </div>
                          <div class="item-card-footer">
                            {item.expires_on ? (
                              <span>
                                <Icon name="clock" size={13} />
                                {dateLabel(item.expires_on)}
                              </span>
                            ) : (
                              <span>
                                {item.quantity === 0
                                  ? 'Out · ready to restock'
                                  : item.last_checked_at
                                    ? `Checked ${dateLabel(item.last_checked_at)}`
                                    : 'Not checked yet'}
                              </span>
                            )}
                            <button
                              class={`shopping-toggle ${item.resupply_flag ? 'flagged' : ''}`}
                              aria-label={
                                item.resupply_flag
                                  ? `Remove ${item.name} from shopping`
                                  : `Add ${item.name} to shopping`
                              }
                              aria-pressed={item.resupply_flag}
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  { type: 'flag', id: item.id, value: !item.resupply_flag },
                                  item.resupply_flag ? 'Shopping need canceled' : 'Added to shopping',
                                )
                              }
                            >
                              <Icon name={item.resupply_flag ? 'check' : 'bag'} size={14} />
                              {item.resupply_flag ? 'On your list' : 'Add to list'}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
              {view === 'shopping' && (
                <>
                  <div class="page-heading">
                    <div>
                      <p class="eyebrow">FOR YOUR NEXT TRIP</p>
                      <h1>A little list. Less forgetting.</h1>
                      <p>
                        {shoppingCount
                          ? `${shoppingCount} ${shoppingCount === 1 ? 'thing' : 'things'} to pick up. Record each purchase to update your shelves.`
                          : 'A place for the things you need, whenever you think of them.'}
                      </p>
                    </div>
                    <span class="page-symbol">
                      <Icon name="bag" size={35} />
                    </span>
                  </div>
                  <form
                    class="shopping-add"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await run({ type: 'extra-add', text: extra }, 'Added to shopping')) setExtra('');
                    }}
                  >
                    <Icon name="plus" />
                    <input
                      aria-label="Add a shopping note"
                      value={extra}
                      onInput={(event) => setExtra(event.currentTarget.value)}
                      placeholder="Anything else to pick up?"
                      required
                      maxLength={300}
                    />
                    <button class="button primary" disabled={busy || !extra.trim()}>
                      Add
                    </button>
                  </form>
                  <div class="shopping-list">
                    {shopping
                      .sort(
                        (a, b) =>
                          (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
                      )
                      .map((item) => (
                        <article class="shopping-row" key={item.id}>
                          <button
                            class="purchase-check"
                            aria-label={`Record purchase of ${item.name}`}
                            onClick={() => open({ kind: 'quantity', id: item.id, mode: 'purchase' })}
                            disabled={busy}
                          >
                            <Icon name="check" size={18} />
                          </button>
                          <button class="shopping-name" onClick={() => open({ kind: 'detail', id: item.id })}>
                            <strong>{item.name}</strong>
                            <span>
                              {number(item.quantity)} {item.unit} at home
                              {item.category && ` · ${item.category}`}
                            </span>
                          </button>
                          <button
                            class="button secondary small"
                            disabled={busy}
                            onClick={() => open({ kind: 'quantity', id: item.id, mode: 'purchase' })}
                          >
                            Bought
                            <Icon name="plus" size={16} />
                          </button>
                          <button
                            class="icon-button"
                            aria-label={`Cancel shopping need for ${item.name}`}
                            disabled={busy}
                            onClick={() =>
                              void run({ type: 'flag', id: item.id, value: false }, 'Shopping need canceled')
                            }
                          >
                            <Icon name="close" size={17} />
                          </button>
                        </article>
                      ))}
                    {extras
                      .filter((extra) => !extra.completed_at)
                      .map((extra) => (
                        <article class="shopping-row extra-row" key={extra.id}>
                          <button
                            class="purchase-check"
                            aria-label={`Complete ${extra.text}`}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                { type: 'extra-complete', id: extra.id, value: true },
                                'Shopping note completed',
                              )
                            }
                          >
                            <Icon name="check" size={18} />
                          </button>
                          <div class="shopping-name">
                            <strong>{extra.text}</strong>
                            <span>Shopping note</span>
                          </div>
                          <button
                            class="icon-button"
                            disabled={busy}
                            aria-label={`Remove shopping note ${extra.text}`}
                            onClick={() =>
                              void run({ type: 'extra-delete', id: extra.id }, 'Shopping note removed')
                            }
                          >
                            <Icon name="close" size={17} />
                          </button>
                        </article>
                      ))}
                  </div>
                  {shoppingCount === 0 && (
                    <EmptyState icon="bag" title="All stocked up, for now.">
                      Items you flag will appear here. You can also type a note above for anything else you
                      need.
                    </EmptyState>
                  )}
                  {extras.some((extra) => extra.completed_at) && (
                    <details class="completed-notes">
                      <summary>
                        Completed notes ({extras.filter((extra) => extra.completed_at).length})
                      </summary>
                      {extras
                        .filter((extra) => extra.completed_at)
                        .map((extra) => (
                          <div class="simple-row">
                            <Icon name="check" size={17} />
                            <span>{extra.text}</span>
                            <button
                              class="text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  { type: 'extra-complete', id: extra.id, value: false },
                                  'Shopping note reopened',
                                )
                              }
                            >
                              Add back
                            </button>
                          </div>
                        ))}
                    </details>
                  )}
                </>
              )}
              {view === 'shelves' && <ShelfCheck data={data} busy={busy} commit={run} />}
              {view === 'settings' && (
                <Settings
                  data={data}
                  busy={busy}
                  commit={run}
                  onExport={() => void exportBackup()}
                  onImport={() => fileInput.current?.click()}
                  onOpen={(item) => open({ kind: 'detail', id: item.id })}
                  persistent={persistent}
                  onPersist={() => void persist()}
                  installed={installed}
                  installAvailable={!!installPrompt}
                  onInstall={() => void install()}
                  cached={cached}
                />
              )}
            </>
          )}
        </main>
        {data && canUndo(data.revision) && (
          <button class="undo-floating" disabled={busy || !!modal} onClick={() => void undo()}>
            <Icon name="undo" size={17} /> Undo last action
          </button>
        )}
        {toast && (
          <div class="toast" role="status">
            <Icon name="check" size={18} />
            <span>{toast}</span>
            <button aria-label="Dismiss notification" onClick={() => setToast('')}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
      <nav class="mobile-nav" aria-label="Mobile navigation">
        {nav.map((item) => (
          <a
            href={`#${item.id}`}
            class={view === item.id ? 'active' : ''}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <span>
              <Icon name={item.icon} size={22} />
              {item.id === 'shopping' && shoppingCount > 0 && <i>{shoppingCount}</i>}
            </span>
            {item.name}
          </a>
        ))}
      </nav>
      <input
        class="visually-hidden"
        type="file"
        ref={fileInput}
        accept=".json,application/json"
        aria-label="Choose backup file"
        onChange={(event) => {
          void importFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      {data && modal?.kind === 'edit' && (
        <ItemEditor
          key={modal.id ?? 'new'}
          {...modalProps}
          data={data}
          item={modalItem}
          onExisting={async (item) => {
            if (item.deleted_at) {
              if (await run({ type: 'restore', id: item.id }, `${item.name} restored`, modal.revision))
                close();
            } else open({ kind: 'detail', id: item.id });
          }}
        />
      )}
      {data && modalItem && modal?.kind === 'detail' && (
        <ItemDetails
          {...modalProps}
          data={data}
          item={modalItem}
          onEdit={() => open({ kind: 'edit', id: modalItem.id })}
          onQuantity={(mode) => open({ kind: 'quantity', id: modalItem.id, mode })}
          onConvert={() => open({ kind: 'convert', id: modalItem.id })}
          onMerge={() => open({ kind: 'merge', id: modalItem.id })}
        />
      )}
      {modalItem && modal?.kind === 'quantity' && (
        <QuantityDialog {...modalProps} item={modalItem} mode={modal.mode} />
      )}
      {modalItem && modal?.kind === 'convert' && <ConvertDialog {...modalProps} item={modalItem} />}
      {data && modalItem && modal?.kind === 'merge' && (
        <MergeDialog {...modalProps} data={data} item={modalItem} />
      )}
      {modal?.kind === 'import' && (
        <Modal title="Restore this backup?" onClose={close} busy={busy}>
          <p>
            This will replace the inventory on this device. Export your current inventory first if you want to
            keep a copy.
          </p>
          <div class="import-summary">
            <div>
              <strong>{modal.candidate.items.filter((item) => !item.deleted_at).length}</strong>
              <span>active items</span>
            </div>
            <div>
              <strong>{modal.candidate.quantity_events.length}</strong>
              <span>history events</span>
            </div>
            <div>
              <strong>{modal.candidate.items.filter((item) => item.deleted_at).length}</strong>
              <span>archived items</span>
            </div>
          </div>
          <p class="helper">
            Backup last updated {dateLabel(modal.candidate.updated_at, true)}. Quantities, shopping flags, and
            record identities are preserved.
          </p>
          <button type="button" class="text-button" disabled={busy} onClick={() => void exportBackup()}>
            <Icon name="download" size={17} />
            Export current inventory first
          </button>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (working.current) return;
              working.current = true;
              setBusy(true);
              setError(null);
              try {
                setData(
                  data
                    ? await restoreInventory(modal.candidate, modal.revision)
                    : await recoverInventory(modal.candidate),
                );
                setToast('Backup restored');
                setModal(null);
              } catch (error) {
                setError(storageError(error));
              } finally {
                working.current = false;
                setBusy(false);
              }
            }}
          >
            <label class="check-field">
              <input type="checkbox" required /> Replace the inventory on this device with this backup.
            </label>
            <ErrorMessage message={error} />
            <div class="modal-actions">
              <button class="button primary" disabled={busy}>
                {busy ? 'Restoring…' : 'Restore backup'}
                <Icon name="upload" size={18} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
