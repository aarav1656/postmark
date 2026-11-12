import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Address = { address_line_1?: string; address_line_2?: string; city?: string; state?: string; postal_code?: string; country_code?: string };
type Order = {
  id: string; capture_id: string | null; status: string; amount_cents: number; currency: string; buyer_name: string | null;
  protection_state: string; address: Address | null; extraction: any; verdict: any; tracker_id: string | null; has_label: boolean;
  tracking_number: string | null; carrier: string | null; tracker_posted_at: string | null;
};
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

function App() {
  const route = useRoute();
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [setup, setSetup] = useState<{ missing: string[]; paypalEnv: string; demoBuyerEmail: string | null }>({ missing: [], paypalEnv: 'sandbox', demoBuyerEmail: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { if (location.pathname === '/') nav('/orders'); document.title = `Postmark: ${route.includes('/disputes') ? 'dispute evidence' : route === '/shop' ? 'PayPal checkout' : route.includes('/orders/') ? 'shipment label check' : 'seller orders'}`; }, [route]);

  useEffect(() => {
    const url = new URL(location.href);
    const token = url.searchParams.get('token');
    if (location.pathname === '/shop' && token && url.searchParams.get('capture') === '1') {
      setBusy(true);
      api<Order>('/api/shop/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: token }) })
        .then((order) => { nav(`/orders/${encodeURIComponent(order.id)}`); void refresh(); })
        .catch((e) => setError(e instanceof Error ? e.message : 'Capture failed'))
        .finally(() => setBusy(false));
    }
  }, [route, refresh]);

  const atRiskCents = orders.filter((order) => order.protection_state === 'AT RISK' || order.protection_state === 'DISPUTED').reduce((sum, order) => sum + order.amount_cents, 0);
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
      {path === '/shop' && <ShopPage busy={busy} setBusy={setBusy} setError={setError} />}
      {path === '/disputes' && <DisputesPage disputes={disputes} orders={orders} />}
      {disputeMatch && <DisputePage id={decodeURIComponent(disputeMatch[1])} setup={setup} setError={setError} />}
      {orderMatch && <OrderPage id={decodeURIComponent(orderMatch[1])} order={selectedOrder} setup={setup} setError={setError} refresh={refresh} />}
      {path === '/orders' && <OrdersPage orders={orders} disputes={disputes} atRiskCents={atRiskCents} />}
      {!['/shop', '/orders', '/disputes'].includes(path) && !orderMatch && !disputeMatch && <OrdersPage orders={orders} disputes={disputes} atRiskCents={atRiskCents} />}
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

function OrdersPage({ orders, disputes, atRiskCents }: { orders: Order[]; disputes: Dispute[]; atRiskCents: number }) {
  const [orderId, setOrderId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const importOrder = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const order = await api<Order>('/api/orders/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) }); nav(`/orders/${encodeURIComponent(order.id)}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Order could not be imported'); }
    finally { setBusy(false); }
  };
  const sorted = [...orders].sort((a, b) => rankState(a.protection_state) - rankState(b.protection_state));
  const urgent = sorted.find((order) => ['AT RISK', 'DISPUTED', 'UNSHIPPED'].includes(order.protection_state));
  return <>
    <div className="page-heading"><div><p className="overline">Seller desk</p><h1>Orders</h1><p>Check the shipping address before tracking reaches PayPal.</p></div><button className="button button-primary" onClick={() => nav('/shop')}>Sell an item</button></div>
    <section className="summary-strip" aria-label="Order summary">
      <div className="summary-item"><span>Orders in desk</span><strong className="summary-number">{orders.length}</strong></div>
      <div className="summary-item"><span>Amount needing attention</span><strong className="summary-number mono">{money(atRiskCents)}</strong></div>
      <div className="summary-item"><span>Disputes to review</span><strong className="summary-number">{disputes.length}</strong></div>
    </section>
    <div className="desk-grid">
      <section className="workbench">
        <div className="section-heading"><h2>{urgent ? 'Next parcel to check' : 'Shipping workbench'}</h2><span className="section-rule"></span></div>
        {urgent ? <UrgentOrder order={urgent} /> : orders.length ? <div className="quiet-panel"><p className="stamp stamp-neutral">READY</p><h3>Every order is in the ledger.</h3><p>Open an order to add a label photo and run the address check before tracking.</p></div> : <div className="empty-panel"><div className="empty-mark" aria-hidden="true">P</div><h3>Your order desk is clear.</h3><p>Bring in a PayPal order or create a checkout link to start a shipment.</p><div className="button-row"><button className="button button-primary" onClick={() => nav('/shop')}>Sell an item</button><a className="button button-secondary" href="#import-order" onClick={(e) => { e.preventDefault(); document.getElementById('paypal-order-id')?.focus(); }}>Add PayPal order</a></div></div>}
        <form className="import-form" id="import-order" onSubmit={importOrder}>
          <div><label htmlFor="paypal-order-id">Add an existing PayPal order</label><p className="field-help">The order and its shipping address will be read from PayPal.</p></div>
          <div className="inline-form"><input id="paypal-order-id" value={orderId} onChange={(e) => setOrderId(e.target.value)} required aria-describedby="import-error" /><button className="button button-secondary" disabled={busy}>{busy ? 'Reading…' : 'Add order'}</button></div>
          {error && <p className="field-error" id="import-error" role="alert">{error}</p>}
        </form>
      </section>
      <aside className="order-rail">
        <div className="section-heading"><h2>Order ledger</h2><span className="rail-total">{orders.length}</span></div>
        {orders.length ? <ul className="order-list">{sorted.map((order) => <li key={order.id}><OrderRow order={order} /></li>)}</ul> : <p className="rail-empty">Imported PayPal orders appear here with their amount and shipping state.</p>}
      </aside>
    </div>
  </>;
}

function rankState(state: string) { return ({ 'AT RISK': 0, DISPUTED: 1, UNSHIPPED: 2, PROTECTED: 3, 'TRACKING ON PAYPAL': 4, 'EVIDENCE SUBMITTED': 5, RESOLVED: 6 } as Record<string, number>)[state] ?? 7; }
function StatusBadge({ status }: { status: string }) { const kind = status === 'PROTECTED' || status === 'TRACKING ON PAYPAL' || status === 'EVIDENCE SUBMITTED' || status === 'RESOLVED' ? 'good' : status === 'AT RISK' || status === 'DISPUTED' ? 'bad' : 'neutral'; return <span className={`status-badge ${kind}`}>{status}</span>; }
function OrderRow({ order }: { order: Order }) { return <a className="order-row" href={`/orders/${encodeURIComponent(order.id)}`} onClick={(e) => { e.preventDefault(); nav(`/orders/${encodeURIComponent(order.id)}`); }}>
  <span className="order-row-main"><strong>{order.buyer_name || order.id}</strong><span className="order-id mono">{order.id}</span></span><span className="order-row-side"><span className="amount mono">{money(order.amount_cents, order.currency)}</span><StatusBadge status={order.protection_state} /></span>
</a>; }
function UrgentOrder({ order }: { order: Order }) { return <a className="urgent-order" href={`/orders/${encodeURIComponent(order.id)}`} onClick={(e) => { e.preventDefault(); nav(`/orders/${encodeURIComponent(order.id)}`); }}>
  <div className="urgent-order-head"><StatusBadge status={order.protection_state} /><span className="amount mono">{money(order.amount_cents, order.currency)}</span></div><h3>{order.buyer_name || 'PayPal order'}</h3><p className="mono">{order.id}</p><p>{order.address ? fullAddress(order.address) : 'Shipping address is added when PayPal capture completes.'}</p><span className="text-link">Open order <span aria-hidden="true">→</span></span>
</a>; }

function ShopPage({ busy, setBusy, setError }: { busy: boolean; setBusy: (value: boolean) => void; setError: (value: string) => void }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [approvalUrl, setApprovalUrl] = useState(''); const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ approvalUrl: string }>('/api/shop/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price, requestKey }) });
      if (!result.approvalUrl) throw new Error('PayPal did not return an approval link.'); setApprovalUrl(result.approvalUrl); setRequestKey(crypto.randomUUID());
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not be created'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="page-heading"><div><p className="overline">PayPal checkout</p><h1>Sell an item</h1><p>Create a PayPal checkout, then bring the captured shipment into the desk.</p></div></div>
    <div className="shop-layout">
      <form className="paper-panel shop-form" onSubmit={create}>
        <h2>Item for sale</h2><label htmlFor="item-name">Item name</label><input id="item-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        <label htmlFor="item-price">Price in USD</label><div className="money-input"><span aria-hidden="true">$</span><input id="item-price" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={price} onChange={(e) => setPrice(e.target.value)} required /></div>
        <p className="field-help">PayPal collects the buyer’s shipping address during checkout.</p>
        <button className="button button-primary" disabled={busy}>{busy ? 'Creating checkout…' : 'Continue with PayPal'}</button>
        {approvalUrl && <div className="approval-card"><p className="overline">PayPal approval</p><p>Open PayPal to approve the order. Postmark will capture it when PayPal returns you here.</p><a className="button button-secondary" href={approvalUrl}>Open PayPal checkout</a></div>}
      </form>
      <aside className="shop-note"><p className="overline">What happens next</p><h2>Capture first. Check the label before tracking.</h2><ol><li>PayPal collects the buyer’s delivery address.</li><li>Postmark stores the captured order and amount.</li><li>Upload the printed label before adding tracking.</li></ol><p className="policy-note">The address check is a preflight aid. Seller Protection also has other requirements. <a href="https://www.paypal.com/us/legalhub/paypal/seller-protection?locale.x=en_US" target="_blank" rel="noreferrer">Read PayPal’s policy.</a></p></aside>
    </div>
  </>;
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
    try { const result = await api<{ order: Order; trackerId: string }> (`/api/orders/${encodeURIComponent(id)}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptRisk }) }); setOrder(result.order); setNotice(`Tracker ${result.trackerId} is on PayPal.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Tracking was not posted'); }
    finally { setBusy(false); }
  };
  if (!order) return <div className="loading-panel" role="status">Loading PayPal order…</div>;
  const address = order.address;
  const protectedPass = order.verdict?.state === 'PROTECTED';
  return <>
    <div className="breadcrumb"><a href="/orders" onClick={(e) => { e.preventDefault(); nav('/orders'); }}>Orders</a><span aria-hidden="true">/</span><span className="mono">{order.id}</span></div>
    <div className="page-heading"><div><p className="overline">Shipment file</p><h1>{order.buyer_name || 'PayPal order'}</h1><p className="mono">{order.id} <span className="copy-divider">·</span> {money(order.amount_cents, order.currency)}</p></div><StatusBadge status={order.protection_state} /></div>
    {notice && <p className="success-line" role="status">{notice}</p>}
    <div className="order-detail-grid">
      <section className="workbench">
        <div className="section-heading"><h2>Label preflight</h2><span className="section-rule"></span></div>
        <form className="upload-panel" onSubmit={runLabel}>
          <label htmlFor="label-photo" className="upload-title">Photograph the printed label</label>
          <p className="field-help">The photo is read for recipient, address, carrier, and tracking. Use a clear, flat image.</p>
          <div className="file-controls"><input id="label-photo" type="file" accept="image/jpeg,image/png" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required={!order.extraction} /><button className="button button-primary" disabled={busy || !file}>{busy ? 'Reading label…' : 'Check label'}</button></div>
        </form>
        {order.has_label && <figure className="label-figure"><img src={`/api/labels/${encodeURIComponent(order.id)}`} alt="Stored shipping label photo" />{order.extraction?.field_boxes && <div className="field-overlay" aria-label="AI-highlighted label fields">{Object.entries(order.extraction.field_boxes).map(([field, box]: [string, any]) => <span key={field} title={field.replaceAll('_', ' ')} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}><i>{field.replaceAll('_', ' ')}</i></span>)}</div>}<figcaption>Stored label evidence. Highlighted boxes show fields read by AI.</figcaption></figure>}
        {order.extraction && <div className="extraction-card"><div className="extraction-heading"><h3>What the label says</h3><span>{Math.round(order.extraction.confidence * 100)}% read confidence</span></div>
          <div className="extraction-fields"><div><span>Carrier</span><strong>{order.extraction.carrier}{order.extraction.service ? ` · ${order.extraction.service}` : ''}</strong></div><div><span>Tracking number</span><strong className="mono">{order.extraction.tracking_number}</strong></div><div><span>Recipient</span><strong>{order.extraction.recipient_name || 'Unreadable on this label' }</strong></div><div><span>Address from label</span><strong>{fullAddress({ address_line_1: order.extraction.address_line_1, address_line_2: order.extraction.address_line_2, city: order.extraction.city, state: order.extraction.state, postal_code: order.extraction.postal_code, country_code: order.extraction.country })}</strong></div></div>
          <p className="field-help">Signature confirmation visible: {order.extraction.signature_confirmation_visible ? 'Yes' : 'No'}</p>
        </div>}
        {order.verdict && <VerdictPanel verdict={order.verdict} />}
      </section>
      <aside className="address-rail">
        <div className="section-heading"><h2>PayPal order address</h2></div>
        <div className="address-stock"><p className="address-label">Ship to</p><strong>{order.buyer_name || order.id}</strong><address>{addressLines(address).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</address><span className="address-source">Read from PayPal Transaction Details</span></div>
        {order.verdict?.addressDifferences?.length > 0 && <div className="redline-panel"><h3>Address fields differ</h3><ul>{order.verdict.addressDifferences.map((diff: any) => <li key={diff.field}><strong>{diff.field}</strong><span>PayPal: {diff.paypal}</span><span>Label: {diff.label}</span></li>)}</ul><p>The shipping address must match the address on PayPal Transaction Details.</p><a href={order.verdict.policyUrl} target="_blank" rel="noreferrer">Seller Protection policy</a></div>}
        {setup.paypalEnv !== 'live' && address && <div className="sandbox-card"><p className="overline">Sandbox only</p><h3>Print a test label</h3><p>Uses this PayPal address with a clearly marked test tracking number.</p><div className="stack-buttons"><a className="button button-secondary" href={`/api/orders/${encodeURIComponent(order.id)}/sandbox-label`}>Print matching label</a><a className="quiet-link" href={`/api/orders/${encodeURIComponent(order.id)}/sandbox-label?wrongUnit=1`}>Print label with a wrong unit</a></div></div>}
        {order.extraction && <div className="tracking-action"><button className="button button-primary" disabled={busy || (!protectedPass && !acceptRisk)} onClick={() => void postTracking()}>{busy ? 'Checking PayPal…' : 'Post tracking to PayPal'}</button>
          {!protectedPass && <label className="risk-override"><input type="checkbox" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />Ship anyway, I accept the risk</label>}
          <p className="field-help">The app checks that the tracker appears on the PayPal order before showing it as posted.</p>
        </div>}
        {order.tracker_id && <div className="tracker-receipt"><span className="receipt-check" aria-hidden="true">✓</span><div><strong>Tracking is on PayPal</strong><span className="mono">{order.tracker_id}</span><time>{order.tracker_posted_at}</time></div></div>}
      </aside>
    </div>
  </>;
}

function VerdictPanel({ verdict }: { verdict: any }) {
  const good = verdict.state === 'PROTECTED';
  return <section className={`verdict-panel ${good ? 'verdict-good' : 'verdict-risk'}`} aria-live="polite">
    <span className="stamp">{good ? 'PROTECTED' : 'AT RISK'}</span><div><h3>{good ? 'Address and tracking checks passed.' : 'Hold the parcel and review the label.'}</h3>
    {verdict.reasons.map((reason: string) => <p key={reason}>{reason}</p>)}
    <p className="verdict-footnote">Seller Protection eligibility also depends on transaction, shipment, and delivery requirements. Review PayPal’s full policy. <a href={verdict.policyUrl} target="_blank" rel="noreferrer">Read the current policy.</a></p></div>
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

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
