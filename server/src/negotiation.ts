import Anthropic from '@anthropic-ai/sdk';
import { Intent, CheckEditRequest } from '@lattice/shared';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type NegotiationResolution =
  | { type: 'SEQUENCE'; first: string; second: string; reasoning: string }
  | { type: 'PARALLEL'; reasoning: string }
  | { type: 'MERGE'; combinedApproach: string; reasoning: string }
  | { type: 'ESCALATE'; reasoning: string };

export async function negotiateConflict(
  incomingEdit: CheckEditRequest,
  requesterIntent: Intent,
  conflictingIntents: Intent[]
): Promise<NegotiationResolution> {
  const conflictSummary = conflictingIntents
    .map(i => `- ${i.participantName}: "${i.description}" (files: ${i.fileScope.join(', ')}, functions: ${i.functionScope.join(', ')})`)
    .join('\n');

  const prompt = `You are a code coordination mediator for a team of AI coding agents and developers.

A conflict has been detected. Your job is to propose the best resolution.

INCOMING CHANGE:
- From: participant ${incomingEdit.participantId}
- Intent: "${requesterIntent.description}"
- File: ${incomingEdit.filePath}
- Modified functions: ${(incomingEdit.modifiedFunctions ?? []).join(', ') || 'unknown'}

CONFLICTING ACTIVE WORK:
${conflictSummary}

RESOLUTION OPTIONS:
1. SEQUENCE - One party goes first, the other adapts afterward. Specify who goes first.
2. PARALLEL - The changes don't actually conflict at the semantic level and can both proceed.
3. MERGE - Combine both changes into a single coordinated approach.
4. ESCALATE - Too complex or risky to auto-resolve; a human developer should decide.

Analyze the conflict and respond with ONLY valid JSON in this exact format:
{
  "type": "SEQUENCE" | "PARALLEL" | "MERGE" | "ESCALATE",
  "reasoning": "one sentence explaining your choice",
  "first": "participantId of who should go first (SEQUENCE only)",
  "second": "participantId of who should wait (SEQUENCE only)",
  "combinedApproach": "brief description of merged approach (MERGE only)"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Extract JSON from response (strip any markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed as NegotiationResolution;
  } catch (err) {
    console.error('Negotiation LLM call failed, escalating:', err);
    return {
      type: 'ESCALATE',
      reasoning: 'Automatic negotiation failed. Please resolve manually.',
    };
  }
}
