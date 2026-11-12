import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { deskSummary } from '../src/domain/board.ts';

type Address = { address_line_1?: string; address_line_2?: string; city?: string; state?: string; postal_code?: string; country_code?: string };
type Order = {
  id: string; capture_id: string | null; status: string; amount_cents: number; currency: string; buyer_name: string | null;
  protection_state: string; address: Address | null; extraction: any; verdict: any; tracker_id: string | null; has_label: boolean;
  tracking_number: string | null; carrier: string | null; tracker_posted_at: string | null;
  listing_id: string | null; item_title: string | null; archived_at: string | null; updated_at: string;
};
type Listing = { id: string; title: string; description: string; price_cents: number; currency: string; created_at: string; sold_count?: number };
type Dispute = { id: string; order_id: string | null; status: string; reason: string | null; due_at: string | null; details_json: string };

const money = (cents: number, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
  return value as T;
};
const nav = (path: string) => { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); };
const addressLines = (address: Address | null) => address ? [address.address_line_1, address.address_line_2, address.city, [address.state, address.postal_code].filter(Boolean).join(' '), address.country_code].filter(Boolean) : [];
const fullAddress = (address: Address | null) => addressLines(address).join(', ');

function useRoute() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => { const update = () => setPath(location.pathname + location.search); addEventListener('popstate', update); return () => removeEventListener('popstate', update); }, []);
  return path;
}

function Root() {
  const route = useRoute();
  const item = route.split('?')[0].match(/^\/item\/([^/]+)$/);
  return item ? <BuyerPage id={decodeURIComponent(item[1])} /> : <App />;
}

function App() {
  const route = useRoute();
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [setup, setSetup] = useState<{ missing: string[]; paypalEnv: string; demoBuyerEmail: string | null }>({ missing: [], paypalEnv: 'sandbox', demoBuyerEmail: null });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [orderRows, setupData] = await Promise.all([api<Order[]>('/api/orders'), api<typeof setup>('/api/setup')]);
      setOrders(orderRows); setSetup(setupData); setError('');
      if (!setupData.missing.includes('PAYPAL_CLIENT_ID') && !setupData.missing.includes('PAYPAL_CLIENT_SECRET')) {
        const disputeRows = await api<Dispute[]>('/api/disputes'); setDisputes(disputeRows);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the seller desk'); }
  }, []);
  useEffect(() => { void api<{ authenticated: boolean; configured: boolean }>('/api/session').then((session) => { setAuthenticated(session.authenticated); if (!session.configured) setAuthError('Set APP_PASSWORD before opening this Postmark instance.'); }).catch(() => setAuthError('Postmark access could not be checked.')).finally(() => setAuthChecked(true)); }, []);
  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    void api('/api/disputes/reconcile', { method: 'POST' }).then(() => refresh()).catch(() => undefined);
    const source = new EventSource('/api/events'); source.addEventListener('update', () => void refresh()); return () => source.close();
  }, [refresh, authenticated]);

  useEffect(() => { if (location.pathname === '/') nav('/orders'); document.title = `Postmark: ${route.includes('/disputes') ? 'dispute evidence' : route === '/shop' ? 'listings' : route.includes('/orders/') ? 'shipment label check' : 'seller orders'}`; }, [route]);

  const path = route.split('?')[0];
  const orderMatch = path.match(/^\/orders\/([^/]+)$/);
  const disputeMatch = path.match(/^\/disputes\/([^/]+)$/);
  const selectedOrder = orderMatch ? orders.find((item) => item.id === decodeURIComponent(orderMatch[1])) : undefined;

  if (!authChecked) return <div className="app-shell"><main className="page-frame"><div className="loading-panel" role="status">Checking Postmark access…</div></main></div>;
  if (!authenticated) return <AccessPage error={authError} onAuthenticated={() => { setAuthError(''); setAuthenticated(true); }} />;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/orders" onClick={(event) => { event.preventDefault(); nav('/orders'); }} aria-label="Postmark orders">
        <span className="brand-mark" aria-hidden="true">P</span><span>postmark</span>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        <a href="/orders" aria-current={path.startsWith('/orders') ? 'page' : undefined} onClick={(e) => { e.preventDefault(); nav('/orders'); }}>Orders</a>
        <a href="/disputes" aria-current={path.startsWith('/disputes') ? 'page' : undefined} onClick={(e) => { e.preventDefault(); nav('/disputes'); }}>Disputes <span className="nav-count">{disputes.length}</span></a>
        <a href="/shop" aria-current={path === '/shop' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); nav('/shop'); }}>Shop</a>
      </nav>
      <div className="account-mark"><span className={`environment-dot ${setup.paypalEnv === 'live' ? 'live' : ''}`}></span>{setup.paypalEnv}<button className="logout-button" onClick={async () => { await api('/api/session/logout', { method: 'POST' }); setOrders([]); setDisputes([]); setAuthenticated(false); }}>Sign out</button></div>
    </header>

    <main className="page-frame">
      {setup.missing.length > 0 && <SetupPanel missing={setup.missing} buyer={setup.demoBuyerEmail} />}
      {error && <div className="alert alert-danger" role="alert">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
      {path === '/shop' && <ShopPage />}
      {path === '/disputes' && <DisputesPage disputes={disputes} orders={orders} />}
      {disputeMatch && <DisputePage id={decodeURIComponent(disputeMatch[1])} setup={setup} setError={setError} />}
      {orderMatch && <OrderPage id={decodeURIComponent(orderMatch[1])} order={selectedOrder} setup={setup} setError={setError} refresh={refresh} />}
      {!['/shop', '/disputes'].includes(path) && !orderMatch && !disputeMatch && <OrdersPage orders={orders} disputes={disputes} />}
    </main>
    <footer className="footer"><span>Postmark</span><span>Check the label before the parcel leaves your hands.</span><a href="https://www.paypal.com/us/legalhub/paypal/seller-protection?locale.x=en_US" target="_blank" rel="noreferrer">PayPal Seller Protection policy</a></footer>
  </div>;
}


function AccessPage({ error, onAuthenticated }: { error: string; onAuthenticated: () => void }) {
  const [password, setPassword] = useState(''); const [localError, setLocalError] = useState(error); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setLocalError('');
    try { await api('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); onAuthenticated(); }
    catch (e) { setLocalError(e instanceof Error ? e.message : 'Access was not granted'); }
    finally { setBusy(false); setPassword(''); }
  };
  return <div className="app-shell access-shell"><main className="access-main"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">P</span><span>postmark</span></a><form className="paper-panel access-panel" onSubmit={submit}><p className="overline">Seller desk</p><h1>Open your shipping file.</h1><p>Enter the access password configured for this Postmark instance.</p>{localError && <p className="field-error" role="alert">{localError}</p>}<label htmlFor="access-password">Access password</label><input id="access-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="button button-primary" disabled={busy}>{busy ? 'Opening desk…' : 'Open Postmark'}</button></form></main></div>;
}

function SetupPanel({ missing, buyer }: { missing: string[]; buyer: string | null }) {
  return <section className="setup-panel" aria-labelledby="setup-title">
    <div><p className="overline">Connection setup</p><h2 id="setup-title">Connect the accounts that power Postmark.</h2><p>Orders come from PayPal. Label reading and evidence notes use OpenRouter.</p></div>
    <div className="setup-vars">{missing.map((name) => <span className="setup-var" key={name}>{name}</span>)}{buyer && <p>Sandbox buyer: <code>{buyer}</code></p>}</div>
  </section>;
}

function OrdersPage({ orders: allOrders, disputes }: { orders: Order[]; disputes: Dispute[] }) {
  const [orderId, setOrderId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [showArchived, setShowArchived] = useState(false);
  const summary = deskSummary(allOrders);
  const orders = summary.active;
  const importOrder = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const order = await api<Order>('/api/orders/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) }); nav(`/orders/${encodeURIComponent(order.id)}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Order could not be imported'); }
    finally { setBusy(false); }
  };
  const sorted = [...orders].sort((a, b) => rankState(a.protection_state) - rankState(b.protection_state));
  const urgent = sorted.find((order) => ['AT RISK', 'DISPUTED', 'UNSHIPPED'].includes(order.protection_state));
  const cleared = [...orders].filter((order) => order.has_label).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return <>
    <div className="page-heading"><div><p className="overline">Seller desk</p><h1>Orders</h1><p>Check the shipping address before tracking reaches PayPal.</p></div><button className="button button-primary" onClick={() => nav('/shop')}>List an item</button></div>
    <section className="summary-strip" aria-label="Order summary">
      <div className="summary-item"><span>Orders in desk</span><strong className="summary-number">{orders.length}</strong></div>
      <div className={`summary-item ${summary.atRiskCents > 0 ? 'summary-risk' : ''}`}><span>Amount at risk</span><strong className="summary-number mono">{money(summary.atRiskCents)}</strong><small>{summary.unshipped} unshipped, {summary.atRisk} label {summary.atRisk === 1 ? 'mismatch' : 'mismatches'}</small></div>
      <div className="summary-item"><span>Disputes to review</span><strong className="summary-number">{disputes.length}</strong></div>
    </section>
    <div className="desk-grid">
      <section className="workbench">
        <div className="section-heading"><h2>{urgent ? 'Next parcel to check' : cleared ? 'Last parcel cleared' : 'Shipping workbench'}</h2><span className="section-rule"></span></div>
        {urgent ? <UrgentOrder order={urgent} /> : cleared ? <UrgentOrder order={cleared} /> : orders.length ? <div className="quiet-panel"><p className="stamp stamp-neutral">READY</p><h3>Every order is in the ledger.</h3><p>Open an order to add a label photo and run the address check before tracking.</p></div> : <div className="empty-panel"><div className="empty-mark" aria-hidden="true">P</div><h3>Your order desk is clear.</h3><p>Bring in a PayPal order or create a checkout link to start a shipment.</p><div className="button-row"><button className="button button-primary" onClick={() => nav('/shop')}>List an item</button><a className="button button-secondary" href="#import-order" onClick={(e) => { e.preventDefault(); document.getElementById('paypal-order-id')?.focus(); }}>Add PayPal order</a></div></div>}
        <form className="import-form" id="import-order" onSubmit={importOrder}>
          <div><label htmlFor="paypal-order-id">Add an existing PayPal order</label><p className="field-help">The order and its shipping address will be read from PayPal.</p></div>
          <div className="inline-form"><input id="paypal-order-id" value={orderId} onChange={(e) => setOrderId(e.target.value)} required aria-describedby="import-error" /><button className="button button-secondary" disabled={busy}>{busy ? 'Reading…' : 'Add order'}</button></div>
          {error && <p className="field-error" id="import-error" role="alert">{error}</p>}
        </form>
      </section>
      <aside className="order-rail">
        <div className="section-heading"><h2>Order ledger</h2><span className="rail-total">{orders.length}</span></div>
        {orders.length ? <ul className="order-list">{sorted.map((order) => <li key={order.id}><OrderRow order={order} /></li>)}</ul> : <p className="rail-empty">Imported PayPal orders appear here with their amount and shipping state.</p>}
        {summary.archived.length > 0 && <div className="archive-drawer">
          <button className="text-button" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide' : 'Show'} archived orders ({summary.archived.length})</button>
          {showArchived && <ul className="order-list order-list-archived">{summary.archived.map((order) => <li key={order.id}><OrderRow order={order} /></li>)}</ul>}
        </div>}
      </aside>
    </div>
  </>;
}

function rankState(state: string) { return ({ 'AT RISK': 0, DISPUTED: 1, UNSHIPPED: 2, PROTECTED: 3, 'TRACKING ON PAYPAL': 4, 'EVIDENCE SUBMITTED': 5, RESOLVED: 6 } as Record<string, number>)[state] ?? 7; }
function StatusBadge({ status }: { status: string }) { const kind = status === 'PROTECTED' || status === 'TRACKING ON PAYPAL' || status === 'EVIDENCE SUBMITTED' || status === 'RESOLVED' ? 'good' : status === 'AT RISK' || status === 'DISPUTED' ? 'bad' : 'neutral'; return <span className={`status-badge ${kind}`}>{status}</span>; }
const destination = (address: Address | null) => address ? [address.city, address.state || address.country_code].filter(Boolean).join(', ') : '';
const labelUrl = (order: Order, width?: number) => `/api/labels/${encodeURIComponent(order.id)}?v=${encodeURIComponent(order.updated_at)}${width ? `&w=${width}` : ''}`;
const listingPhoto = (id: string, width: number) => `/api/public/listings/${encodeURIComponent(id)}/photo?w=${width}`;

function EvidenceTile({ order, size }: { order: Order; size: 'row' | 'card' | 'full' }) {
  const verdict = order.verdict?.state as string | undefined;
  const stamp = verdict && <span className={`tile-stamp ${verdict === 'PROTECTED' ? 'tile-stamp-good' : 'tile-stamp-risk'}`}>{verdict}</span>;
  if (order.has_label) return <figure className={`evidence-tile evidence-tile-${size}`}>
    <img src={labelUrl(order, size === 'full' ? 900 : size === 'card' ? 480 : 160)} alt={`Label photo for order ${order.id}`} />{stamp}
  </figure>;
  const read = order.extraction?.tracking_number as string | undefined;
  return <figure className={`evidence-tile evidence-tile-${size} evidence-tile-empty`} aria-label={`No label photo yet for order ${order.id}`}>
    <span className="tile-number mono">{order.id.slice(-4)}</span>
    <span className="tile-caption">{read ? `Label read: ${read}` : 'No label photo'}</span>
  </figure>;
}
function OrderRow({ order }: { order: Order }) { const place = destination(order.address); return <a className="order-row" href={`/orders/${encodeURIComponent(order.id)}`} onClick={(e) => { e.preventDefault(); nav(`/orders/${encodeURIComponent(order.id)}`); }}>
  <EvidenceTile order={order} size="row" />
  <span className="order-row-main"><strong>{order.buyer_name || 'Buyer not on PayPal order'}</strong><span className="order-place">{[place, order.item_title].filter(Boolean).join(' · ') || 'No shipping address from PayPal'}</span><span className="order-id mono">{order.id}</span></span><span className="order-row-side"><span className="amount mono">{money(order.amount_cents, order.currency)}</span><StatusBadge status={order.protection_state} /></span>
</a>; }
function UrgentOrder({ order }: { order: Order }) { return <a className={`urgent-order ${order.verdict?.state === 'PROTECTED' ? 'urgent-order-clear' : ''}`} href={`/orders/${encodeURIComponent(order.id)}`} onClick={(e) => { e.preventDefault(); nav(`/orders/${encodeURIComponent(order.id)}`); }}>
  {order.listing_id ? <img className="urgent-item" src={listingPhoto(order.listing_id, 480)} alt={order.item_title ?? 'Item in this order'} /> : <EvidenceTile order={order} size="card" />}
  <div className="urgent-body"><div className="urgent-order-head"><StatusBadge status={order.protection_state} /><span className="amount mono">{money(order.amount_cents, order.currency)}</span></div><h3>{order.buyer_name || 'PayPal order'}</h3>{order.item_title && <p className="urgent-title">{order.item_title}</p>}<p className="mono">{order.id}</p><p>{order.address ? fullAddress(order.address) : 'Shipping address is added when PayPal capture completes.'}</p><span className="text-link">{order.has_label ? 'Review the label check' : 'Photograph the label'} <span aria-hidden="true">→</span></span></div>
</a>; }

function ShopPage() {
  const [listings, setListings] = useState<Listing[] | null>(null); const [photo, setPhoto] = useState<File | null>(null); const [preview, setPreview] = useState('');
  const [title, setTitle] = useState(''); const [price, setPrice] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(() => api<Listing[]>('/api/listings').then(setListings).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!photo) { setPreview(''); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (!photo) return; setBusy(true); setError('');
    const form = new FormData(); form.append('photo', photo); form.append('title', title); form.append('price', price); form.append('description', description);
    try { const listing = await api<Listing>('/api/listings', { method: 'POST', body: form }); setTitle(''); setPrice(''); setDescription(''); setPhoto(null); await load(); nav(`/item/${encodeURIComponent(listing.id)}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'The listing could not be saved'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-heading"><div><p className="overline">Shop</p><h1>Listings</h1><p>Each listing gets a public page where a buyer pays with PayPal. Paid orders land in the desk with the buyer's PayPal address.</p></div></div>
    <div className="shop-layout">
      <section className="listing-shelf" aria-label="Your listings">
        {listings === null ? <div className="loading-panel" role="status">Loading listings…</div> : listings.length ? <ul className="listing-grid">{listings.map((listing) => <li key={listing.id}><a className="listing-card" href={`/item/${encodeURIComponent(listing.id)}`} onClick={(e) => { e.preventDefault(); nav(`/item/${encodeURIComponent(listing.id)}`); }}>
          <img src={listingPhoto(listing.id, 640)} alt={listing.title} />
          <span className="listing-card-body"><strong>{listing.title}</strong><span className="amount mono">{money(listing.price_cents, listing.currency)}</span><span className="listing-sold">{listing.sold_count ? `${listing.sold_count} paid ${listing.sold_count === 1 ? 'order' : 'orders'}` : 'No paid orders yet'}</span></span>
        </a></li>)}</ul> : <div className="empty-panel"><h3>List your first item to get a buyer page.</h3><p>Photograph something you will ship and set a price. Postmark publishes a page with a PayPal button.</p><button className="button button-secondary" onClick={() => document.getElementById('item-photo')?.click()}>Add the first photo</button></div>}
      </section>
      <form className="paper-panel shop-form" onSubmit={create}>
        <h2>List an item</h2>
        <label htmlFor="item-photo" className={`photo-drop ${preview ? 'has-photo' : ''}`}>{preview ? <img src={preview} alt="Selected item photo" /> : <span><strong>Add a photo</strong><span>JPEG, PNG or WebP, under 15 MB</span></span>}</label>
        <input id="item-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} required />
        <label htmlFor="item-title">Title</label><input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required />
        <label htmlFor="item-price">Price in USD</label><div className="money-input"><span aria-hidden="true">$</span><input id="item-price" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={price} onChange={(e) => setPrice(e.target.value)} required /></div>
        <label htmlFor="item-description">Description</label><textarea id="item-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} required />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy || !photo}>{busy ? 'Saving listing…' : 'Publish listing'}</button>
        <p className="field-help">PayPal collects the buyer's shipping address at checkout. Postmark checks your label against it before tracking goes to PayPal.</p>
      </form>
    </div>
  </>;
}

function BuyerPage({ id }: { id: string }) {
  const [listing, setListing] = useState<Listing | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [paid, setPaid] = useState<string | null>(null);
  const [requestKey] = useState(() => crypto.randomUUID());
  useEffect(() => { api<Listing>(`/api/public/listings/${encodeURIComponent(id)}`).then((value) => { setListing(value); document.title = `${value.title}: buy with PayPal`; }).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => {
    const url = new URL(location.href); const token = url.searchParams.get('token');
    if (url.searchParams.get('cancelled') === '1') setError('Checkout was cancelled. Nothing was charged.');
    if (!token || url.searchParams.get('capture') !== '1') return;
    setBusy(true);
    api<{ id: string; status: string }>(`/api/public/listings/${encodeURIComponent(id)}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: token }) })
      .then((order) => { setPaid(order.id); history.replaceState({}, '', `/item/${encodeURIComponent(id)}`); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Payment could not be completed'))
      .finally(() => setBusy(false));
  }, [id]);
  const buy = async () => {
    setBusy(true); setError('');
    try { const result = await api<{ approvalUrl?: string }>(`/api/public/listings/${encodeURIComponent(id)}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey }) }); if (!result.approvalUrl) throw new Error('PayPal did not return a checkout link.'); location.href = result.approvalUrl; }
    catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not start'); setBusy(false); }
  };
  return <div className="app-shell buyer-shell">
    <header className="buyer-bar"><span className="brand"><span className="brand-mark" aria-hidden="true">P</span><span>postmark</span></span><span className="buyer-bar-note">Paid with PayPal. Shipped to the address on your PayPal order.</span></header>
    <main className="page-frame buyer-frame">
      {!listing ? (error ? <div className="alert" role="alert">{error}</div> : <div className="loading-panel" role="status">Loading item…</div>) : <article className="buyer-item">
        <figure className="buyer-photo"><img src={listingPhoto(listing.id, 1400)} alt={listing.title} /></figure>
        <div className="buyer-copy">
          <p className="overline">For sale</p><h1>{listing.title}</h1>
          <p className="buyer-price mono">{money(listing.price_cents, listing.currency)}</p>
          <p className="buyer-description">{listing.description}</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          {paid ? <div className="buyer-receipt" role="status"><span className="verdict-stamp" data-verdict="PAID">PAID</span><div><strong>PayPal confirmed your payment.</strong><span className="mono">Order {paid}</span><span>The seller ships to the address on your PayPal order.</span></div></div>
            : <button className="button button-paypal" disabled={busy} onClick={() => void buy()}>{busy ? 'Opening PayPal…' : 'Buy with PayPal'}</button>}
          <dl className="buyer-facts"><div><dt>Ships to</dt><dd>The address you confirm in PayPal</dd></div><div><dt>Payment</dt><dd>PayPal checkout, captured on return</dd></div></dl>
        </div>
      </article>}
    </main>
  </div>;
}

function OrderPage({ id, order: cached, setup, setError, refresh }: { id: string; order?: Order; setup: { missing: string[]; paypalEnv: string }; setError: (value: string) => void; refresh: () => Promise<void> }) {
  const [order, setOrder] = useState<Order | undefined>(cached); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [acceptRisk, setAcceptRisk] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { setOrder(cached); }, [cached]);
  useEffect(() => { if (!cached) api<Order>(`/api/orders/${encodeURIComponent(id)}`).then(setOrder).catch((e) => setError(e.message)); }, [cached, id, setError]);
  const runLabel = async (event: React.FormEvent) => {
    event.preventDefault(); if (!file) return; setBusy(true); setError(''); setNotice('');
    const form = new FormData(); form.append('label', file);
    try { const result = await api<{ order: Order; verdict: any }>(`/api/orders/${encodeURIComponent(id)}/label`, { method: 'POST', body: form }); setOrder(result.order); setNotice(result.verdict.state === 'PROTECTED' ? 'Address and tracking checks passed.' : 'Review the mismatch before posting tracking.'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The label could not be checked'); }
    finally { setBusy(false); }
  };
  const postTracking = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await api<{ trackerId: string }>(`/api/orders/${encodeURIComponent(id)}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptRisk }) }); const confirmed = await api<Order>(`/api/orders/${encodeURIComponent(id)}`); setOrder(confirmed); setNotice('PayPal confirmed the tracker on this order.'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Tracking was not posted'); }
    finally { setBusy(false); }
  };
  const archive = async (archived: boolean) => {
    setBusy(true); setError('');
    try { setOrder(await api<Order>(`/api/orders/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) })); await refresh(); if (archived) nav('/orders'); }
    catch (e) { setError(e instanceof Error ? e.message : 'The order could not be archived'); }
    finally { setBusy(false); }
  };
  if (!order) return <div className="loading-panel" role="status">Loading PayPal order…</div>;
  const address = order.address;
  const protectedPass = order.verdict?.state === 'PROTECTED';
  return <>
    <div className="breadcrumb"><a href="/orders" onClick={(e) => { e.preventDefault(); nav('/orders'); }}>Orders</a><span aria-hidden="true">/</span><span className="mono">{order.id}</span></div>
    <div className="page-heading"><div><p className="overline">Shipment file</p><h1>{order.buyer_name || 'PayPal order'}</h1><p className="mono">{[order.item_title, order.id].filter(Boolean).join(' · ')} <span className="copy-divider">·</span> {money(order.amount_cents, order.currency)}{order.archived_at ? ' · archived' : ''}</p></div>{!order.verdict && <StatusBadge status={order.protection_state} />}</div>
    {notice && <p className={`notice-line ${order.verdict?.state === 'AT RISK' ? 'notice-risk' : 'notice-good'}`} role="status">{notice}</p>}
    <div className="order-detail-grid">
      <section className="workbench">
        <div className="section-heading"><h2>Before you hand it over</h2><span className="section-rule"></span></div>
        {order.verdict && <>
          <VerdictPanel verdict={order.verdict} />
          {order.verdict.addressDifferences?.length > 0 && <div className="redline-panel"><h3>Address fields to fix</h3><p>These values differ from the address PayPal will use for Seller Protection.</p><div className="redline-table" role="table" aria-label="Address fields that differ"><div className="redline-row redline-head" role="row"><span role="columnheader">Field</span><span role="columnheader">PayPal</span><span role="columnheader">Label</span></div>{order.verdict.addressDifferences.map((diff: any) => <div className="redline-row" role="row" key={diff.field}><strong role="rowheader">{addressFieldLabel(diff.field)}</strong><span role="cell">{diff.paypal}</span><span role="cell">{diff.label}</span></div>)}</div><a href={order.verdict.policyUrl} target="_blank" rel="noreferrer">Seller Protection policy</a></div>}
          {order.extraction && !order.tracker_id && <div className="tracking-action"><button className="button button-primary" disabled={busy || (!protectedPass && !acceptRisk)} onClick={() => void postTracking()}>{busy ? 'Checking PayPal…' : 'Post tracking to PayPal'}</button>
            {!protectedPass && <label className="risk-override"><input type="checkbox" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />Ship anyway, I accept the risk</label>}
            <p className="field-help">Postmark checks PayPal’s order after posting. Tracking appears here only after PayPal confirms it.</p>
          </div>}
          {order.tracker_id && <div className="tracker-receipt"><span className="receipt-check" aria-hidden="true">✓</span><div><strong>TRACKING ON PAYPAL</strong><span className="mono">{order.tracker_id}</span><span>Read back at</span><time>{order.tracker_posted_at}</time></div></div>}
        </>}
        {order.extraction && <div className="extraction-card"><div className="extraction-heading"><h3>What the label says</h3><span>{Math.round(order.extraction.confidence * 100)}% read confidence</span></div>
          <div className="extraction-fields"><div><span>Carrier</span><strong>{order.extraction.carrier}{order.extraction.service ? ` · ${order.extraction.service}` : ''}</strong></div><div><span>Tracking number</span><strong className="mono">{order.extraction.tracking_number}</strong></div><div><span>Recipient</span><strong>{order.extraction.recipient_name || 'Unreadable on this label' }</strong></div><div><span>Address from label</span><strong>{fullAddress({ address_line_1: order.extraction.address_line_1, address_line_2: order.extraction.address_line_2, city: order.extraction.city, state: order.extraction.state, postal_code: order.extraction.postal_code, country_code: order.extraction.country })}</strong></div></div>
          <p className="field-help">Signature confirmation visible: {order.extraction.signature_confirmation_visible ? 'Yes' : 'No'}</p>
        </div>}
        <form className="upload-panel" onSubmit={runLabel}>
          <label htmlFor="label-photo" className="upload-title">{order.verdict?.state === 'AT RISK' ? 'Check a replacement label' : 'Photograph the printed label'}</label>
          <p className="field-help">The photo is read for recipient, address, carrier, and tracking. Use a clear, flat image.</p>
          <div className="file-controls"><input id="label-photo" type="file" accept="image/jpeg,image/png" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required={!order.extraction} /><button className="button button-primary" disabled={busy || !file}>{busy ? 'Reading label…' : order.verdict?.state === 'AT RISK' ? 'Check replacement' : 'Check label'}</button></div>
        </form>
      </section>
      <aside className="address-rail">
        <div className="section-heading"><h2>Label evidence</h2></div>
        <EvidenceTile order={order} size="full" />
        <p className="evidence-caption">{order.has_label ? `Stored label photo${order.extraction ? `, read at ${Math.round(order.extraction.confidence * 100)}% confidence` : ''}. This photo is attached to any PayPal dispute on this order.` : 'Photograph the printed label. The photo is kept as proof of shipment and attached to any PayPal dispute.'}</p>
        {order.listing_id && <a className="item-chip" href={`/item/${encodeURIComponent(order.listing_id)}`} onClick={(e) => { e.preventDefault(); nav(`/item/${encodeURIComponent(order.listing_id!)}`); }}><img src={listingPhoto(order.listing_id, 160)} alt="" /><span><span className="overline">Item sold</span><strong>{order.item_title}</strong></span></a>}
        <div className="section-heading rail-gap"><h2>PayPal order address</h2></div>
        <div className="address-stock"><p className="address-label">Ship to</p><strong>{order.buyer_name || order.id}</strong><address>{addressLines(address).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</address><span className="address-source">Read from PayPal Transaction Details</span></div>
        {setup.paypalEnv !== 'live' && !setup.missing.includes('PAYPAL_CLIENT_ID') && !setup.missing.includes('PAYPAL_CLIENT_SECRET') && address && <div className="sandbox-card"><p className="overline">Sandbox only</p><h3>Print a test label</h3><p>Uses this PayPal address with a clearly marked test tracking number.</p><div className="stack-buttons"><a className="button button-secondary" href={`/api/orders/${encodeURIComponent(order.id)}/sandbox-label`}>Print matching label</a><a className="quiet-link" href={`/api/orders/${encodeURIComponent(order.id)}/sandbox-label?wrongUnit=1`}>Print label with a wrong unit</a></div></div>}
        <div className="archive-control"><button className="button button-quiet" disabled={busy} onClick={() => void archive(!order.archived_at)}>{order.archived_at ? 'Restore to the desk' : 'Archive this order'}</button><p className="field-help">{order.archived_at ? 'Archived orders stay out of the desk and its totals.' : 'Archiving hides the order from the desk and its totals. PayPal keeps the order.'}</p></div>
      </aside>
    </div>
  </>;
}

function addressFieldLabel(field: string) {
  return ({ street: 'Street address', unit: 'Street / unit', line2: 'Address line 2', city: 'City', state: 'State', postal: 'ZIP code', country: 'Country' } as Record<string, string>)[field] ?? field;
}

function VerdictPanel({ verdict }: { verdict: any }) {
  const good = verdict.state === 'PROTECTED';
  return <section className={`verdict-panel ${good ? 'verdict-good' : 'verdict-risk'}`} aria-live="polite">
    <span className="verdict-stamp" data-verdict={verdict.state}>{good ? 'PROTECTED' : 'AT RISK'}</span><div><h3>{good ? 'Address and tracking checks passed.' : 'Hold the parcel and review the label.'}</h3>
    {verdict.reasons.map((reason: string) => <p key={reason}>{reason}</p>)}
    {(!good && !verdict.addressDifferences?.length) || good ? <p className="verdict-footnote">Postmark checks the two proof-of-delivery requirements in PayPal's Seller Protection policy: an online, verifiable tracking number and a recipient address that matches PayPal Transaction Details. <a href={verdict.policyUrl} target="_blank" rel="noreferrer">Read the current policy.</a></p> : null}</div>
  </section>;
}

function DisputesPage({ disputes, orders }: { disputes: Dispute[]; orders: Order[] }) {
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  return <>
    <div className="page-heading"><div><p className="overline">PayPal Resolution Center</p><h1>Disputes</h1><p>Matched disputes include the shipment proof Postmark already has on file.</p></div></div>
    <section className="disputes-shell">
      {disputes.length ? <ul className="dispute-list">{disputes.map((dispute) => <li key={dispute.id}><a className="dispute-row" href={`/disputes/${encodeURIComponent(dispute.id)}`} onClick={(e) => { e.preventDefault(); nav(`/disputes/${encodeURIComponent(dispute.id)}`); }}><span><strong>{dispute.reason || 'Seller response requested'}</strong><span className="mono">{dispute.id}</span></span><span><StatusBadge status={dispute.status} /><span className="due-date">{dispute.due_at ? new Date(dispute.due_at).toLocaleDateString() : 'No due date returned'}</span></span><span className="dispute-match">{dispute.order_id && orderById.has(dispute.order_id) ? 'Order evidence matched' : 'Add the matching PayPal order to link shipment evidence'}</span></a></li>)}</ul> : <div className="empty-panel"><h2>Your seller dispute queue is clear.</h2><p>Postmark refreshes PayPal’s required-action disputes every 30 seconds.</p></div>}
    </section>
  </>;
}

function DisputePage({ id, setup, setError }: { id: string; setup: { paypalEnv: string }; setError: (value: string) => void }) {
  const [data, setData] = useState<any>(null); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [evidenceRequestKey, setEvidenceRequestKey] = useState(() => crypto.randomUUID());
  const load = useCallback(() => api<any>(`/api/disputes/${encodeURIComponent(id)}`).then(setData).catch((e) => setError(e.message)), [id, setError]);
  useEffect(() => { void load(); }, [load]);
  const draft = async () => { setBusy(true); setError(''); try { const result = await api<{ notes: string }>(`/api/disputes/${encodeURIComponent(id)}/draft`, { method: 'POST' }); setNotes(result.notes); } catch (e) { setError(e instanceof Error ? e.message : 'Draft failed'); } finally { setBusy(false); } };
  const submit = async () => { setBusy(true); setError(''); setMessage(''); const form = new FormData(); form.append('notes', notes); form.append('requestKey', evidenceRequestKey);
    try { const result = await api<{ status: string }>(`/api/disputes/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: form }); setMessage(`PayPal now shows ${result.status}.`); setEvidenceRequestKey(crypto.randomUUID()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Evidence submission failed'); } finally { setBusy(false); }
  };
  const sandbox = async (action: 'require-evidence' | 'adjudicate') => { setBusy(true); setError(''); try { const result = await api<any>(`/api/disputes/${encodeURIComponent(id)}/sandbox/${action}`, { method: 'POST' }); setMessage(`Sandbox dispute status: ${result.dispute.status}`); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Sandbox action failed'); } finally { setBusy(false); } };
  if (!data) return <div className="loading-panel" role="status">Loading dispute from PayPal…</div>;
  const dispute = data.dispute; const order = data.order;
  return <>
    <div className="breadcrumb"><a href="/disputes" onClick={(e) => { e.preventDefault(); nav('/disputes'); }}>Disputes</a><span aria-hidden="true">/</span><span className="mono">{id}</span></div>
    <div className="page-heading"><div><p className="overline">Dispute evidence file</p><h1>{dispute.reason || 'Seller response'}</h1><p className="mono">{dispute.dispute_id}</p></div><StatusBadge status={dispute.status} /></div>
    {message && <p className="success-line" role="status">{message}</p>}
    <div className="dispute-detail-grid">
      <section className="paper-panel evidence-editor"><div className="section-heading"><h2>Seller notes</h2></div><p>Drafts use only saved order and shipping evidence. Review and edit every sentence before submitting.</p><button className="button button-secondary" disabled={busy || !order} onClick={() => void draft()}>{busy ? 'Working…' : 'Draft notes from stored evidence'}</button><label htmlFor="seller-notes">Notes for PayPal</label><textarea id="seller-notes" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /><div className="submit-bar"><span>{notes.length} / 2,000</span><button className="button button-primary" disabled={busy || !notes.trim() || !order?.has_label}>{busy ? 'Submitting…' : 'Submit evidence to PayPal'}</button></div><p className="field-help">The stored label photo is attached with your notes and tracking number.</p></section>
      <aside className="evidence-rail"><div className="section-heading"><h2>Stored evidence</h2></div>{order ? <><div className="evidence-summary"><p><span>Matched order</span><a href={`/orders/${encodeURIComponent(order.id)}`} onClick={(e) => { e.preventDefault(); nav(`/orders/${encodeURIComponent(order.id)}`); }} className="mono">{order.id}</a></p><p><span>Capture ID</span><code>{order.capture_id || 'Not recorded'}</code></p><p><span>Tracking</span><code>{order.carrier || 'Carrier unknown'} · {order.tracking_number || 'Not recorded'}</code></p><p><span>Tracker posted</span><code>{order.tracker_posted_at || 'Not recorded'}</code></p><p><span>Address check</span><StatusBadge status={order.protection_state} /></p></div>{order.has_label && <img className="evidence-photo" src={`/api/labels/${encodeURIComponent(order.id)}`} alt="Shipping label attached to this order" />}</> : <div className="empty-panel"><h3>Link the captured order</h3><p>Add the matching PayPal order ID to connect its shipment evidence.</p></div>}
      {setup.paypalEnv !== 'live' && <div className="sandbox-controls"><p className="overline">Sandbox controls</p><button className="button button-secondary" disabled={busy} onClick={() => void sandbox('require-evidence')}>Sandbox: request seller evidence</button><button className="button button-secondary" disabled={busy} onClick={() => void sandbox('adjudicate')}>Sandbox: adjudicate</button></div>}</aside>
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
