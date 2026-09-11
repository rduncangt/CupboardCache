import { useEffect, useState } from 'preact/hooks';
import type { Command } from './commands';
import { duplicates, itemInput, newItemInput, number, qualitative, packageDisplay, entryUnits, convertAmount, setOpenContainer, suggestedPackage, type InventoryData, type Item, type ItemInput, type PackageSize } from './model';
import { Modal, Field, Icon, ErrorMessage, dateLabel } from './components';

export type Commit = (command: Command, message: string) => Promise<boolean>;
type Common = { busy: boolean; error: string | null; onClose: () => void; commit: Commit };
const optional = (form: FormData, key: string) => String(form.get(key) ?? '').trim() || null;
function numeric(form: FormData, key: string): number {
  const text = String(form.get(key) ?? '').trim();
  if (!text || !Number.isFinite(Number(text))) throw new Error('Enter a valid amount.');
  return Number(text);
}
function readPackage(form: FormData): PackageSize | null {
  return optional(form, 'package_amount') ? { amount: numeric(form, 'package_amount'), unit: String(form.get('package_unit')) as PackageSize['unit'] } : null;
}

export function ItemEditor({ data, item, busy, error, onClose, commit, onExisting }: Common & { data: InventoryData; item?: Item; onExisting: (item: Item) => void }) {
  const initial = item ? itemInput(item) : newItemInput();
  const [name, setName] = useState(initial.name);
  const [unit, setUnit] = useState(initial.unit);
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const candidates = duplicates(data.items, name, item?.id);
  const categories = [...new Set(data.items.flatMap(item => item.category ? [item.category] : []))].sort();
  const locations = [...new Set(['Pantry', 'Fridge', 'Freezer', ...data.items.flatMap(item => item.location ? [item.location] : [])])];
  return <Modal title={item ? 'Edit item' : 'Add to your cupboard'} onClose={onClose} busy={busy} dirty={dirty}>
    <form onInput={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); setLocalError(null);
      try {
        const form = new FormData(event.currentTarget);
        const input: ItemInput = {
          name: String(form.get('name')).trim(), quantity: numeric(form, 'quantity'), unit,
          category: optional(form, 'category'), location: optional(form, 'location'), description: optional(form, 'description'),
          aliases: String(form.get('aliases') ?? '').split(/[,\n]/).map(value => value.trim()).filter(Boolean),
          display_mode: String(form.get('display_mode')) as ItemInput['display_mode'], package_size: readPackage(form),
          expires_on: optional(form, 'expires_on'), resupply_threshold: optional(form, 'threshold') === null ? null : numeric(form, 'threshold'),
          never_prompt: form.has('never_prompt'),
        };
        if (await commit(item ? { type: 'edit', id: item.id, input } : { type: 'create', input }, item ? 'Item updated' : `${input.name} added`)) onClose();
      } catch (error) { setLocalError(error instanceof Error ? error.message : 'Check the item details.'); }
    }}>
      <Field label="Item name"><input name="name" value={name} onInput={event => setName(event.currentTarget.value)} placeholder="e.g. Smoked paprika" required maxLength={200} autoFocus autoComplete="off" /></Field>
      {candidates.length > 0 && <div class="duplicate-note"><strong>Already on your shelf?</strong>{candidates.map(candidate => <button key={candidate.id} type="button" onClick={() => onExisting(candidate)}><span>{candidate.name}</span><small>{candidate.deleted_at ? 'Archived · restore' : `${number(candidate.quantity)} ${candidate.unit}`}</small><Icon name="arrow" size={16} /></button>)}<label class="check-field"><input type="checkbox" required /> This is a different item</label></div>}
      <div class="form-grid"><Field label="Quantity"><input name="quantity" type="number" inputMode="decimal" defaultValue={initial.quantity} min="0" step="any" required /></Field><Field label="Unit" hint={item ? 'Use Change unit from item details to convert.' : 'Choose the way you count it.'}><input name="unit" list="units" value={unit} onInput={event => setUnit(event.currentTarget.value)} required maxLength={40} readOnly={!!item} /><datalist id="units">{['item', 'bag', 'jar', 'can', 'bottle', 'packet', 'stick', 'g', 'kg', 'ml', 'l'].map(unit => <option value={unit} />)}</datalist></Field></div>
      <div class="form-grid"><Field label="Category"><input name="category" list="categories" defaultValue={initial.category ?? ''} placeholder="e.g. Spices" maxLength={100} /><datalist id="categories">{categories.map(value => <option value={value} />)}</datalist></Field><Field label="Location"><input name="location" list="locations" defaultValue={initial.location ?? ''} placeholder="e.g. Pantry" maxLength={100} /><datalist id="locations">{locations.map(value => <option value={value} />)}</datalist></Field></div>
      <Field label="Quantity display"><select name="display_mode" defaultValue={initial.display_mode}><option value="numeric">Number and unit</option><option value="qualitative">Full / half / low / out</option></select></Field>
      <div class="form-grid"><Field label={`Shopping threshold (${unit})`} hint="Leave blank to flag items yourself."><input name="threshold" type="number" inputMode="decimal" defaultValue={initial.resupply_threshold ?? ''} min="0" step="any" placeholder="Optional" /></Field><Field label="Earliest expiry"><input name="expires_on" type="date" defaultValue={initial.expires_on ?? ''} /></Field></div>
      <label class="check-field"><input name="never_prompt" type="checkbox" defaultChecked={initial.never_prompt} /> Never add automatically to shopping</label>
      <details class="form-details" open={!!(initial.description || initial.aliases.length || initial.package_size)}><summary>More details <span>description, aliases & package size</span></summary>
        <Field label="Description"><textarea name="description" defaultValue={initial.description ?? ''} placeholder="The details that help you recognize it" maxLength={2000} rows={2} /></Field>
        <Field label="Also known as" hint="Separate other names with commas."><input name="aliases" defaultValue={initial.aliases.join(', ')} placeholder="e.g. Paprika, smoked pepper" /></Field>
        <div class="form-grid"><Field label={`One ${unit} contains`} hint={item && item.quantity > 0 ? 'Keep this size while stock remains; use Change unit to convert.' : 'Optional, for precise measurements.'}><input name="package_amount" type="number" inputMode="decimal" step="any" min="0.000001" defaultValue={initial.package_size?.amount ?? ''} placeholder="e.g. 1" /></Field><Field label="Package measure"><select name="package_unit" defaultValue={initial.package_size?.unit ?? 'kg'}>{['g', 'kg', 'ml', 'l'].map(unit => <option value={unit}>{unit}</option>)}</select></Field></div>
      </details>
      <ErrorMessage message={localError || error} />
      <div class="modal-actions"><button class="button primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}<Icon name="check" size={18} /></button></div>
    </form>
  </Modal>;
}

export function QuantityDialog({ item, mode, busy, error, onClose, commit }: Common & { item: Item; mode: 'actual' | 'purchase' }) {
  const [amount, setAmount] = useState(String(mode === 'actual' ? item.quantity : 1));
  const [unit, setUnit] = useState(item.unit);
  const [keep, setKeep] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  let converted: number | null = null;
  try { if (amount.trim()) converted = convertAmount(Number(amount), unit, item); } catch { /* Validation is shown on submission. */ }
  const resulting = converted === null ? null : mode === 'purchase' ? item.quantity + converted : converted;
  const low = resulting !== null && item.resupply_threshold !== null && resulting <= item.resupply_threshold;
  return <Modal title={mode === 'purchase' ? 'Record a purchase' : 'Set what is on the shelf'} onClose={onClose} busy={busy} dirty={dirty}>
    <div class="dialog-item"><span class="item-symbol"><Icon name="jar" size={28} /></span><div><h3>{item.name}</h3><p>Currently {number(item.quantity)} {item.unit}</p></div></div>
    <form onSubmit={async event => {
      event.preventDefault(); setLocalError(null);
      try {
        if (!amount.trim()) throw new Error('Enter an amount.');
        const quantity = convertAmount(Number(amount), unit, item);
        if (await commit(mode === 'purchase' ? { type: 'purchase', id: item.id, amount: quantity, keep } : { type: 'actual', id: item.id, quantity }, mode === 'purchase' ? `${item.name} restocked` : `${item.name} checked`)) onClose();
      } catch (error) { setLocalError(error instanceof Error ? error.message : 'Check the quantity.'); }
    }}>
      <div class="form-grid"><Field label={mode === 'purchase' ? 'Amount bought' : 'Actual quantity'}><input type="number" inputMode="decimal" value={amount} onInput={event => { setAmount(event.currentTarget.value); setDirty(true); }} min={mode === 'purchase' ? '0.000001' : '0'} step="any" required autoFocus /></Field><Field label="Measure"><select value={unit} onChange={event => { setUnit(event.currentTarget.value); setDirty(true); }}>{entryUnits(item).map(unit => <option value={unit}>{unit}</option>)}</select></Field></div>
      {resulting !== null && <div class="quantity-preview"><span>After this change</span><strong>{number(resulting)} <small>{item.unit}</small></strong></div>}
      {mode === 'purchase' ? <><label class="check-field"><input type="checkbox" checked={keep} onChange={event => setKeep(event.currentTarget.checked)} /> Keep on my shopping list</label>{low && <p class="helper">This leaves you at or below your threshold. Keep it on the list if you still need more.</p>}</> : <p class="helper">A shelf correction keeps any existing shopping flag. Choose Record a purchase when you buy more.</p>}
      <ErrorMessage message={localError || error} />
      <div class="modal-actions"><button class="button primary" disabled={busy}>{busy ? 'Saving…' : mode === 'purchase' ? 'Record purchase' : 'Save actual quantity'}<Icon name="check" size={18} /></button></div>
    </form>
  </Modal>;
}

export function ItemDetails({ data, item, busy, error, onClose, commit, onEdit, onQuantity, onConvert, onMerge }: Common & { data: InventoryData; item: Item; onEdit: () => void; onQuantity: (mode: 'actual' | 'purchase') => void; onConvert: () => void; onMerge: () => void }) {
  const ids = new Set([item.id]);
  for (let pass = 0; pass < data.items.length; pass++) {
    let added = false;
    for (const source of data.items) if (source.merged_into_id && ids.has(source.merged_into_id) && !ids.has(source.id)) { ids.add(source.id); added = true; }
    if (!added) break;
  }
  const events = data.quantity_events.filter(event => ids.has(event.item_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [showAll, setShowAll] = useState(false);
  return <Modal title={item.name} onClose={onClose} busy={busy}>
    <div class="detail-quantity"><strong>{item.display_mode === 'qualitative' ? qualitative(item.quantity) : number(item.quantity)}</strong><span>{item.display_mode === 'qualitative' ? `${number(item.quantity)} ${item.unit}` : item.unit}</span>{item.package_size && <small>{packageDisplay(item)}</small>}</div>
    <div class="detail-tags">{item.location && <span class="tag">{item.location}</span>}{item.category && <span class="tag">{item.category}</span>}{item.resupply_flag && <span class="tag shopping-tag">On your shopping list</span>}</div>
    {item.description && <p>{item.description}</p>}
    <div class="button-row"><button class="button primary" disabled={busy} onClick={() => onQuantity('actual')}>Set actual quantity</button><button class="button secondary" disabled={busy} onClick={() => onQuantity('purchase')}><Icon name="bag" /> Bought more</button></div>
    {item.display_mode === 'qualitative' && <div class="qualitative-controls"><span>Set open container</span><div>{([['Full', 1], ['Half', 0.5], ['Low', 0.2], ['Out', 0]] as const).map(([label, fill]) => <button class="button small secondary" disabled={busy} onClick={async () => { if (await commit({ type: 'actual', id: item.id, quantity: setOpenContainer(item.quantity, fill) }, `${item.name} checked`)) onClose(); }}>{label}</button>)}</div><small>Spare containers stay counted. Use All out below for zero total.</small></div>}
    <dl class="detail-facts"><div><dt>Last shelf check</dt><dd>{dateLabel(item.last_checked_at, true)}</dd></div><div><dt>Shopping threshold</dt><dd>{item.resupply_threshold === null ? 'Manual only' : `${number(item.resupply_threshold)} ${item.unit}`}{item.never_prompt && ' · prompts off'}</dd></div>{item.expires_on && <div><dt>Earliest expiry</dt><dd>{dateLabel(item.expires_on)}</dd></div>}{item.aliases.length > 0 && <div><dt>Other names</dt><dd>{item.aliases.join(', ')}</dd></div>}</dl>
    <div class="detail-tools"><button disabled={busy} onClick={onEdit}><Icon name="edit" /> Edit details</button><button disabled={busy} onClick={async () => { if (await commit({ type: 'flag', id: item.id, value: !item.resupply_flag }, item.resupply_flag ? 'Shopping need canceled' : 'Added to shopping')) onClose(); }}><Icon name="bag" /> {item.resupply_flag ? 'Cancel shopping need' : 'Add to shopping'}</button><button disabled={busy} onClick={onConvert}><Icon name="swap" /> Change unit</button><button disabled={busy || data.items.filter(item => !item.deleted_at).length < 2} onClick={onMerge}><Icon name="merge" /> Merge a duplicate</button><button disabled={busy || item.quantity === 0} onClick={async () => { if (await commit({ type: 'actual', id: item.id, quantity: 0 }, `${item.name} marked out`)) onClose(); }}><Icon name="minus" /> All out</button><button class="danger-text" disabled={busy} onClick={async () => { if (await commit({ type: 'delete', id: item.id }, `${item.name} archived`)) onClose(); }}><Icon name="trash" /> Archive item</button></div>
    <ErrorMessage message={error} />
    <section class="history"><div class="section-heading"><h3>Quantity history</h3><small>Last {data.settings.history_retention_days} days</small></div>{events.length === 0 ? <p class="helper">No events in the retention window.</p> : (showAll ? events : events.slice(0, 10)).map(event => <div class="history-row" key={event.id}><Icon name={event.reason === 'purchase' ? 'bag' : event.reason === 'undo' ? 'undo' : 'clock'} size={17} /><div><strong>{event.reason.replace('_', ' ')}</strong><span>{event.before && `${number(event.before.quantity)} ${event.before.unit} → `}{number(event.after.quantity)} {event.after.unit}{event.item_id !== item.id && ' · merged item'}</span></div><time>{dateLabel(event.created_at, true)}</time></div>)}{events.length > 10 && !showAll && <button class="text-button" onClick={() => setShowAll(true)}>Show all {events.length} events</button>}</section>
  </Modal>;
}

export function ConvertDialog({ item, busy, error, onClose, commit }: Common & { item: Item }) {
  const [factor, setFactor] = useState('1');
  const [unit, setUnit] = useState(item.unit);
  const [localError, setLocalError] = useState<string | null>(null);
  const [packAmount, setPackAmount] = useState(String(item.package_size?.amount ?? ''));
  const [packUnit, setPackUnit] = useState<PackageSize['unit']>(item.package_size?.unit ?? 'g');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { const suggested = suggestedPackage(item, Number(factor), unit); setPackAmount(String(suggested?.amount ?? '')); setPackUnit(suggested?.unit ?? 'g'); }, [factor, unit]);
  return <Modal title="Change measurement unit" onClose={onClose} busy={busy} dirty={dirty}>
    <p class="helper">Keep the amount on the shelf the same. For 1 kg bags changed to grams, one old bag becomes 1000 new grams. A spelling correction uses a factor of 1.</p>
    <form onInput={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); setLocalError(null);
      try { if (await commit({ type: 'convert', id: item.id, factor: Number(factor), unit: unit.trim(), package_size: readPackage(new FormData(event.currentTarget)) }, 'Quantity and threshold converted')) onClose(); } catch (error) { setLocalError(error instanceof Error ? error.message : 'Check the conversion.'); }
    }}>
      <div class="form-grid"><Field label="New unit"><input value={unit} onInput={event => setUnit(event.currentTarget.value)} required maxLength={40} autoFocus /></Field><Field label={`New units in one old ${item.unit}`}><input type="number" inputMode="decimal" value={factor} onInput={event => setFactor(event.currentTarget.value)} min="0.000001" step="any" required /></Field></div>
      {Number(factor) > 0 && <div class="conversion-preview"><p>Quantity: {number(item.quantity)} {item.unit} → <strong>{number(item.quantity * Number(factor))} {unit}</strong></p><p>Threshold: {item.resupply_threshold === null ? 'Manual only (unchanged)' : `${number(item.resupply_threshold)} ${item.unit} → ${number(item.resupply_threshold * Number(factor))} ${unit}`}</p><p>Your shopping flag stays unchanged.</p></div>}
      <div class="form-grid"><Field label="Amount in one new unit" hint="Leave blank if the new unit is already precise."><input name="package_amount" type="number" inputMode="decimal" min="0.000001" step="any" value={packAmount} onInput={event => setPackAmount(event.currentTarget.value)} /></Field><Field label="Package measure"><select name="package_unit" value={packUnit} onChange={event => setPackUnit(event.currentTarget.value as PackageSize['unit'])}>{['g', 'kg', 'ml', 'l'].map(unit => <option value={unit}>{unit}</option>)}</select></Field></div>
      <label class="check-field"><input type="checkbox" required /> The conversion and package size above describe the same stock.</label><ErrorMessage message={localError || error} /><div class="modal-actions"><button class="button primary" disabled={busy}>{busy ? 'Saving…' : 'Convert unit'}</button></div>
    </form>
  </Modal>;
}

export function MergeDialog({ data, item, busy, error, onClose, commit }: Common & { data: InventoryData; item: Item }) {
  const [sourceId, setSourceId] = useState('');
  const source = data.items.find(item => item.id === sourceId);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  return <Modal title="Merge a duplicate" onClose={onClose} busy={busy} dirty={dirty}>
    <p>Keep <strong>{item.name}</strong> and its unit, <strong>{item.unit}</strong>. The other item will be archived and its name kept as an alias.</p>
    <form onInput={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); setLocalError(null);
      try {
        const form = new FormData(event.currentTarget);
        if (await commit({ type: 'merge', source: sourceId, target: item.id, fields: { quantity: numeric(form, 'quantity'), category: optional(form, 'category'), location: optional(form, 'location'), expires_on: optional(form, 'expires_on'), resupply_threshold: optional(form, 'threshold') === null ? null : numeric(form, 'threshold'), never_prompt: form.has('never_prompt') } }, 'Duplicate merged')) onClose();
      } catch (error) { setLocalError(error instanceof Error ? error.message : 'Review the merged values.'); }
    }}>
      <Field label="Duplicate to combine"><select value={sourceId} onChange={event => setSourceId(event.currentTarget.value)} required><option value="">Choose an item</option>{data.items.filter(other => other.id !== item.id && !other.deleted_at).sort((a,b) => a.name.localeCompare(b.name)).map(other => <option value={other.id}>{other.name} · {number(other.quantity)} {other.unit}</option>)}</select></Field>
      {source && <div class="comparison"><p><strong>Other item:</strong> {number(source.quantity)} {source.unit}, {source.location || 'no location'}, {source.category || 'no category'}.</p><p>Expiry: {source.expires_on || 'none'}. Threshold: {source.resupply_threshold === null ? 'none' : `${number(source.resupply_threshold)} ${source.unit}`}. Automatic prompts: {source.never_prompt ? 'off' : 'on'}.</p><p>Review the values below. An existing shopping flag from either item will be kept.</p></div>}
      <Field label={`Actual combined quantity (${item.unit})`} hint="Count the shelf. The two records may describe the same stock."><input name="quantity" type="number" inputMode="decimal" min="0" step="any" required placeholder="Enter the total actually on hand" /></Field>
      <div class="form-grid"><Field label="Final category"><input name="category" defaultValue={item.category ?? ''} /></Field><Field label="Final location"><input name="location" defaultValue={item.location ?? ''} /></Field><Field label="Final earliest expiry"><input type="date" name="expires_on" defaultValue={item.expires_on ?? ''} /></Field><Field label={`Final threshold (${item.unit})`}><input type="number" name="threshold" min="0" step="any" defaultValue={item.resupply_threshold ?? ''} /></Field></div>
      <label class="check-field"><input type="checkbox" name="never_prompt" defaultChecked={item.never_prompt} /> Never add automatically to shopping</label><label class="check-field"><input type="checkbox" required /> I reviewed the units, quantity, and details for the combined item.</label>
      <ErrorMessage message={localError || error} /><div class="modal-actions"><button class="button primary" disabled={busy || !sourceId}>{busy ? 'Saving…' : 'Merge into ' + item.name}</button></div>
    </form>
  </Modal>;
}
