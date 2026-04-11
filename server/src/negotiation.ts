import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Intent, CheckEditRequest, ConflictDetail } from '@lattice/shared';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Timeout for demo safety (live demo must not hang) ─────────────────────────
const NEGOTIATION_TIMEOUT_MS = Number(process.env.NEGOTIATION_TIMEOUT_MS ?? 8000);

export type NegotiationResolution =
  | { type: 'SEQUENCE'; first: string; second: string; reasoning: string }
  | { type: 'PARALLEL'; reasoning: string }
  | { type: 'MERGE'; combinedApproach: string; reasoning: string }
  | { type: 'ESCALATE'; reasoning: string };

// ── Zod schema for structured output validation ───────────────────────────────
const NegotiationResolutionSchema = z.union([
  z.object({
    type: z.literal('SEQUENCE'),
    first: z.string().min(1),
    second: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal('PARALLEL'),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal('MERGE'),
    combinedApproach: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal('ESCALATE'),
    reasoning: z.string(),
  }),
]);

export async function negotiateConflict(
  incomingEdit: CheckEditRequest,
  requesterIntent: Intent,
  conflicts: ConflictDetail[],
): Promise<NegotiationResolution> {
  const conflictSummary = conflicts
    .map(c =>
      `- ${c.participantName} (${c.actorType}): "${c.description}" ` +
      `[${c.overlapType} overlap on ${c.filePath}` +
      (c.functionNames.length ? `, functions: ${c.functionNames.join(', ')}` : '') +
      `]`,
    )
    .join('\n');

  const prompt = `You are a code coordination mediator for a team of AI coding agents and human developers.

A conflict has been detected. Propose the best resolution.

INCOMING CHANGE:
- Participant: ${requesterIntent.participantName} (${requesterIntent.actorType})
- Intent: "${requesterIntent.description}"
- File: ${incomingEdit.filePath}
- Functions modified: ${(incomingEdit.functionNames ?? []).join(', ') || 'unknown'}

CONFLICTING ACTIVE WORK:
${conflictSummary}

RESOLUTION OPTIONS:
1. SEQUENCE — one party goes first, the other adapts. Specify who goes first by participantName.
2. PARALLEL — changes don't actually conflict semantically; both can proceed.
3. MERGE — combine both changes into a single coordinated approach.
4. ESCALATE — too complex or risky; a human developer should decide.

Respond with ONLY valid JSON:
{
  "type": "SEQUENCE" | "PARALLEL" | "MERGE" | "ESCALATE",
  "reasoning": "one sentence",
  "first": "participantName who goes first (SEQUENCE only)",
  "second": "participantName who waits (SEQUENCE only)",
  "combinedApproach": "merged approach description (MERGE only)"
}`;

  try {
    // Race the API call against a hard timeout so a slow/hung LLM never stalls the demo
    const response = await Promise.race([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Negotiation timed out after ${NEGOTIATION_TIMEOUT_MS}ms`)),
          NEGOTIATION_TIMEOUT_MS,
        ),
      ),
    ]);

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate against schema — reject malformed responses rather than trusting them
    const result = NegotiationResolutionSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('Negotiation response failed Zod validation:', result.error.issues);
      throw new Error('LLM returned invalid resolution structure');
    }

    return result.data as NegotiationResolution;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error('Negotiation LLM call failed, escalating:', msg);
    return {
      type: 'ESCALATE',
      reasoning: `Automatic negotiation failed (${msg}). Please resolve manually.`,
    };
  }
}
