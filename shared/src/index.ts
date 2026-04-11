// ─── Core Domain Types ────────────────────────────────────────────────────────

export type ParticipantStatus = 'online' | 'away' | 'offline';
export type IntentStatus = 'in_progress' | 'complete' | 'deferred' | 'cancelled';
export type IntentPriority = 'blocking' | 'normal' | 'background';
export type PatchStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ConflictVerdict = 'SAFE' | 'REVIEW' | 'CONFLICT';

export interface Participant {
  id: string;
  sessionId: string;
  name: string;
  agentType?: 'claude-code' | 'cursor' | 'codex' | 'human';
  status: ParticipantStatus;
  currentTask?: string;
  lastSeen: string; // ISO timestamp
}

export interface Intent {
  id: string;
  sessionId: string;
  participantId: string;
  participantName: string;
  description: string;
  fileScope: string[];       // file paths claimed
  functionScope: string[];   // function names claimed
  status: IntentStatus;
  priority: IntentPriority;
  createdAt: string;
  completedAt?: string;
}

export interface ShadowPatch {
  id: string;
  sessionId: string;
  intentId: string;
  proposerId: string;
  proposerName: string;
  filePath: string;
  diff: string;
  reason: string;
  status: PatchStatus;
  createdAt: string;
  expiresAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface NegotiationMessage {
  id: string;
  sessionId: string;
  fromParticipantId: string;
  toParticipantId: string;
  message: string;
  messageType: 'proposal' | 'response' | 'escalation' | 'resolution';
  createdAt: string;
}

export interface Session {
  id: string;
  name: string;
  repoUrl?: string;
  createdAt: string;
  status: 'active' | 'archived';
}

export interface SessionState {
  session: Session;
  participants: Participant[];
  intents: Intent[];
  patches: ShadowPatch[];
  negotiationLog: NegotiationMessage[];
}

// ─── API Request / Response Types ────────────────────────────────────────────

export interface CreateSessionRequest {
  name: string;
  repoUrl?: string;
}

export interface JoinSessionRequest {
  sessionId: string;
  participantName: string;
  agentType?: Participant['agentType'];
}

export interface RegisterIntentRequest {
  sessionId: string;
  participantId: string;
  description: string;
  fileScope: string[];
  functionScope: string[];
  priority?: IntentPriority;
}

export interface CheckEditRequest {
  sessionId: string;
  participantId: string;
  intentId: string;
  filePath: string;
  diff: string;
  modifiedFunctions?: string[];
}

export interface CheckEditResponse {
  verdict: ConflictVerdict;
  conflictingIntents: Intent[];
  message: string;
}

export interface ProposePatchRequest {
  sessionId: string;
  intentId: string;
  proposerId: string;
  filePath: string;
  diff: string;
  reason: string;
}

// ─── WebSocket Event Types ────────────────────────────────────────────────────

export interface ServerToClientEvents {
  'session:state': (state: SessionState) => void;
  'presence:changed': (participant: Participant) => void;
  'intent:added': (intent: Intent) => void;
  'intent:updated': (intent: Intent) => void;
  'conflict:detected': (data: { edit: CheckEditRequest; verdict: CheckEditResponse }) => void;
  'patch:pending': (patch: ShadowPatch) => void;
  'patch:updated': (patch: ShadowPatch) => void;
  'negotiation:message': (msg: NegotiationMessage) => void;
  'participant:joined': (participant: Participant) => void;
  'participant:left': (participantId: string) => void;
}

export interface ClientToServerEvents {
  'session:join': (data: { sessionId: string; participantId: string }) => void;
  'presence:update': (data: { participantId: string; currentTask: string; status: ParticipantStatus }) => void;
}
