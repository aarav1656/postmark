import { z } from 'zod';
import type { StoredOrder } from '../domain/dispute.ts';
import { AIOutputError } from './label.ts';

export const DisputeNotesSchema = z.object({ notes: z.string().trim().min(1).max(2000) });
const notesJsonSchema = {
  type: 'object', additionalProperties: false, required: ['notes'],
  properties: { notes: { type: 'string' } },
} as const;

export async function draftDisputeNotes(packet: ReturnType<typeof import('../domain/dispute.ts').assembleEvidencePacket>, dispute: { reason?: string; status: string }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const model = process.env.AI_MODEL || 'google/gemini-2.5-flash';
  const evidence = JSON.stringify({ dispute: { reason: dispute.reason, status: dispute.status }, packet: {
    orderId: packet.orderId, captureId: packet.captureId, tracking: packet.tracking, paypalAddress: packet.paypalAddress,
    extraction: packet.extraction, verdict: packet.verdict, trackerPostedAt: packet.trackerPostedAt, labelStored: Boolean(packet.labelPath),
  } });
  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Postmark' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model, temperature: 0,
        messages: [
          { role: 'system', content: 'Draft concise seller evidence notes using only facts in the supplied JSON. Do not infer delivery, shipment dates, signatures, or buyer behavior. If evidence is absent, say it is not recorded. Output JSON only.' },
          { role: 'user', content: `${evidence}${validationError ? `\nPrevious output validation error: ${validationError}` : ''}` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'seller_evidence_notes', strict: true, schema: notesJsonSchema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
    const raw = (await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    try {
      const result = DisputeNotesSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : null);
      if (result.success) return result.data.notes;
      validationError = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    } catch { validationError = 'response was not valid JSON'; }
  }
  throw new AIOutputError(`Dispute notes failed validation twice: ${validationError}`);
}
