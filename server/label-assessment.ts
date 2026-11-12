import type { DatabaseSync } from 'node:sqlite';

export function resetLabelAssessment(db: DatabaseSync, orderId: string, trackerId: string | null) {
  if (trackerId) return false;
  const result = db.prepare(`UPDATE orders SET extraction_json=NULL,verdict_json=NULL,tracking_number=NULL,carrier=NULL,
    protection_state='UNSHIPPED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND tracker_id IS NULL`).run(orderId);
  return result.changes === 1;
}
