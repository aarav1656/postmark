Claim: On a real Node 24 SQLite database, one guarded update clears the 4 stale label assessment fields before a replacement label is processed, leaving the order UNSHIPPED and unable to reuse an old pass.

Verdict: CONFIRMED for SQLite update semantics. Application route behavior still needs test and live verification.

Measured: 0.015 ms for the update. Command: `node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(":memory:"); db.exec("CREATE TABLE orders(id TEXT PRIMARY KEY, tracker_id TEXT, extraction_json TEXT, verdict_json TEXT, tracking_number TEXT, carrier TEXT, protection_state TEXT)"); db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,?)").run("o1",null,"old extraction","old pass","9400100000000000000000","USPS","PROTECTED"); const stale=db.prepare("SELECT verdict_json, extraction_json FROM orders WHERE id=?").get("o1"); if(!stale.verdict_json || !stale.extraction_json) throw Error("negative setup failed"); const start=performance.now(); db.prepare("UPDATE orders SET extraction_json=NULL, verdict_json=NULL, tracking_number=NULL, carrier=NULL, protection_state=\u0027UNSHIPPED\u0027 WHERE id=? AND tracker_id IS NULL").run("o1"); const elapsed=performance.now()-start; const row=db.prepare("SELECT extraction_json, verdict_json, tracking_number, carrier, protection_state FROM orders WHERE id=?").get("o1"); if(Object.values(row).some(v=>v!==null && v!=="UNSHIPPED")) throw Error(JSON.stringify(row)); console.log(JSON.stringify({negative_case:"old assessment existed and would have remained without reset",positive_case:"4 stale fields cleared; order reset to UNSHIPPED",sqlite_update_ms:+elapsed.toFixed(3),row})); db.close();'`

Negative case: The fixture started with a prior PROTECTED verdict and old extraction/tracking. The untouched state had both old JSON fields present. The guarded reset produced null extraction, verdict, tracking and carrier, plus `UNSHIPPED`.

Caveat: This spike validates the local SQLite mechanism only. It does not call PayPal or OpenRouter; those existing live integrations are not changed by this state reset.

Blocks product: no
