import { z } from "zod";
z.config({ jitless: true });
export const text = z.string().trim().min(1).max(8000);
export const relativePath = z
  .string()
  .max(500)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.split("/").includes("..") &&
      !p.includes("\0"),
    "Use a repository-relative path",
  );
export const roleSchema = z.enum(["owner", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;
export type Provider = "codex" | "claude";
export type AgentStatus =
  "idle" | "running" | "approval" | "done" | "error" | "stopped" | "limited";
export interface Person {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  role: Role;
  online: boolean;
  identity?: { id: string; login: string; provider: "github" };
  file?: string;
  line?: number;
  column?: number;
  agent?: {
    provider: Provider;
    status: AgentStatus;
    task: string;
    detail: string;
    runId: string;
  };
  usage: { input: number; output: number; cost?: number };
}
export interface Entry {
  id: string;
  actor: string;
  kind: "message" | "agent" | "tool" | "system";
  text: string;
  time: number;
  provider?: Provider;
  runId?: string;
}
export interface PlanStep {
  id: string;
  text: string;
  owner: string;
  done: boolean;
}
export interface Note {
  id: string;
  text: string;
  file?: string;
  line?: number;
  author: string;
  resolved: boolean;
  time: number;
  stale?: boolean;
  anchorHash?: string;
  revision?: string;
  handoffId?: string;
}
export interface Approval {
  id: string;
  owner: string;
  runId: string;
  title: string;
  detail: string;
  status: "pending" | "approved" | "denied";
  decidedBy?: string;
}
export interface Handoff {
  id: string;
  from: string;
  to: string;
  runId?: string;
  provider?: Provider;
  reason?: "limit";
  task: string;
  status: "pending" | "accepted" | "declined";
  context?: string;
  artifact?: { base: string; patch: string };
}
export interface Guidance {
  id: string;
  from: string;
  to: string;
  runId: string;
  action: "steer" | "stop";
  text: string;
  status: "approval" | "pending" | "delivered" | "rejected";
  detail?: string;
}
export interface FileShare {
  id: string;
  author: string;
  file: string;
  baseHash: string;
  baseCommit: string;
  hash: string;
  content: string;
  time: number;
  receipts: Record<string, "applied" | "dismissed">;
}
export interface LiveDocument {
  key: string;
  isolated: boolean;
  file: string;
  author: string;
  runId: string;
  provider: Provider;
  content: string;
  hash: string;
  previousHash: string;
  baseHash: string;
  baseMissing: boolean;
  version: number;
  line: number;
  column: number;
  updated: number;
  crdtState?: string;
  crdtBaseHash?: string;
  crdtBaseContent?: string;
}
export interface FileOperation {
  id: string;
  author: string;
  file: string;
  target?: string;
  beforeHash: string;
  time: number;
}
export interface UsageRecord {
  runId: string;
  actor: string;
  provider: Provider;
  input: number;
  output: number;
  cost?: number;
  time: number;
}
export interface TaskRecord {
  runId: string;
  owner: string;
  provider: Provider;
  status: AgentStatus;
  task: string;
  detail: string;
  isolated?: boolean;
  updated: number;
}
export interface BranchSession {
  baseBranch: string;
  baseCommit: string;
  remote: string;
  status:
    "active" | "reconciling" | "attention" | "review" | "merged" | "closed";
  detail?: string;
  pullRequest?: { number: number; url: string; head: string };
}
export interface SessionCard {
  id: string;
  title: string;
  branch: string;
  repo: string;
  created: number;
  lifecycle?: BranchSession;
  people: Pick<Person, "id" | "name" | "color" | "online" | "avatar">[];
  completed: number;
  steps: number;
  archived?: boolean;
  pending: number;
}
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
export const branchSessionSchema = z.object({
  baseBranch: z.string().min(1).max(200),
  baseCommit: commit,
  remote: z.string().max(500),
  status: z.enum([
    "active",
    "reconciling",
    "attention",
    "review",
    "merged",
    "closed",
  ]),
  detail: z.string().max(1000).optional(),
  pullRequest: z
    .object({
      number: z.number().int().positive(),
      url: z.string().url().max(500),
      head: commit,
    })
    .optional(),
});
export interface Session {
  lifecycle?: BranchSession;
  workspace?: import("./workspace").WorkspaceSummary;
  intents?: import("./coordination").WorkIntent[];
  id: string;
  title: string;
  repo: string;
  branch: string;
  created: number;
  people: Person[];
  entries: Entry[];
  plan: PlanStep[];
  comments: Note[];
  memories: Note[];
  approvals: Approval[];
  handoffs: Handoff[];
  guidance?: Guidance[];
  files?: FileShare[];
  documents?: LiveDocument[];
  operations?: FileOperation[];
  archived?: boolean;
  budget?: { tokens?: number; cost?: number };
  usageRecords?: UsageRecord[];
  tasks?: TaskRecord[];
  revision: number;
}
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  avatar: z
    .string()
    .max(500)
    .optional()
    .refine(
      (v) => !v || /^https:\/\/avatars\.githubusercontent\.com\//.test(v),
      "Use a GitHub avatar URL",
    ),
});
const id = z.string().min(1).max(120);
export const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.lifecycle"),
    lifecycle: branchSessionSchema,
  }),
  z.object({ type: z.literal("guidance.decide"), id, approve: z.boolean() }),
  z.object({
    type: z.literal("note.review"),
    id,
    text,
    file: relativePath.optional(),
  }),
  z.object({
    type: z.literal("handoff.limit"),
    runId: id,
    artifact: z
      .object({
        base: z.string().regex(/^[a-f0-9]{40,64}$/),
        patch: z.string().max(120000),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("document.operation"),
    id,
    file: relativePath,
    target: relativePath.optional(),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ type: z.literal("session.archive"), archived: z.boolean() }),
  z.object({
    type: z.literal("session.budget"),
    tokens: z.number().int().positive().optional(),
    cost: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal("document.update"),
    file: relativePath,
    runId: id,
    isolated: z.boolean(),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseMissing: z.boolean(),
    content: z
      .string()
      .max(32000)
      .refine((s) => !s.includes("\0")),
    line: z.number().int().min(0).max(32000),
    column: z.number().int().min(0).max(32000),
    collaboration: z
      .object({
        base: z.string().max(32000),
        baseHash: z.string().regex(/^[a-f0-9]{64}$/),
        update: z
          .string()
          .max(180000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .optional(),
    human: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("file.share"),
    file: relativePath,
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
    content: z
      .string()
      .max(32000)
      .refine((s) => !s.includes("\0"), "Text files only"),
  }),
  z.object({
    type: z.literal("file.receipt"),
    id,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["applied", "dismissed"]),
  }),
  z.object({ type: z.literal("file.withdraw"), id }),
  z.object({
    type: z.literal("guidance.send"),
    to: id,
    runId: id,
    action: z.enum(["steer", "stop"]),
    text: z.string().max(8000),
  }),
  z.object({
    type: z.literal("guidance.result"),
    id,
    delivered: z.boolean(),
    detail: z.string().max(500),
  }),
  z.object({
    type: z.literal("presence"),
    file: relativePath.optional(),
    line: z.number().int().min(0).max(1000000).optional(),
    column: z.number().int().min(0).max(1000000).optional(),
  }),
  z.object({ type: z.literal("profile"), profile: profileSchema }),
  z.object({
    type: z.literal("entry"),
    kind: z.enum(["message", "agent", "tool"]),
    text: z.string().min(1).max(32000),
    provider: z.enum(["codex", "claude"]).optional(),
    runId: id.optional(),
    entryId: id.optional(),
    append: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("agent"),
    isolated: z.boolean().optional(),
    provider: z.enum(["codex", "claude"]),
    status: z.enum([
      "idle",
      "running",
      "approval",
      "done",
      "error",
      "stopped",
      "limited",
    ]),
    task: z.string().max(2000),
    detail: z.string().max(2000),
    runId: id,
  }),
  z.object({
    type: z.literal("usage"),
    runId: id.optional(),
    provider: z.enum(["codex", "claude"]).optional(),
    input: z.number().int().nonnegative().max(1e10),
    output: z.number().int().nonnegative().max(1e10),
    cost: z.number().nonnegative().max(1e6).optional(),
  }),
  z.object({ type: z.literal("plan.add"), text, owner: id.optional() }),
  z.object({
    type: z.literal("plan.update"),
    id,
    done: z.boolean().optional(),
    owner: id.optional(),
  }),
  z.object({
    type: z.literal("note.add"),
    kind: z.enum(["comments", "memories"]),
    text,
    file: relativePath.optional(),
    line: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("note.resolve"),
    kind: z.enum(["comments", "memories"]),
    id,
  }),
  z.object({
    type: z.literal("approval.add"),
    id,
    runId: id,
    title: z.string().max(200),
    detail: z.string().max(12000),
  }),
  z.object({ type: z.literal("approval.decide"), id, approve: z.boolean() }),
  z.object({
    type: z.literal("handoff.add"),
    to: id,
    task: text,
    artifact: z
      .object({
        base: z.string().regex(/^[a-f0-9]{40,64}$/),
        patch: z.string().max(120000),
      })
      .optional(),
  }),
  z.object({ type: z.literal("handoff.decide"), id, accept: z.boolean() }),
  z.object({
    type: z.literal("role"),
    personId: id,
    role: z.enum(["editor", "viewer"]),
  }),
  z.object({ type: z.literal("remove"), personId: id }),
]);
export type SessionEvent = z.infer<typeof eventSchema>;
export const requestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("session.observe"),
    requestId: id,
    room: id,
    resume: z.string().min(1).max(200),
    completion: z
      .object({
        number: z.number().int().positive(),
        status: z.enum(["merged", "closed"]),
      })
      .optional(),
  }),
  z.object({
    op: z.literal("brain.context"),
    requestId: id,
    memberships: z
      .array(z.object({ room: id, resume: z.string().max(200) }))
      .max(100),
  }),
  z.object({ op: z.literal("workspace.index"), requestId: id }),
  z.object({
    op: z.literal("workspace.get"),
    requestId: id,
    file: relativePath,
  }),
  z.object({
    op: z.literal("workspace.ready"),
    requestId: id,
    skipped: z.array(z.string().max(600)).max(100),
  }),
  z.object({
    op: z.literal("workspace.put"),
    requestId: id,
    file: relativePath,
    before: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    content: z.string().max(700000).nullable(),
  }),
  z.object({
    op: z.literal("intent.claim"),
    requestId: id,
    id,
    prompt: text,
    files: z.array(relativePath).max(40),
    readOnly: z.boolean(),
    sensitivity: z.number().int().min(1).max(10),
    acknowledged: z.array(id).max(128).optional(),
  }),
  z.object({ op: z.literal("intent.release"), requestId: id, id }),
  z.object({ op: z.literal("intent.renew"), requestId: id, id }),
  z.object({
    op: z.literal("create"),
    requestId: id,
    title: z.string().trim().min(1).max(120),
    repo: z.string().max(500),
    branch: z.string().max(200),
    profile: profileSchema,
    lifecycle: branchSessionSchema.optional(),
  }),
  z.object({
    op: z.literal("join"),
    requestId: id,
    room: id,
    token: z.string().min(16).max(200),
    profile: profileSchema,
    resume: z.string().max(200).optional(),
  }),
  z.object({ op: z.literal("event"), requestId: id, event: eventSchema }),
  z.object({
    op: z.literal("invite"),
    requestId: id,
    role: z.enum(["editor", "viewer"]),
    expiresIn: z.number().int().min(60).max(2592000).optional(),
    maxUses: z.number().int().min(1).max(100).optional(),
  }),
  z.object({ op: z.literal("invites"), requestId: id }),
  z.object({ op: z.literal("revokeInvite"), requestId: id, inviteId: id }),
  z.object({
    op: z.literal("search"),
    requestId: id,
    query: z.string().max(200),
    kind: z.enum(["all", "memory", "history"]).optional(),
    scope: z.enum(["session", "memberships"]).optional(),
  }),
  z.object({ op: z.literal("export"), requestId: id }),
  z.object({ op: z.literal("leave"), requestId: id }),
]);
export interface Credentials {
  relay: string;
  room: string;
  token: string;
  resume: string;
  personId: string;
}
export interface AppState {
  dashboard?: SessionCard[];
  brainStatus?: string;
  steering?: { person: string; runId: string };
  conflictSensitivity?: number;
  onboarding?: boolean;
  workspaceStatus?: string;
  session?: Session;
  me: string;
  connected: boolean;
  error?: string;
  providers: { id: Provider; available: boolean; version?: string }[];
  repo: string;
  file?: string;
  branch: string;
  preview?: boolean;
  run?: { id: string; provider: Provider; status: AgentStatus; task: string };
  reviewedFiles?: string[];
  liveSync?: boolean;
  liveConflicts?: { file: string; reason: string }[];
  following?: string;
  worktrees?: { id: string; path: string; branch: string; status: string }[];
  collaborativeFiles?: string[];
}
export const colors = [
  "#ed6798",
  "#54b5f8",
  "#33ccab",
  "#f4a64c",
  "#af91ec",
  "#80b7ac",
];
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
const extensionId = "HarshalDhaduk.lattice-sync";
export function inviteLink(relay: string, room: string, token: string) {
  return `vscode://${extensionId}/join?${new URLSearchParams({ relay, room, token })}`;
}
export function parseInvite(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "vscode:" ||
    u.hostname.toLowerCase() !== extensionId.toLowerCase() ||
    u.pathname !== "/join"
  )
    throw Error("Paste a Lattice session invite link.");
  const relay = u.searchParams.get("relay") || "",
    room = u.searchParams.get("room") || "",
    token = u.searchParams.get("token") || "";
  validateRelay(relay);
  if (!room || token.length < 16) throw Error("Incomplete invitation.");
  return { relay, room, token };
}
export function validateRelay(value: string) {
  const u = new URL(value);
  if (
    !["ws:", "wss:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error(
      "Use a ws:// or wss:// relay URL without credentials or query parameters.",
    );
  return u;
}
