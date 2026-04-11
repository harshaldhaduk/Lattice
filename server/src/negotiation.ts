import Anthropic from '@anthropic-ai/sdk';
import { Intent, CheckEditRequest, ConflictDetail } from '@lattice/shared';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type NegotiationResolution =
  | { type: 'SEQUENCE'; first: string; second: string; reasoning: string }
  | { type: 'PARALLEL'; reasoning: string }
  | { type: 'MERGE'; combinedApproach: string; reasoning: string }
  | { type: 'ESCALATE'; reasoning: string };

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
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    return JSON.parse(jsonMatch[0]) as NegotiationResolution;
  } catch (err) {
    console.error('Negotiation LLM call failed, escalating:', err);
    return {
      type: 'ESCALATE',
      reasoning: 'Automatic negotiation failed. Please resolve manually.',
    };
  }
}
