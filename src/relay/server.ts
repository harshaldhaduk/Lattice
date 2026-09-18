import { staleNotes, repositoryKey } from "../shared/memory";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { SessionStore } from "./storage";
import { verifyGithub, type Identity } from "./identity";
import { mergeText } from "../shared/collaboration";
import { SessionSearchIndex, budgetExceeded } from "../shared/search";
import { sourceFile } from "../shared/live-files";
import { putWorkspaceFile } from "./workspace";
import {
  promptConflicts,
  promptFiles,
  type WorkIntent,
} from "../shared/coordination";
import type { WorkspaceFile } from "../shared/workspace";
import { WebSocketServer, WebSocket } from "ws";
import {
  requestSchema,
  colors,
  type Session,
  type Person,
  type SessionEvent,
  type Role,
} from "../shared/protocol";
interface Room {
  workspaceFiles?: Record<string, WorkspaceFile>;
  session: Session;
  invites: Record<
    string,
    {
      id: string;
      role: Role;
      expires: number;
      remaining: number;
      created: number;
    }
  >;
  resumes: Record<string, string>;
}
const token = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function startRelay(
  options: {
    port?: number;
    host?: string;
    dataDir?: string;
    storageKey?: string;
    requireIdentity?: boolean;
    organization?: string;
    verifyIdentity?: (token: string) => Promise<Identity>;
    maxConnections?: number;
  } = {},
) {
  const rooms = new Map<string, Room>();
  const indexes = new Map<string, SessionSearchIndex>();
  const clients = new Map<WebSocket, { room: string; person: string }>();
  const access = new Map<WebSocket, Set<string>>();
  let saveTimer: NodeJS.Timeout | undefined;
  let storageError: string | undefined;
  const store = options.dataDir
    ? new SessionStore(options.dataDir, options.storageKey)
    : undefined;
  if (options.dataDir) {
    try {
      const stored = store!.read() as Room[];
      for (const r of stored) {
        r.session.intents = [];
        for (const task of r.session.tasks || [])
          if (["running", "approval"].includes(task.status)) {
            task.status = "stopped";
            task.detail = "Executor disconnected";
          }
        for (const [key, value] of Object.entries(r.invites))
          if (typeof value === "string")
            r.invites[key] = {
              id: randomUUID(),
              role: value as Role,
              expires: Date.now() + 86400000,
              remaining: 32,
              created: Date.now(),
            };
        for (const p of r.session.people) {
          p.online = false;
          if (p.agent && ["running", "approval"].includes(p.agent.status)) {
            p.agent.status = "stopped";
            p.agent.detail = "Executor disconnected";
          }
        }
        for (const a of r.session.approvals)
          if (a.status === "pending") a.status = "denied";
        rooms.set(r.session.id, r);
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const persist = () => {
    if (!options.dataDir) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        store!.write([...rooms.values()]);
        storageError = undefined;
      } catch (e: any) {
        storageError = e.message;
        console.error("Session storage failed:", e.message);
      }
    }, 100);
  };
  const http = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? (storageError ? 503 : 200) : 404, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        req.url === "/health"
          ? {
              ok: !storageError,
              service: "lattice-relay",
              version: 3,
              authentication: options.requireIdentity ? "github" : "invitation",
              organization: options.organization,
              storage: storageError ? "unavailable" : "ready",
            }
          : { error: "Not found" },
      ),
    );
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 1024 * 1024 });
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  const system = (s: Session, actor: string, message: string) => {
    indexes.delete(s.id);
    s.entries.push({
      id: randomUUID(),
      actor,
      kind: "system",
      text: message,
      time: Date.now(),
    });
  };
  const broadcast = (r: Room) => {
    for (const g of r.session.guidance || []) {
      if (!["approval", "pending"].includes(g.status)) continue;
      const sender = r.session.people.find((p) => p.id === g.from);
      const owner = r.session.people.find((p) => p.id === g.to);
      const task =
        r.session.tasks?.find((t) => t.runId === g.runId && t.owner === g.to) ||
        owner?.agent;
      if (
        !sender ||
        sender.role === "viewer" ||
        !owner?.online ||
        !task ||
        task.runId !== g.runId ||
        (!["running", "approval"].includes(task.status) &&
          !(
            g.status === "pending" &&
            g.action === "stop" &&
            task.status === "stopped"
          ))
      ) {
        g.status = "rejected";
        g.detail = "Turn ended or collaborator access changed";
      }
    }
    r.session.revision++;
    r.session.entries = r.session.entries.slice(-10000);
    for (const [ws, c] of clients)
      if (c.room === r.session.id)
        send(ws, { type: "state", session: r.session });
    persist();
  };
  const apply = (r: Room, person: Person, e: SessionEvent) => {
    const s = r.session;
    const editor = person.role !== "viewer";
    if (!editor && !["presence", "profile"].includes(e.type))
      throw Error("This session role is read-only.");
    if (
      s.archived &&
      !["presence", "profile", "session.archive", "session.lifecycle"].includes(
        e.type,
      )
    )
      throw Error("This session is archived. The owner can reopen it.");
    if (
      s.lifecycle?.status === "reconciling" &&
      ["document.update", "document.operation", "agent"].includes(e.type)
    )
      throw Error(
        "Session update in progress. Local changes are preserved until reconciliation finishes.",
      );
    switch (e.type) {
      case "session.lifecycle":
        if (person.role !== "owner")
          throw Error(
            "Only the session owner can update its branch lifecycle.",
          );
        if (
          s.lifecycle &&
          (s.lifecycle.remote !== e.lifecycle.remote ||
            s.lifecycle.baseBranch !== e.lifecycle.baseBranch)
        )
          throw Error("A session's repository and base branch cannot change.");
        if (
          e.lifecycle.status === "reconciling" &&
          (s.tasks || []).some((t) =>
            ["running", "approval"].includes(t.status),
          )
        )
          throw Error(
            "Wait for active agents to finish before updating the session.",
          );
        s.lifecycle = e.lifecycle;
        s.archived = ["merged", "closed"].includes(e.lifecycle.status);
        system(
          s,
          person.id,
          e.lifecycle.detail || `Session ${e.lifecycle.status}`,
        );
        break;
      case "note.review": {
        const n = [...s.memories, ...s.comments].find((n) => n.id === e.id);
        if (!n) throw Error("Memory not found.");
        const file = e.file ?? n.file;
        if (
          file &&
          !r.workspaceFiles?.[file] &&
          !s.documents?.some((d) => d.file === file && !d.isolated)
        )
          throw Error(
            "This file moved or was deleted. Pin the note to an existing file before marking it reviewed.",
          );
        n.text = e.text;
        n.file = file;
        n.stale = false;
        n.anchorHash = n.file
          ? r.workspaceFiles?.[n.file]?.hash ||
            s.documents?.find((d) => d.file === n.file && !d.isolated)?.hash
          : undefined;
        n.revision = s.lifecycle?.baseCommit;
        break;
      }
      case "guidance.decide": {
        const g = s.guidance?.find((g) => g.id === e.id);
        if (!g || g.to !== person.id || g.status !== "approval")
          throw Error(
            "Only this agent's owner can answer this steering request.",
          );
        const sender = s.people.find((p) => p.id === g.from);
        const task = s.tasks?.find((t) => t.runId === g.runId) || person.agent;
        g.status =
          e.approve &&
          sender &&
          sender.role !== "viewer" &&
          task &&
          task.runId === g.runId &&
          ["running", "approval"].includes(task.status)
            ? "pending"
            : "rejected";
        g.detail =
          g.status === "pending"
            ? "Approved by agent owner"
            : "Not approved or turn has ended";
        break;
      }
      case "handoff.limit": {
        const task = s.tasks?.find(
          (t) => t.runId === e.runId && t.owner === person.id,
        );
        if (!task || task.status !== "limited")
          throw Error("This task has not reached a provider limit.");
        if (s.handoffs.some((h) => h.runId === e.runId)) break;
        s.handoffs.push({
          id: randomUUID(),
          from: person.id,
          to: "",
          runId: e.runId,
          provider: task.provider,
          reason: "limit",
          task: task.task,
          status: "pending",
          artifact: e.artifact,
          context: JSON.stringify({
            plan: s.plan,
            memories: s.memories.filter((n) => !n.stale && !n.resolved),
            history: s.entries.filter((e) => e.runId === task.runId).slice(-40),
          }).slice(-24000),
        });
        system(
          s,
          person.id,
          "Provider limit reached. A teammate can continue this task on their own account.",
        );
        break;
      }
      case "session.archive":
        if (person.role !== "owner")
          throw Error("Only the owner can archive a session.");
        if (
          e.archived &&
          (s.tasks?.some((t) => ["running", "approval"].includes(t.status)) ||
            s.people.some(
              (p) =>
                p.agent && ["running", "approval"].includes(p.agent.status),
            ))
        )
          throw Error("Stop active agents before archiving.");
        s.archived = e.archived;
        system(
          s,
          person.id,
          e.archived ? "Archived the session" : "Reopened the session",
        );
        break;
      case "session.budget":
        if (person.role !== "owner")
          throw Error("Only the owner can set the session budget.");
        s.budget = { tokens: e.tokens, cost: e.cost };
        system(s, person.id, "Updated the session budget");
        break;
      case "document.operation": {
        if (!sourceFile(e.file) || (e.target && !sourceFile(e.target)))
          throw Error("Only source files can be synchronized.");
        if (s.operations?.some((op) => op.id === e.id)) break;
        const doc = s.documents?.find((d) => d.key === "main:" + e.file);
        if (doc && doc.hash !== e.beforeHash)
          throw Error("The source changed before the file operation.");
        if (e.target && s.documents?.some((d) => d.key === "main:" + e.target))
          throw Error("The destination already exists in the session.");
        if (doc) {
          if (e.target) {
            doc.file = e.target;
            doc.key = "main:" + e.target;
            doc.version++;
          } else s.documents = s.documents!.filter((d) => d !== doc);
        }
        s.operations = [
          ...(s.operations || []),
          { ...e, author: person.id, time: Date.now() },
        ].slice(-1000);
        system(
          s,
          person.id,
          e.target ? `Renamed ${e.file} → ${e.target}` : `Deleted ${e.file}`,
        );
        break;
      }
      case "document.update": {
        const task = s.tasks?.find(
          (t) => t.runId === e.runId && t.owner === person.id,
        );
        if (
          !e.human &&
          !task &&
          (!person.agent || person.agent.runId !== e.runId)
        )
          throw Error("Live edits must belong to your current agent run.");
        if (e.human && (e.isolated || e.runId !== "human:" + person.id))
          throw Error("Invalid collaborative editor identity.");
        if (!sourceFile(e.file))
          throw Error("Only source files can be synchronized.");
        s.documents ??= [];
        const key = (e.isolated ? e.runId : "main") + ":" + e.file;
        const existing = s.documents.find((d) => d.key === key);
        if (existing?.crdtState && !e.collaboration)
          throw Error(
            "Update the extension before editing a collaborative file.",
          );
        let content = e.content;
        let crdtState: string | undefined;
        let crdtBaseHash: string | undefined;
        if (e.collaboration) {
          const c = e.collaboration;
          if (hash(c.base) !== c.baseHash)
            throw Error("Invalid collaboration base checksum.");
          if (
            existing &&
            (existing.crdtBaseHash
              ? existing.crdtBaseHash !== c.baseHash
              : existing.hash !== c.baseHash)
          )
            throw Error(
              "Collaborative editing requires a matching initial file.",
            );
          const merged = mergeText(c.base, c.update, existing?.crdtState);
          content = merged.content;
          crdtState = merged.crdtState;
          crdtBaseHash = c.baseHash;
        }
        const nextHash = hash(content);
        if (
          !e.collaboration &&
          existing &&
          existing.hash !== e.beforeHash &&
          existing.hash !== nextHash
        )
          throw Error(
            "Live file conflict: another participant changed this file.",
          );
        if (!existing && s.documents.length >= 100)
          throw Error("Live session file limit reached (100 files).");
        const doc = {
          key,
          isolated: e.isolated,
          file: e.file,
          author: person.id,
          runId: e.runId,
          provider:
            task?.provider || person.agent?.provider || ("codex" as const),
          content,
          crdtState,
          crdtBaseHash,
          crdtBaseContent: e.collaboration?.base,
          hash: nextHash,
          previousHash: e.beforeHash,
          baseHash: existing?.baseHash || e.beforeHash,
          baseMissing: existing?.baseMissing ?? e.baseMissing,
          version: (existing?.version || 0) + 1,
          line: e.line,
          column: e.column,
          updated: Date.now(),
        };
        if (existing) Object.assign(existing, doc);
        else s.documents.push(doc);
        break;
      }
      case "file.share": {
        s.files ??= [];
        const existing = s.files.findIndex(
          (f) => f.author === person.id && f.file === e.file,
        );
        if (existing < 0 && s.files.length >= 20)
          throw Error(
            "The session has reached 20 shared files. Withdraw an older file first.",
          );
        const share = {
          id: randomUUID(),
          author: person.id,
          file: e.file,
          baseHash: e.baseHash,
          baseCommit: e.baseCommit,
          hash: hash(e.content),
          content: e.content,
          time: Date.now(),
          receipts: {},
        };
        if (existing < 0) s.files.push(share);
        else s.files[existing] = share;
        system(s, person.id, `Shared ${e.file} for review`);
        break;
      }
      case "file.receipt": {
        const share = s.files?.find((f) => f.id === e.id && f.hash === e.hash);
        if (!share)
          throw Error("This shared file version is no longer available.");
        if (share.author === person.id)
          throw Error("This is your own shared file.");
        share.receipts[person.id] = e.status;
        system(
          s,
          person.id,
          `${e.status === "applied" ? "Applied" : "Dismissed"} shared file ${share.file}`,
        );
        break;
      }
      case "file.withdraw": {
        const share = s.files?.find((f) => f.id === e.id);
        if (!share) throw Error("Shared file not found.");
        if (share.author !== person.id && person.role !== "owner")
          throw Error("Only the author or host can withdraw this file.");
        s.files = s.files!.filter((f) => f.id !== e.id);
        system(s, person.id, `Withdrew ${share.file}`);
        break;
      }
      case "presence":
        person.file = e.file;
        person.line = e.line;
        person.column = e.column;
        break;
      case "profile":
        Object.assign(person, e.profile);
        break;
      case "entry": {
        const old = e.entryId
          ? s.entries.find((x) => x.id === e.entryId)
          : undefined;
        if (old) {
          if (old.actor !== person.id)
            throw Error("Cannot modify another participant’s entry.");
          old.text = (e.append ? old.text + e.text : e.text).slice(-32000);
        } else
          s.entries.push({
            id: e.entryId || randomUUID(),
            actor: person.id,
            kind: e.kind,
            text: e.text,
            time: Date.now(),
            provider: e.provider,
            runId: e.runId,
          });
        break;
      }
      case "agent":
        if (s.tasks?.some((t) => t.runId === e.runId && t.owner !== person.id))
          throw Error("This task belongs to another executor.");
        if (
          e.status === "running" &&
          !s.tasks?.some((t) => t.runId === e.runId) &&
          (s.tasks?.filter(
            (t) =>
              t.owner === person.id &&
              ["running", "approval"].includes(t.status),
          ).length || 0) >= 4
        )
          throw Error("Four concurrent tasks per executor are supported.");
        if (
          e.status === "running" &&
          !s.tasks?.some((t) => t.runId === e.runId) &&
          budgetExceeded(s)
        )
          throw Error("The session budget has been reached.");
        s.tasks ??= [];
        if (!s.tasks.some((t) => t.runId === e.runId) && s.tasks.length >= 2000)
          throw Error("Session task history is full. Start a new session.");
        {
          const old = s.tasks.find((t) => t.runId === e.runId);
          const task = {
            runId: e.runId,
            owner: person.id,
            provider: e.provider,
            status: e.status,
            task: e.task,
            detail: e.detail,
            isolated: e.isolated,
            updated: Date.now(),
          };
          if (old) Object.assign(old, task);
          else s.tasks.push(task);
        }
        person.agent = {
          provider: e.provider,
          status: e.status,
          task: e.task,
          detail: e.detail,
          runId: e.runId,
        };
        break;
      case "usage": {
        if (e.runId && e.provider) {
          if (
            person.agent?.runId !== e.runId &&
            !s.tasks?.some((t) => t.runId === e.runId && t.owner === person.id)
          )
            throw Error("Usage must belong to your current run.");
          s.usageRecords ??= [];
          const old = s.usageRecords.find(
            (u) => u.runId === e.runId && u.actor === person.id,
          );
          const record = {
            runId: e.runId,
            actor: person.id,
            provider: e.provider,
            input: Math.max(old?.input || 0, e.input),
            output: Math.max(old?.output || 0, e.output),
            cost:
              e.cost === undefined
                ? old?.cost
                : Math.max(old?.cost || 0, e.cost),
            time: Date.now(),
          };
          person.usage.input += record.input - (old?.input || 0);
          person.usage.output += record.output - (old?.output || 0);
          if (record.cost !== undefined)
            person.usage.cost =
              (person.usage.cost || 0) + record.cost - (old?.cost || 0);
          if (old) Object.assign(old, record);
          else s.usageRecords.push(record);
        } else
          person.usage = {
            input: Math.max(person.usage.input, e.input),
            output: Math.max(person.usage.output, e.output),
            cost:
              e.cost === undefined
                ? person.usage.cost
                : Math.max(person.usage.cost || 0, e.cost),
          };
        break;
      }
      case "plan.add":
        if (s.plan.length >= 100) throw Error("Plan has reached 100 steps.");
        s.plan.push({
          id: randomUUID(),
          text: e.text,
          owner:
            e.owner && s.people.some((p) => p.id === e.owner)
              ? e.owner
              : person.id,
          done: false,
        });
        break;
      case "plan.update": {
        const step = s.plan.find((x) => x.id === e.id);
        if (!step) throw Error("Step not found.");
        if (person.role !== "owner" && step.owner !== person.id)
          throw Error("Only the step owner can update it.");
        if (e.owner && !s.people.some((p) => p.id === e.owner))
          throw Error("Participant not found.");
        Object.assign(
          step,
          e.done === undefined ? {} : { done: e.done },
          e.owner ? { owner: e.owner } : {},
        );
        break;
      }
      case "note.add":
        if (s[e.kind].length >= 200) throw Error("Note limit reached.");
        s[e.kind].push({
          id: randomUUID(),
          author: person.id,
          text: e.text,
          file: e.file,
          line: e.line,
          resolved: false,
          anchorHash: e.file
            ? r.workspaceFiles?.[e.file]?.hash ||
              s.documents?.find((d) => d.file === e.file && !d.isolated)?.hash
            : undefined,
          revision: s.lifecycle?.baseCommit,
          time: Date.now(),
        });
        break;
      case "note.resolve": {
        const n = s[e.kind].find((n) => n.id === e.id);
        if (n) n.resolved = !n.resolved;
        break;
      }
      case "approval.add":
        if (
          person.agent?.runId !== e.runId &&
          !s.tasks?.some(
            (t) =>
              t.runId === e.runId &&
              t.owner === person.id &&
              ["running", "approval"].includes(t.status),
          )
        )
          throw Error("Approval is not attached to your current run.");
        if (s.approvals.some((a) => a.id === e.id))
          throw Error("Approval already exists.");
        s.approvals = s.approvals.slice(-99);
        s.approvals.push({
          id: e.id,
          owner: person.id,
          runId: e.runId,
          title: e.title,
          detail: e.detail,
          status: "pending",
        });
        system(s, person.id, `Approval requested: ${e.title}`);
        break;
      case "approval.decide": {
        const a = s.approvals.find((a) => a.id === e.id);
        if (!a || a.status !== "pending")
          throw Error("This approval has already been resolved.");
        a.status = e.approve ? "approved" : "denied";
        a.decidedBy = person.id;
        system(s, person.id, `${e.approve ? "Approved" : "Denied"} ${a.title}`);
        break;
      }
      case "guidance.send": {
        const target = s.people.find((p) => p.id === e.to);
        const agent =
          s.tasks?.find((t) => t.runId === e.runId && t.owner === e.to) ||
          target?.agent;
        if (
          !target?.online ||
          !agent ||
          agent.runId !== e.runId ||
          !["running", "approval"].includes(agent.status)
        )
          throw Error("That agent is no longer running.");
        if (e.action === "steer" && !e.text.trim())
          throw Error("Live guidance requires a message.");
        s.guidance = (s.guidance || []).slice(-99);
        s.guidance.push({
          id: randomUUID(),
          from: person.id,
          to: e.to,
          runId: e.runId,
          action: e.action,
          text: e.text,
          status:
            e.action === "steer" &&
            person.id !== e.to &&
            person.role !== "owner"
              ? "approval"
              : "pending",
        });
        system(
          s,
          person.id,
          `${e.action === "stop" ? "Stop requested" : "Guidance sent"} → ${target.name}'s agent${e.text ? ": " + e.text : ""}`,
        );
        break;
      }
      case "guidance.result": {
        const g = s.guidance?.find((g) => g.id === e.id);
        if (!g || g.to !== person.id || g.status !== "pending")
          throw Error("Guidance unavailable.");
        g.status = e.delivered ? "delivered" : "rejected";
        g.detail = e.detail;
        system(s, person.id, `Agent ${g.action}: ${g.status} · ${e.detail}`);
        break;
      }
      case "handoff.add":
        if (!s.people.some((p) => p.id === e.to && p.role !== "viewer"))
          throw Error("Choose a participant who can run an agent.");
        s.handoffs = s.handoffs.slice(-99);
        s.handoffs.push({
          id: randomUUID(),
          from: person.id,
          to: e.to,
          task: e.task,
          status: "pending",
          context: s.entries
            .filter(
              (entry) =>
                entry.actor === person.id &&
                ["message", "agent", "tool"].includes(entry.kind),
            )
            .slice(-20)
            .map((entry) => `${entry.kind}: ${entry.text}`)
            .join("\n\n")
            .slice(-24000),
          artifact: e.artifact,
        });
        system(s, person.id, "Offered a task handoff");
        break;
      case "handoff.decide": {
        const h = s.handoffs.find((h) => h.id === e.id);
        if (
          !h ||
          (h.to && h.to !== person.id) ||
          h.from === person.id ||
          h.status !== "pending"
        )
          throw Error("Handoff unavailable.");
        if (!h.to && !e.accept)
          throw Error("Leave this offer available for another teammate.");
        h.to = person.id;
        h.status = e.accept ? "accepted" : "declined";
        if (e.accept) {
          const from =
            s.people.find((p) => p.id === h.from)?.name || "Teammate";
          s.memories.push({
            id: randomUUID(),
            author: person.id,
            time: Date.now(),
            resolved: false,
            handoffId: h.id,
            revision: s.lifecycle?.baseCommit,
            text: `Handoff: ${from} → ${person.name}. Goal: ${h.task}. Next: review the shared changes and continue unfinished plan steps. ${h.artifact ? "Reviewed patch transferred." : "Code remains in the shared workspace."}\n${s.plan
              .map((p) => `${p.done ? "Done" : "Next"}: ${p.text}`)
              .join("\n")
              .slice(0, 3000)}`,
          });
        }
        system(s, person.id, `${h.status} a task handoff`);
        break;
      }
      case "role": {
        if (person.role !== "owner")
          throw Error("Only the session owner can change roles.");
        const target = s.people.find((p) => p.id === e.personId);
        if (!target || target.role === "owner")
          throw Error("Cannot change the session owner.");
        target.role = e.role;
        break;
      }
      case "remove": {
        if (person.role !== "owner" || e.personId === person.id)
          throw Error("Only the owner can remove another participant.");
        for (const [key, value] of Object.entries(r.resumes))
          if (value === e.personId) delete r.resumes[key];
        for (const [ws, c] of clients)
          if (c.room === s.id && c.person === e.personId) {
            access.delete(ws);
            clients.delete(ws);
            ws.close(4003, "Removed from session");
          }
        for (const allowed of access.values()) allowed.delete(s.id);
        s.people = s.people.filter((p) => p.id !== e.personId);
        break;
      }
    }
  };
  wss.on("connection", (ws, req) => {
    if (wss.clients.size > (options.maxConnections || 256)) {
      ws.close(1013, "Relay connection limit reached");
      return;
    }
    const identityPromise = options.requireIdentity
      ? (
          options.verifyIdentity ||
          ((token: string) => verifyGithub(token, options.organization))
        )(String(req.headers.authorization || "").replace(/^Bearer /, ""))
      : Promise.resolve(undefined);
    void identityPromise.catch(() =>
      ws.close(4003, "GitHub authentication required"),
    );
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      ws.close(4003, "Origin not allowed");
      return;
    }
    let windowStart = Date.now(),
      count = 0;
    const helloTimeout = setTimeout(() => {
      if (!clients.has(ws)) ws.close(4001, "Join required");
    }, 30000);
    let incoming = Promise.resolve();
    ws.on("message", (raw) => {
      incoming = incoming
        .then(async () => {
          let requestId = "unknown";
          try {
            const identity = await identityPromise;
            if (ws.readyState !== WebSocket.OPEN) return;
            if (Date.now() - windowStart > 1000) {
              windowStart = Date.now();
              count = 0;
            }
            if (++count > 100) throw Error("Too many messages.");
            const data = JSON.parse(raw.toString());
            if (
              typeof data.requestId === "string" &&
              data.requestId.length <= 120
            )
              requestId = data.requestId;
            const req = requestSchema.parse(data);
            requestId = req.requestId;
            if (req.op === "create" || req.op === "join") {
              if (clients.has(ws))
                throw Error("Leave the current session first.");
              let r: Room;
              let p: Person;
              let resume = token(),
                invite = "";
              if (req.op === "create") {
                if (rooms.size >= 1000)
                  throw Error("Relay session limit reached.");
                const id = randomUUID();
                invite = token();
                p = {
                  id: randomUUID(),
                  ...req.profile,
                  color: colors[0],
                  role: "owner",
                  online: true,
                  identity,
                  usage: { input: 0, output: 0 },
                };
                r = {
                  session: {
                    id,
                    title: req.title,
                    repo: req.repo,
                    branch: req.branch,
                    lifecycle: req.lifecycle,
                    created: Date.now(),
                    people: [p],
                    entries: [],
                    plan: [],
                    comments: [],
                    memories: [],
                    approvals: [],
                    handoffs: [],
                    revision: 0,
                  },
                  invites: {
                    [hash(invite)]: {
                      id: randomUUID(),
                      role: "editor",
                      expires: Date.now() + 86400000,
                      remaining: 31,
                      created: Date.now(),
                    },
                  },
                  resumes: { [hash(resume)]: p.id },
                };
                rooms.set(id, r);
                system(r.session, p.id, "Started the session");
              } else {
                const found = rooms.get(req.room);
                if (!found)
                  throw Error(
                    "Session not found. Ask the host to start the relay.",
                  );
                r = found;
                const resumedId = req.resume
                  ? r.resumes[hash(req.resume)]
                  : undefined;
                if (req.resume && !resumedId)
                  throw Error(
                    "Membership expired. Ask the host for a new invitation.",
                  );
                if (resumedId) {
                  const existing = r.session.people.find(
                    (p) => p.id === resumedId,
                  );
                  if (!existing) throw Error("Membership expired.");
                  if (
                    options.requireIdentity &&
                    existing.identity?.id !== identity?.id
                  )
                    throw Error(
                      "This membership belongs to a different GitHub account.",
                    );
                  p = existing;
                  resume = req.resume!;
                  for (const [other, c] of clients)
                    if (c.room === req.room && c.person === p.id) {
                      clients.delete(other);
                      other.close(4004, "Connected in another window");
                    }
                  p.online = true;
                  Object.assign(p, req.profile);
                } else {
                  const invitation = r.invites[hash(req.token)];
                  if (
                    !invitation ||
                    invitation.expires <= Date.now() ||
                    invitation.remaining <= 0
                  )
                    throw Error("Invitation is invalid or expired.");
                  if (r.session.people.length >= 32)
                    throw Error("This session is full.");
                  p = {
                    id: randomUUID(),
                    ...req.profile,
                    color: colors[r.session.people.length % colors.length],
                    role: invitation.role,
                    online: true,
                    identity,
                    usage: { input: 0, output: 0 },
                  };
                  r.session.people.push(p);
                  invitation.remaining--;
                  r.resumes[hash(resume)] = p.id;
                  system(r.session, p.id, "Joined the session");
                }
                invite = req.token;
              }
              clearTimeout(helloTimeout);
              clients.set(ws, { room: r.session.id, person: p.id });
              access.set(ws, new Set([r.session.id]));
              send(ws, {
                type: "reply",
                requestId,
                result: {
                  room: r.session.id,
                  token: invite,
                  resume,
                  personId: p.id,
                  capabilities: [
                    "workspace",
                    "coordination",
                    "brain",
                    "workflow",
                  ],
                  session: r.session,
                },
              });
              broadcast(r);
              return;
            }
            if (req.op === "session.observe") {
              const target = rooms.get(req.room);
              const member = target?.session.people.find(
                (p) => p.id === target.resumes[hash(req.resume)],
              );
              if (
                !target ||
                !member ||
                (options.requireIdentity &&
                  member.identity?.id !== identity?.id)
              )
                throw Error("Session membership is required.");
              const s = target.session;
              if (req.completion) {
                if (
                  member.role !== "owner" ||
                  s.lifecycle?.pullRequest?.number !== req.completion.number
                )
                  throw Error(
                    "Only the owner can close this session's linked PR.",
                  );
                s.lifecycle.status = req.completion.status;
                s.lifecycle.detail =
                  req.completion.status === "merged"
                    ? "Merged on GitHub"
                    : "PR closed without merging";
                s.archived = true;
                broadcast(target);
              }
              send(ws, {
                type: "reply",
                requestId,
                result: {
                  owner: member.role === "owner",
                  card: {
                    id: s.id,
                    title: s.title,
                    branch: s.branch,
                    repo: s.repo,
                    created: s.created,
                    lifecycle: s.lifecycle,
                    archived: s.archived,
                    people: s.people.map(
                      ({ id, name, color, online, avatar }) => ({
                        id,
                        name,
                        color,
                        online,
                        avatar,
                      }),
                    ),
                    completed: s.plan.filter((p) => p.done).length,
                    steps: s.plan.length,
                    pending: s.approvals.filter((a) => a.status === "pending")
                      .length,
                  },
                },
              });
              return;
            }
            const c = clients.get(ws);
            if (!c) throw Error("Join a session first.");
            const r = rooms.get(c.room)!;
            const p = r.session.people.find((p) => p.id === c.person);
            if (!p) throw Error("Membership expired.");
            if (req.op === "brain.context") {
              const allowed = new Set([r.session.id]);
              for (const room of rooms.values()) {
                const proof = req.memberships.find(
                  (m) => m.room === room.session.id,
                );
                const member = proof && room.resumes[hash(proof.resume)];
                if (
                  (member &&
                    room.session.people.some(
                      (x) =>
                        x.id === member &&
                        (!options.requireIdentity ||
                          x.identity?.id === identity?.id),
                    )) ||
                  (identity &&
                    room.session.people.some(
                      (x) => x.identity?.id === identity.id,
                    ))
                )
                  allowed.add(room.session.id);
              }
              access.set(ws, allowed);
              const sessions = [...rooms.values()].filter(
                (x) =>
                  allowed.has(x.session.id) &&
                  repositoryKey(x.session.repo) ===
                    repositoryKey(r.session.repo),
              );
              send(ws, {
                type: "reply",
                requestId,
                result: sessions.map(({ session: s }) => ({
                  id: s.id,
                  title: s.title,
                  branch: s.branch,
                  repo: s.repo,
                  created: s.created,
                  lifecycle: s.lifecycle,
                  archived: s.archived,
                  people: s.people.map(
                    ({ id, name, color, online, avatar }) => ({
                      id,
                      name,
                      color,
                      online,
                      avatar,
                    }),
                  ),
                  completed: s.plan.filter((p) => p.done).length,
                  steps: s.plan.length,
                  pending: s.approvals.filter((a) => a.status === "pending")
                    .length,
                  intents: s.intents || [],
                  plan: s.plan,
                  memories: s.memories.filter((n) => !n.resolved),
                  changedFiles: [
                    ...new Set([...(s.documents || []).map((d) => d.file)]),
                  ],
                })),
              });
              return;
            }
            if (req.op === "workspace.index") {
              send(ws, {
                type: "reply",
                requestId,
                result: {
                  summary: r.session.workspace,
                  files: Object.values(r.workspaceFiles || {}).map(
                    ({ content, ...file }) => file,
                  ),
                },
              });
              return;
            }
            if (req.op === "workspace.get") {
              const file =
                r.workspaceFiles && Object.hasOwn(r.workspaceFiles, req.file)
                  ? r.workspaceFiles[req.file]
                  : undefined;
              send(ws, { type: "reply", requestId, result: file || null });
              return;
            }
            if (req.op === "workspace.put" || req.op === "workspace.ready") {
              if (p.role === "viewer" || r.session.archived)
                throw Error("Editor access to an active session is required.");
              if (r.session.lifecycle?.status === "reconciling")
                throw Error(
                  "Session update in progress. Local changes are preserved.",
                );
              if (
                (req.op === "workspace.ready" || !r.session.workspace?.ready) &&
                p.role !== "owner"
              )
                throw Error("The host must publish the workspace first.");
              if (req.op === "workspace.put") {
                if (putWorkspaceFile(r, req.file, req.content, req.before))
                  staleNotes(
                    r.session,
                    req.file,
                    r.workspaceFiles?.[req.file]?.hash,
                  );
              } else {
                r.session.workspace ??= {
                  revision: 0,
                  ready: false,
                  files: 0,
                  bytes: 0,
                  skipped: [],
                };
                r.session.workspace.ready = true;
                r.session.workspace.skipped = req.skipped;
                r.session.workspace.revision++;
              }
              send(ws, {
                type: "reply",
                requestId,
                result: { ok: true, workspace: r.session.workspace },
              });
              broadcast(r);
              return;
            }
            if (
              req.op === "intent.claim" ||
              req.op === "intent.renew" ||
              req.op === "intent.release"
            ) {
              if (p.role === "viewer" || r.session.archived)
                throw Error("Editor access to an active session is required.");
              if (r.session.lifecycle?.status === "reconciling")
                throw Error(
                  "Session update in progress. Local changes are preserved.",
                );
              const active = (r.session.intents || []).filter(
                (i) => i.expires > Date.now(),
              );
              const existing = active.find((i) => i.id === req.id);
              if (
                !existing &&
                req.op === "intent.claim" &&
                active.length >= 128
              )
                throw Error(
                  "The session has too many active work reservations.",
                );
              if (
                existing &&
                req.op === "intent.claim" &&
                (existing.prompt !== req.prompt ||
                  existing.readOnly !== req.readOnly ||
                  JSON.stringify(existing.files) !== JSON.stringify(req.files))
              )
                throw Error(
                  "An active reservation cannot change scope. Release it and create a new reservation.",
                );
              if (existing && existing.owner !== p.id)
                throw Error(
                  "This work reservation belongs to another participant.",
                );
              if (req.op === "intent.release")
                r.session.intents = active.filter((i) => i.id !== req.id);
              else if (req.op === "intent.renew") {
                if (!existing)
                  throw Error(
                    "Work reservation expired; stop and resubmit the prompt.",
                  );
                existing.expires = Date.now() + 90000;
                r.session.intents = active;
              } else {
                const candidate: WorkIntent = {
                  id: req.id,
                  owner: p.id,
                  prompt: req.prompt,
                  files: req.files,
                  readOnly: req.readOnly,
                  expires: Date.now() + 90000,
                };
                const legacy: WorkIntent[] = (r.session.tasks || [])
                  .filter(
                    (t) =>
                      ["running", "approval"].includes(t.status) &&
                      !active.some((i) => i.id === t.runId),
                  )
                  .map((t) => ({
                    id: t.runId,
                    owner: t.owner,
                    prompt: t.task,
                    files: promptFiles(t.task),
                    readOnly: false,
                    expires: Date.now() + 90000,
                  }));
                const conflicts = promptConflicts(
                  candidate,
                  [
                    ...active,
                    ...legacy,
                    ...[...rooms.values()]
                      .filter(
                        (other) =>
                          other !== r &&
                          access.get(ws)?.has(other.session.id) &&
                          !other.session.archived &&
                          repositoryKey(other.session.repo) ===
                            repositoryKey(r.session.repo),
                      )
                      .flatMap((other) =>
                        (other.session.intents || []).map((i) => ({
                          ...i,
                          prompt: `[${other.session.title} / ${other.session.branch}] ${i.prompt}`,
                        })),
                      ),
                  ],
                  req.sensitivity,
                ).filter((c) => !req.acknowledged?.includes(c.id));
                if (conflicts.length) {
                  send(ws, {
                    type: "reply",
                    requestId,
                    result: { accepted: false, conflicts },
                  });
                  return;
                }
                r.session.intents = [
                  ...active.filter((i) => i.id !== req.id),
                  candidate,
                ];
              }
              send(ws, {
                type: "reply",
                requestId,
                result: { accepted: true },
              });
              broadcast(r);
              return;
            }
            if (req.op === "event") {
              apply(r, p, req.event);
              if (
                ["entry", "note.add", "note.resolve"].includes(req.event.type)
              )
                indexes.delete(r.session.id);
              send(ws, { type: "reply", requestId, result: { ok: true } });
              if (req.event.type === "document.update") {
                r.session.revision++;
                const key =
                  (req.event.isolated ? req.event.runId : "main") +
                  ":" +
                  req.event.file;
                const document = r.session.documents!.find(
                  (d) => d.key === key,
                );
                for (const [peer, member] of clients)
                  if (member.room === r.session.id)
                    send(peer, {
                      type: "document",
                      room: r.session.id,
                      revision: r.session.revision,
                      document,
                    });
                if (document && !document.isolated)
                  staleNotes(r.session, document.file, document.hash);
                broadcast(r);
              } else {
                if (req.event.type === "document.operation")
                  staleNotes(r.session, req.event.file);
                broadcast(r);
              }
            }
            if (req.op === "invite") {
              if (p.role !== "owner")
                throw Error("Only the owner can create invitations.");
              if (Object.keys(r.invites).length >= 100)
                throw Error("Invite limit reached.");
              const invite = token();
              const metadata = {
                id: randomUUID(),
                role: req.role,
                expires: Date.now() + (req.expiresIn || 86400) * 1000,
                remaining: req.maxUses || 31,
                created: Date.now(),
              };
              r.invites[hash(invite)] = metadata;
              persist();
              send(ws, {
                type: "reply",
                requestId,
                result: { token: invite, room: r.session.id, ...metadata },
              });
            }
            if (req.op === "invites" || req.op === "revokeInvite") {
              if (p.role !== "owner")
                throw Error("Only the owner can manage invitations.");
              if (req.op === "revokeInvite") {
                for (const [key, invite] of Object.entries(r.invites))
                  if (invite.id === req.inviteId) delete r.invites[key];
                persist();
              }
              send(ws, {
                type: "reply",
                requestId,
                result: Object.values(r.invites),
              });
            }
            if (req.op === "search") {
              const visible =
                req.scope === "memberships" && identity
                  ? [...rooms.values()].filter((room) =>
                      room.session.people.some(
                        (member) => member.identity?.id === identity.id,
                      ),
                    )
                  : [r];
              const results = visible
                .flatMap((room) => {
                  let index = indexes.get(room.session.id);
                  if (!index) {
                    index = new SessionSearchIndex(room.session);
                    indexes.set(room.session.id, index);
                  }
                  return index.search(req.query, req.kind);
                })
                .sort((a, b) => b.time - a.time)
                .slice(0, 50);
              send(ws, {
                type: "reply",
                requestId,
                result: results,
              });
            }
            if (req.op === "export")
              send(ws, { type: "reply", requestId, result: r.session });
            if (req.op === "leave") {
              send(ws, { type: "reply", requestId, result: { ok: true } });
              ws.close(1000, "Left session");
            }
          } catch (e: any) {
            send(ws, {
              type: "reply",
              requestId,
              error: e?.issues ? "Invalid session message." : e.message,
            });
          }
        })
        .catch(() => ws.close(1011, "Request processing failed"));
    });
    ws.on("close", () => {
      clearTimeout(helloTimeout);
      const c = clients.get(ws);
      clients.delete(ws);
      if (!c) return;
      const r = rooms.get(c.room);
      if (!r) return;
      const p = r.session.people.find((p) => p.id === c.person);
      if (p) {
        r.session.intents = r.session.intents?.filter((i) => i.owner !== p.id);
        for (const task of r.session.tasks || [])
          if (
            task.owner === p.id &&
            ["running", "approval"].includes(task.status)
          ) {
            task.status = "stopped";
            task.detail = "Connection lost";
          }
        p.online = false;
        p.file = undefined;
        if (p.agent && ["running", "approval"].includes(p.agent.status)) {
          p.agent.status = "stopped";
          p.agent.detail = "Connection lost";
        }
        for (const a of r.session.approvals)
          if (a.owner === p.id && a.status === "pending") a.status = "denied";
        system(r.session, p.id, "Disconnected");
      }
      broadcast(r);
    });
    ws.on("error", () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as any).alive === false) {
        ws.terminate();
        continue;
      }
      (ws as any).alive = false;
      ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  wss.on("connection", (ws) => {
    (ws as any).alive = true;
    ws.on("pong", () => {
      (ws as any).alive = true;
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      // ws forwards HTTP listen errors. Handle both emitters so a busy local
      // port rejects startup instead of throwing before the HTTP handler runs.
      wss.once("error", reject);
      http.once("error", reject);
      http.listen(options.port ?? 4319, options.host ?? "127.0.0.1", resolve);
    });
  } catch (error) {
    clearInterval(heartbeat);
    wss.close();
    http.close();
    throw error;
  }
  return {
    port: (http.address() as any).port,
    close: async () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      clearTimeout(saveTimer);
      store?.write([...rooms.values()]);
    },
    rooms,
  };
}
