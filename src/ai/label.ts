import { z } from 'zod';

export const LabelSchema = z.object({
  carrier: z.enum(['USPS', 'UPS', 'FEDEX', 'DHL', 'OTHER']),
  service: z.string().nullable(),
  tracking_number: z.string().min(1),
  recipient_name: z.string().nullable(),
  address_line_1: z.string().min(1),
  address_line_2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.string().nullable(),
  signature_confirmation_visible: z.boolean(),
  confidence: z.number().min(0).max(1),
  field_boxes: z.record(z.string(), z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])).nullable(),
});
export type LabelExtraction = z.infer<typeof LabelSchema>;

const labelJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['carrier','service','tracking_number','recipient_name','address_line_1','address_line_2','city','state','postal_code','country','signature_confirmation_visible','confidence','field_boxes'],
  properties: {
    carrier: { type: 'string', enum: ['USPS','UPS','FEDEX','DHL','OTHER'] },
    service: { type: ['string','null'] }, tracking_number: { type: 'string' }, recipient_name: { type: ['string','null'] },
    address_line_1: { type: 'string' }, address_line_2: { type: ['string','null'] }, city: { type: ['string','null'] },
    state: { type: ['string','null'] }, postal_code: { type: ['string','null'] }, country: { type: ['string','null'] },
    signature_confirmation_visible: { type: 'boolean' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    field_boxes: { anyOf: [{ type: 'object', additionalProperties: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 } } }, { type: 'null' }] },
  },
} as const;

export class AIOutputError extends Error {
  constructor(message: string) { super(message); this.name = 'AIOutputError'; }
}

function extractContent(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AIOutputError('OpenRouter returned no JSON content');
  return content;
}

async function request(prompt: string, image: string, model: string, apiKey: string) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Postmark' },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 1200,
      messages: [
        { role: 'system', content: 'Read only information visibly printed on this shipping label. Never infer, complete, or guess missing text. Return null for unreadable optional fields. Return tracking number exactly as printed.' },
        { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'shipping_label', strict: true, schema: labelJsonSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
  return extractContent(await response.json());
}

export async function extractLabel(bytes: Uint8Array, mimeType: string): Promise<LabelExtraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const model = process.env.AI_MODEL || 'google/gemini-2.5-flash';
  const image = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  const prompt = 'Extract the carrier, service, tracking number, addressee, complete printed address and whether signature confirmation is visibly marked. Include normalized bounding boxes [x,y,width,height] as image fractions only when boxes can be identified. Every value must be visible on the image.';
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await request(attempt ? `${prompt}\nPrevious response failed validation: ${lastError}. Correct the JSON and do not infer missing values.` : prompt, image, model, apiKey);
      const parsed = LabelSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    } catch (error) {
      if (attempt === 1) throw error;
      lastError = error instanceof Error ? error.message : 'invalid model output';
    }
  }
  throw new AIOutputError(`Label extraction failed validation twice: ${lastError}`);
}

export const labelJsonSchemaForTest = labelJsonSchema;
