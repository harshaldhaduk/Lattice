import { io, Socket } from 'socket.io-client';
import {
  Session,
  Participant,
  Intent,
  ShadowPatch,
  NegotiationEvent,
  SessionState,
  CheckEditResponse,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@lattice/shared';

type EventCallback<T> = (data: T) => void;

export class LatticeClient {
  public sessionId?: string;
  public participantId?: string;
  public participantName?: string;
  public repoPath = '';

  private socket?: Socket<ServerToClientEvents, ClientToServerEvents>;
  private serverUrl: string;
  private state?: SessionState;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  // Event listeners
  private onStateChange?: EventCallback<SessionState>;
  private onConflict?: EventCallback<{ filePath: string; verdict: CheckEditResponse }>;
  private onEventAdded?: EventCallback<NegotiationEvent>;
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

  async createAndJoinSession(name: string, participantName: string, actorType: 'human' | 'agent' = 'human'): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await res.text());
    const session = (await res.json()) as Session;
    await this.joinSession(session.id, participantName, actorType);
  }

  async joinSession(sessionId: string, participantName: string, actorType: 'human' | 'agent' = 'human'): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantName, actorType }),
    });
    if (!res.ok) throw new Error(await res.text());
    const participant = (await res.json()) as Participant;

    this.sessionId = sessionId;
    this.participantId = participant.id;
    this.participantName = participantName;

    this.connectSocket();
    await this.syncState();
    this.startHeartbeat();
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.sessionId = undefined;
    this.participantId = undefined;
    this.state = undefined;
  }

  // ── Intents ────────────────────────────────────────────────────────────────

  async registerIntent(
    description: string,
    filePaths: string[],
    functionNames: string[],
    options?: { startLine?: number; endLine?: number; priority?: 'blocking' | 'normal' | 'background' },
  ): Promise<Intent> {
    const res = await fetch(`${this.serverUrl}/api/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        participantId: this.participantId,
        description,
        filePaths,
        functionNames,
        startLine: options?.startLine,
        endLine: options?.endLine,
        priority: options?.priority ?? 'normal',
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const intent = (await res.json()) as Intent;
    await this.syncState();
    return intent;
  }

  async completeIntent(intentId: string): Promise<void> {
    await fetch(`${this.serverUrl}/api/intents/${intentId}/complete`, { method: 'PATCH' });
    await this.syncState();
  }

  // ── AI Planning ────────────────────────────────────────────────────────────

  async planWork(prompt: string, autoRegister = false): Promise<{ specs: any[]; registered: any[] }> {
    const res = await fetch(`${this.serverUrl}/api/sessions/${this.sessionId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, participantId: this.participantId, autoRegister }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { specs: any[]; registered: any[] };
    if (autoRegister) await this.syncState();
    return data;
  }

  async executePlan(specs: any[], repoPath: string): Promise<{ message: string }> {
    const res = await fetch(`${this.serverUrl}/api/sessions/${this.sessionId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specs, repoPath, participantId: this.participantId }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ message: string }>;
  }

  // ── Edit Checks ────────────────────────────────────────────────────────────

  async checkEdit(
    intentId: string,
    filePath: string,
    diff: string,
    functionNames?: string[],
    startLine?: number,
    endLine?: number,
  ): Promise<CheckEditResponse> {
    const res = await fetch(`${this.serverUrl}/api/edits/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        participantId: this.participantId,
        intentId,
        filePath,
        diff,
        functionNames: functionNames ?? [],
        startLine,
        endLine,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<CheckEditResponse>;
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
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<ShadowPatch>;
  }

  async approvePatch(patchId: string): Promise<ShadowPatch> {
    const res = await fetch(`${this.serverUrl}/api/patches/${patchId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: this.participantId }),
    });
    if (!res.ok) throw new Error(await res.text());
    const patch = await res.json() as ShadowPatch;
    await this.syncState();
    return patch;
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
  onConflictDetected(cb: EventCallback<{ filePath: string; verdict: CheckEditResponse }>) { this.onConflict = cb; }
  onNegotiationEvent(cb: EventCallback<NegotiationEvent>) { this.onEventAdded = cb; }
  onPatchPending(cb: EventCallback<ShadowPatch>) { this.onPatch = cb; }

  // ── Private ────────────────────────────────────────────────────────────────

  private connectSocket(): void {
    this.socket = io(this.serverUrl, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.socket!.emit('session:join', {
        sessionId: this.sessionId!,
        participantId: this.participantId!,
      });
      // Re-sync after socket connects so sidebar gets connected:true
      this.syncState();
    });

    this.socket.on('session:state', (state) => {
      this.state = state;
      this.onStateChange?.(state);
    });

    this.socket.on('conflict:detected', (data) => {
      this.onConflict?.(data);
    });

    this.socket.on('event:added', (event) => {
      // Merge into local state events list
      if (this.state) {
        this.state = { ...this.state, events: [...this.state.events, event] };
        this.onStateChange?.(this.state);
      }
      this.onEventAdded?.(event);
    });

    this.socket.on('patch:pending', (patch) => {
      this.syncState();
      this.onPatch?.(patch);
    });

    this.socket.on('intent:added', () => this.syncState());
    this.socket.on('intent:updated', () => this.syncState());
    this.socket.on('participant:joined', () => this.syncState());
    this.socket.on('presence:changed', (participant) => {
      if (this.state) {
        const idx = this.state.participants.findIndex(p => p.id === participant.id);
        if (idx >= 0) {
          const updated = [...this.state.participants];
          updated[idx] = participant;
          this.state = { ...this.state, participants: updated };
        } else {
          this.state = { ...this.state, participants: [...this.state.participants, participant] };
        }
        this.onStateChange?.(this.state);
      }
    });
    this.socket.on('patch:updated', () => this.syncState());
  }

  private async syncState(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/sessions/${this.sessionId}/state`);
      if (res.ok) {
        this.state = (await res.json()) as SessionState;
        if (this.state) this.onStateChange?.(this.state);
      }
    } catch { /* server may not be ready yet */ }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.participantId && this.socket?.connected) {
        this.socket.emit('heartbeat', { participantId: this.participantId });
      }
    }, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
