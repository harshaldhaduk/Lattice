import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  validateRelay,
  type Session,
  type SessionEvent,
  type Credentials,
} from "./protocol";
export class SessionClient extends EventEmitter {
  socket?: WebSocket;
  session?: Session;
  credentials?: Credentials;
  connected = false;
  capabilities: string[] = [];
  brain: any[] = [];
  authorization?: (url: string) => Promise<string | undefined>;
  beforeReconnect?: (url: string) => Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (r: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private retry?: NodeJS.Timeout;
  private closed = false;
  private profile: { name: string; avatar?: string } = { name: "You" };
  async connect(url: string) {
    validateRelay(url);
    const authorization = await this.authorization?.(url);
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: authorization
          ? { Authorization: `Bearer ${authorization}` }
          : undefined,
      });
      this.socket = ws;
      const timer = setTimeout(() => {
        ws.terminate();
        reject(Error("Relay connection timed out."));
      }, 8000);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      ws.on("message", (raw) => {
        if (this.socket !== ws) return;
        try {
          const m = JSON.parse(raw.toString());
          if (m.type === "reply") {
            const p = this.pending.get(m.requestId);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(m.requestId);
              m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
            }
          }
          if (
            m.type === "document" &&
            this.session &&
            this.session.id === m.room
          ) {
            const documents = (this.session.documents ??= []);
            const index = documents.findIndex((d) => d.key === m.document.key);
            if (index < 0) documents.push(m.document);
            else documents[index] = m.document;
            this.session.revision = m.revision;
            this.emit("state", this.session);
          }
          if (m.type === "state") {
            this.session = m.session;
            this.emit("state", m.session);
          }
        } catch {
          this.emit("notice", "Invalid response from relay.");
        }
      });
      ws.on("close", (code) => {
        clearTimeout(timer);
        if (this.socket !== ws) return;
        this.connected = false;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(Error("Session disconnected."));
        }
        this.pending.clear();
        this.emit("state", this.session);
        if (!this.closed && this.credentials && ![4003, 4004].includes(code)) {
          clearTimeout(this.retry);
          this.retry = setTimeout(() => this.reconnect(), 2000);
        } else if (code === 4003 || code === 4004) {
          this.credentials = undefined;
          this.emit("credentials", undefined);
          this.emit(
            "notice",
            "Session access ended or moved to another window.",
          );
        }
      });
    });
  }
  private async reconnect() {
    if (!this.credentials || this.closed) return;
    const saved = { ...this.credentials };
    try {
      await this.beforeReconnect?.(saved.relay);
      await this.join(
        saved.relay,
        saved.room,
        saved.token,
        this.profile,
        saved.resume,
      );
    } catch (e: any) {
      this.emit("notice", e.message);
      if (!this.closed) this.retry = setTimeout(() => this.reconnect(), 5000);
    }
  }
  async request(data: Record<string, unknown>) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw Error("Connect to a session first.");
    const requestId = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error("Relay did not acknowledge the action."));
      }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ ...data, requestId }));
    });
  }
  async create(
    relay: string,
    title: string,
    repo: string,
    branch: string,
    profile: { name: string; avatar?: string },
    lifecycle?: import("./protocol").BranchSession,
  ) {
    await this.disconnect();
    this.profile = profile;
    await this.connect(relay);
    const r = await this.request({
      op: "create",
      lifecycle,
      title,
      repo,
      branch,
      profile,
    });
    this.accept(relay, r);
    return this.credentials!;
  }
  async join(
    relay: string,
    room: string,
    token: string,
    profile: { name: string; avatar?: string },
    resume?: string,
  ) {
    this.profile = profile;
    await this.connect(relay);
    try {
      const r = await this.request({
        op: "join",
        room,
        token,
        profile,
        resume,
      });
      this.accept(relay, r);
      return this.credentials!;
    } catch (e) {
      const ws = this.socket;
      this.socket = undefined;
      ws?.close();
      throw e;
    }
  }
  private accept(relay: string, r: any) {
    this.capabilities = Array.isArray(r.capabilities) ? r.capabilities : [];
    this.credentials = {
      relay,
      room: r.room,
      token: r.token,
      resume: r.resume,
      personId: r.personId,
    };
    this.session = r.session;
    this.connected = true;
    this.emit("credentials", this.credentials);
    this.emit("state", this.session);
  }
  event(event: SessionEvent) {
    return this.request({ op: "event", event });
  }
  async disconnect() {
    this.closed = true;
    clearTimeout(this.retry);
    this.credentials = undefined;
    const ws = this.socket;
    this.socket = undefined;
    ws?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Session disconnected."));
    }
    this.pending.clear();
    this.connected = false;
    this.session = undefined;
    this.emit("state");
  }
  dispose() {
    void this.disconnect();
    this.removeAllListeners();
  }
}
