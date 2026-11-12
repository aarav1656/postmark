import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { resetLabelAssessment } from '../server/label-assessment.ts';

describe('replacement label assessment', () => {
  it('clears the previous verdict and tracking before the new label is read', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, tracker_id TEXT, extraction_json TEXT, verdict_json TEXT, tracking_number TEXT, carrier TEXT, protection_state TEXT, updated_at TEXT)');
    db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run('o1', null, '{"old":true}', '{"state":"PROTECTED"}', '9400100000000000000000', 'USPS', 'PROTECTED', 'old');

    expect(resetLabelAssessment(db, 'o1', null)).toBe(true);
    expect(db.prepare('SELECT extraction_json,verdict_json,tracking_number,carrier,protection_state FROM orders WHERE id=?').get('o1')).toEqual({
      extraction_json: null, verdict_json: null, tracking_number: null, carrier: null, protection_state: 'UNSHIPPED',
    });
    db.close();
  });

  it('preserves a posted tracker and refuses replacement of its evidence', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, tracker_id TEXT, extraction_json TEXT, verdict_json TEXT, tracking_number TEXT, carrier TEXT, protection_state TEXT, updated_at TEXT)');
    db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run('o1', 'TRACKER-1', '{"old":true}', '{"state":"PROTECTED"}', '9400100000000000000000', 'USPS', 'TRACKING ON PAYPAL', 'old');

    expect(resetLabelAssessment(db, 'o1', 'TRACKER-1')).toBe(false);
    expect(db.prepare('SELECT extraction_json,verdict_json,tracking_number,carrier,protection_state FROM orders WHERE id=?').get('o1')).toMatchObject({
      extraction_json: '{"old":true}', verdict_json: '{"state":"PROTECTED"}', tracking_number: '9400100000000000000000', carrier: 'USPS', protection_state: 'TRACKING ON PAYPAL',
    });
    db.close();
  });
});
