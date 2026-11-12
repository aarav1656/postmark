export const SCHEMA = `
CREATE TABLE IF NOT EXISTS paypal_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  entity_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  capture_id TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  buyer_name TEXT,
  address_json TEXT,
  tracking_number TEXT,
  carrier TEXT,
  tracker_id TEXT,
  protection_state TEXT NOT NULL,
  label_path TEXT,
  extraction_json TEXT,
  verdict_json TEXT,
  tracker_posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  capture_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  due_at TEXT,
  details_json TEXT NOT NULL,
  evidence_notes TEXT,
  evidence_submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(protection_state);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);
`;
