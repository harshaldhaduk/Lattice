import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Intent, CheckEditRequest, ConflictDetail } from '@lattice/shared';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** How long (ms) to wait for a negotiation LLM response before escalating. */
const NEGOTIATION_TIMEOUT_MS = 8_000;

// ── Zod schema for structured output parsing ──────────────────────────────────

const SequenceSchema = z.object({
  type: z.literal('SEQUENCE'),
  first: z.string().min(1),
  second: z.string().min(1),
  reasoning: z.string().min(1),
});

const ParallelSchema = z.object({
  type: z.literal('PARALLEL'),
  reasoning: z.string().min(1),
});

const MergeSchema = z.object({
  type: z.literal('MERGE'),
  combinedApproach: z.string().min(1),
  reasoning: z.string().min(1),
});

const EscalateSchema = z.object({
  type: z.literal('ESCALATE'),
  reasoning: z.string().min(1),
});

const NegotiationResponseSchema = z.discriminatedUnion('type', [
  SequenceSchema,
  ParallelSchema,
  MergeSchema,
  EscalateSchema,
]);

export type NegotiationResolution = z.infer<typeof NegotiationResponseSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. Rejects with an Error if the timeout
 * fires before the promise resolves.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

/**
 * Parse the LLM's response text into a validated NegotiationResolution.
 * Throws a ZodError if the JSON is present but malformed, or a plain Error
 * if no JSON object can be found at all.
 */
function parseNegotiationResponse(text: string): NegotiationResolution {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in LLM response');
  }
  const raw = JSON.parse(jsonMatch[0]);
  return NegotiationResponseSchema.parse(raw);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Asks Claude to propose a resolution for a detected code conflict.
 *
 * Returns one of four verdicts:
 *  - SEQUENCE  — one participant should finish before the other starts
 *  - PARALLEL  — the changes are semantically independent; both can proceed
 *  - MERGE     — both changes should be combined into a single coordinated edit
 *  - ESCALATE  — conflict is too complex; a human should decide
 *
 * Always returns a valid NegotiationResolution: failures are caught and
 * converted to an ESCALATE resolution rather than propagated to callers.
 */
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

Respond with ONLY valid JSON matching one of these exact shapes:
{"type":"SEQUENCE","first":"<participantName>","second":"<participantName>","reasoning":"<one sentence>"}
{"type":"PARALLEL","reasoning":"<one sentence>"}
{"type":"MERGE","combinedApproach":"<description>","reasoning":"<one sentence>"}
{"type":"ESCALATE","reasoning":"<one sentence>"}`;

  try {
    const apiCall = anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const response = await withTimeout(apiCall, NEGOTIATION_TIMEOUT_MS, 'Negotiation LLM call');
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return parseNegotiationResponse(text);
  } catch (err) {
    console.error('Negotiation failed, escalating:', err instanceof Error ? err.message : err);
    return {
      type: 'ESCALATE',
      reasoning: 'Automatic negotiation unavailable. Please resolve manually.',
    };
  }
}
