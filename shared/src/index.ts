import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const ActorType = z.enum(['human', 'agent']);
export const ParticipantStatus = z.enum(['online', 'away', 'offline']);
export const IntentStatus = z.enum(['in_progress', 'complete', 'deferred', 'cancelled']);
export const IntentPriority = z.enum(['blocking', 'normal', 'background']);
export const PatchStatus = z.enum(['pending', 'approved', 'rejected', 'expired']);
export const ConflictVerdict = z.enum(['SAFE', 'REVIEW', 'CONFLICT']);
export const NegotiationEventType = z.enum([
  'intent_created',
  'conflict_detected',
  'patch_staged',
  'patch_approved',
  'patch_rejected',
  'agent_deferred',
  'agent_resumed',
  'negotiation_started',
  'negotiation_resolved',
  'system',
]);

export type ActorType = z.infer<typeof ActorType>;
export type ParticipantStatus = z.infer<typeof ParticipantStatus>;
export type IntentStatus = z.infer<typeof IntentStatus>;
export type IntentPriority = z.infer<typeof IntentPriority>;
export type PatchStatus = z.infer<typeof PatchStatus>;
export type ConflictVerdict = z.infer<typeof ConflictVerdict>;
export type NegotiationEventType = z.infer<typeof NegotiationEventType>;

// ─── Domain Models ────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  repoUrl: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(['active', 'archived']),
});
export type Session = z.infer<typeof SessionSchema>;

export const ParticipantSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  name: z.string().min(1),
  actorType: ActorType,
  status: ParticipantStatus,
  currentTask: z.string().optional(),
  lastSeen: z.string(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const IntentSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
  participantName: z.string(),
  actorType: ActorType,
  description: z.string().min(1),
  filePaths: z.array(z.string()),      // files claimed
  functionNames: z.array(z.string()), // optional function names
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  status: IntentStatus,
  priority: IntentPriority,
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const ShadowPatchSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  intentId: z.string().uuid(),
  proposerId: z.string().uuid(),
  proposerName: z.string(),
  filePath: z.string(),
  diff: z.string(),
  reason: z.string(),
  status: PatchStatus,
  createdAt: z.string(),
  expiresAt: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
});
export type ShadowPatch = z.infer<typeof ShadowPatchSchema>;

export const NegotiationEventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventType: NegotiationEventType,
  actorId: z.string(),   // participant id or 'system' or 'lattice-orchestrator'
  actorName: z.string(),
  targetId: z.string().optional(),   // recipient participant id if directed
  targetName: z.string().optional(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(), // extra structured data
  createdAt: z.string(),
});
export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;

export const SessionStateSchema = z.object({
  session: SessionSchema,
  participants: z.array(ParticipantSchema),
  intents: z.array(IntentSchema),
  patches: z.array(ShadowPatchSchema),
  events: z.array(NegotiationEventSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ─── Conflict Types ───────────────────────────────────────────────────────────

export const ConflictDetailSchema = z.object({
  intentId: z.string(),
  participantName: z.string(),
  actorType: ActorType,
  description: z.string(),
  filePath: z.string(),
  functionNames: z.array(z.string()),
  overlapType: z.enum(['file', 'line_range', 'function']),
});
export type ConflictDetail = z.infer<typeof ConflictDetailSchema>;

export const CheckEditResponseSchema = z.object({
  verdict: ConflictVerdict,
  conflicts: z.array(ConflictDetailSchema),
  message: z.string(),
});
export type CheckEditResponse = z.infer<typeof CheckEditResponseSchema>;

// ─── API Request Schemas (used by server for validation) ──────────────────────

export const CreateSessionRequestSchema = z.object({
  name: z.string().min(1).max(120),
  repoUrl: z.string().url().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const JoinSessionRequestSchema = z.object({
  participantName: z.string().min(1).max(80),
  actorType: ActorType.default('human'),
});
export type JoinSessionRequest = z.infer<typeof JoinSessionRequestSchema>;

export const RegisterIntentRequestSchema = z.object({
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
  description: z.string().min(1).max(500),
  filePaths: z.array(z.string()).min(1),
  functionNames: z.array(z.string()).default([]),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  priority: IntentPriority.default('normal'),
});
export type RegisterIntentRequest = z.infer<typeof RegisterIntentRequestSchema>;

export const CheckEditRequestSchema = z.object({
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
  intentId: z.string().uuid(),
  filePath: z.string().min(1),
  diff: z.string(),
  functionNames: z.array(z.string()).default([]),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
});
export type CheckEditRequest = z.infer<typeof CheckEditRequestSchema>;

export const ProposePatchRequestSchema = z.object({
  sessionId: z.string().uuid(),
  intentId: z.string().uuid(),
  proposerId: z.string().uuid(),
  filePath: z.string().min(1),
  diff: z.string().min(1),
  reason: z.string().min(1),
});
export type ProposePatchRequest = z.infer<typeof ProposePatchRequestSchema>;

export const UpdatePresenceRequestSchema = z.object({
  participantId: z.string().uuid(),
  currentTask: z.string().max(300).optional(),
  status: ParticipantStatus.default('online'),
});
export type UpdatePresenceRequest = z.infer<typeof UpdatePresenceRequestSchema>;

// ─── WebSocket Event Map ──────────────────────────────────────────────────────

export interface ServerToClientEvents {
  'session:state': (state: SessionState) => void;
  'presence:changed': (participant: Participant) => void;
  'intent:added': (intent: Intent) => void;
  'intent:updated': (intent: Intent) => void;
  'conflict:detected': (data: { filePath: string; verdict: CheckEditResponse }) => void;
  'patch:pending': (patch: ShadowPatch) => void;
  'patch:updated': (patch: ShadowPatch) => void;
  'event:added': (event: NegotiationEvent) => void;
  'participant:joined': (participant: Participant) => void;
  'participant:left': (participantId: string) => void;
}

export interface ClientToServerEvents {
  'session:join': (data: { sessionId: string; participantId: string }) => void;
  'presence:update': (data: UpdatePresenceRequest) => void;
  'heartbeat': (data: { participantId: string }) => void;
}
