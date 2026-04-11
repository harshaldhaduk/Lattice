import { io, Socket } from 'socket.io-client';
import {
  Session, Participant, Intent, ShadowPatch, NegotiationMessage,
  SessionState, CheckEditResponse, ServerToClientEvents, ClientToServerEvents,
} from '@lattice/shared';

type EventCallback<T> = (data: T) => void;

export class LatticeClient {
  public sessionId?: string;
  public participantId?: string;
  public participantName?: string;

  private socket?: Socket<ServerToClientEvents, ClientToServerEvents>;
  private serverUrl: string;
  private state?: SessionState;

  // Event listeners
  private onStateChange?: EventCallback<SessionState>;
  private onConflict?: EventCallback<{ edit: any; verdict: CheckEditResponse }>;
  private onNegotiation?: EventCallback<NegotiationMessage>;
  private onPatch?: EventCallback<ShadowPatch>;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  isConnected(): boolean {
    return !!(this.sessionId && this.participantId && this.socket?.connected);
  }

  getState(): SessionState | undefined {
    return this.state;
  }

  // ── Session Lifecycle ──────────────────────────────────────────────────────

  async createAndJoinSession(name: string, participantName: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const session: Session = await res.json();
    await this.joinSession(session.id, participantName);
  }

  async joinSession(sessionId: string, participantName: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, participantName }),
    });
    const participant: Participant = await res.json();

    this.sessionId = sessionId;
    this.participantId = participant.id;
    this.participantName = participantName;

    this.connectSocket();
    await this.syncState();
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.sessionId = undefined;
    this.participantId = undefined;
    this.state = undefined;
  }

  // ── Intents ────────────────────────────────────────────────────────────────

  async registerIntent(description: string, fileScope: string[], functionScope: string[]): Promise<Intent> {
    const res = await fetch(`${this.serverUrl}/api/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        participantId: this.participantId,
        description,
        fileScope,
        functionScope,
      }),
    });
    const intent: Intent = await res.json();
    await this.syncState();
    return intent;
  }

  // ── Edit Checks ────────────────────────────────────────────────────────────

  async checkEdit(intentId: string, filePath: string, diff: string, modifiedFunctions?: string[]): Promise<CheckEditResponse> {
    const res = await fetch(`${this.serverUrl}/api/edits/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        participantId: this.participantId,
        intentId,
        filePath,
        diff,
        modifiedFunctions,
      }),
    });
    return res.json();
  }

  // ── Patches ────────────────────────────────────────────────────────────────

  async proposePatch(intentId: string, filePath: string, diff: string, reason: string): Promise<ShadowPatch> {
    const res = await fetch(`${this.serverUrl}/api/patches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        intentId,
        proposerId: this.participantId,
        filePath,
        diff,
        reason,
      }),
    });
    return res.json();
  }

  async approvePatch(patchId: string): Promise<void> {
    await fetch(`${this.serverUrl}/api/patches/${patchId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: this.participantId }),
    });
    await this.syncState();
  }

  async rejectPatch(patchId: string): Promise<void> {
    await fetch(`${this.serverUrl}/api/patches/${patchId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: this.participantId }),
    });
    await this.syncState();
  }

  // ── Event Subscriptions ────────────────────────────────────────────────────

  onStateUpdate(cb: EventCallback<SessionState>) { this.onStateChange = cb; }
  onConflictDetected(cb: EventCallback<{ edit: any; verdict: CheckEditResponse }>) { this.onConflict = cb; }
  onNegotiationMessage(cb: EventCallback<NegotiationMessage>) { this.onNegotiation = cb; }
  onPatchPending(cb: EventCallback<ShadowPatch>) { this.onPatch = cb; }

  // ── Private ────────────────────────────────────────────────────────────────

  private connectSocket(): void {
    this.socket = io(this.serverUrl);

    this.socket.on('connect', () => {
      this.socket!.emit('session:join', {
        sessionId: this.sessionId!,
        participantId: this.participantId!,
      });
    });

    this.socket.on('session:state', (state) => {
      this.state = state;
      this.onStateChange?.(state);
    });

    this.socket.on('conflict:detected', (data) => {
      this.onConflict?.(data);
    });

    this.socket.on('negotiation:message', (msg) => {
      this.syncState();
      this.onNegotiation?.(msg);
    });

    this.socket.on('patch:pending', (patch) => {
      this.syncState();
      this.onPatch?.(patch);
    });

    this.socket.on('intent:added', () => this.syncState());
    this.socket.on('intent:updated', () => this.syncState());
    this.socket.on('participant:joined', () => this.syncState());
    this.socket.on('presence:changed', () => this.syncState());
    this.socket.on('patch:updated', () => this.syncState());
  }

  private async syncState(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/sessions/${this.sessionId}/state`);
      if (res.ok) {
        this.state = await res.json();
        if (this.state) this.onStateChange?.(this.state);
      }
    } catch { /* server may not be ready yet */ }
  }
}
