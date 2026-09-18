import {
  readFile,
  writeFile,
  readdir,
  lstat,
  mkdir,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { SessionClient } from "../shared/client";
import {
  workspacePath,
  byteHash,
  MAX_WORKSPACE_FILE,
  MAX_WORKSPACE_FILES,
  MAX_WORKSPACE_BYTES,
  type WorkspaceFile,
} from "../shared/workspace";
import { git } from "./git";
export interface WorkspaceIO {
  read(file: string): Promise<Buffer | undefined>;
  write(
    file: string,
    bytes: Buffer | undefined,
    expected: string | null,
  ): Promise<void>;
}
export async function safeMirrorPath(root: string, file: string) {
  if (!workspacePath(file)) throw Error("Unsafe workspace path.");
  const base = await realpath(root);
  const full = join(base, file);
  const rel = relative(base, full);
  if (isAbsolute(rel) || rel.startsWith(".."))
    throw Error("Path escapes workspace.");
  let part = base;
  for (const segment of file.split("/")) {
    part = join(part, segment);
    const stat = await lstat(part).catch((e: any) => {
      if (e.code !== "ENOENT") throw e;
      return undefined;
    });
    if (stat?.isSymbolicLink()) throw Error(`Symlinks are not shared: ${file}`);
  }
  return full;
}
export class WorkspaceMirror {
  private baseline: Record<string, string> = Object.create(null);
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private pulling?: ReturnType<typeof setTimeout>;
  private ready = false;
  private applying = new Set<string>();
  private revision = -1;
  private offline = false;
  private pending = new Set<string>();
  readonly conflicts = new Map<string, string>();
  private listener = () => {
    const revision = this.client.session?.workspace?.revision;
    if (!this.ready) return;
    if (!this.client.connected || !this.enabled()) {
      this.offline = true;
      return;
    }
    const reconnect = this.offline;
    this.offline = false;
    if (!reconnect && (revision === undefined || revision === this.revision))
      return;
    clearTimeout(this.pulling);
    this.pulling = setTimeout(
      () =>
        void this.enqueue(() => this.pull())
          .then(() => {
            if (reconnect)
              for (const file of this.pending) void this.publish(file);
          })
          .catch((e) => this.notice(e.message)),
      80,
    );
  };
  constructor(
    readonly client: SessionClient,
    readonly root: string,
    private cache: string,
    private notice: (message: string) => void,
    private io?: WorkspaceIO,
    private enabled: () => boolean = () => true,
  ) {}
  resume() {
    this.offline = true;
    this.listener();
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.queue.then(() => {
      if (this.stopped) throw Error("Workspace closed.");
      return fn();
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private async save() {
    await mkdir(dirname(this.cache), { recursive: true });
    await writeFile(this.cache, JSON.stringify(this.baseline));
  }
  private async read(file: string) {
    const path = await safeMirrorPath(this.root, file);
    return this.io
      ? this.io.read(file)
      : readFile(path).catch((e: any) => {
          if (e.code !== "ENOENT") throw e;
          return undefined;
        });
  }
  async scan() {
    let files: string[];
    try {
      files = (
        await git(
          this.root,
          ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          true,
        )
      )
        .split("\0")
        .filter(Boolean);
    } catch {
      files = [];
      const visit = async (folder: string) => {
        for (const entry of await readdir(join(this.root, folder), {
          withFileTypes: true,
        })) {
          const file = folder ? `${folder}/${entry.name}` : entry.name;
          if (!workspacePath(file) || entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await visit(file);
          else if (entry.isFile()) files.push(file);
          if (files.length > MAX_WORKSPACE_FILES)
            throw Error("Workspace exceeds 2,000 eligible files.");
        }
      };
      await visit("");
    }
    return [...new Set(files)].filter(workspacePath);
  }
  async start(publishHost = false) {
    if (!this.client.capabilities.includes("workspace"))
      throw Error(
        "Update the session host and relay to Lattice Sync 0.4 or newer to load the live workspace.",
      );
    await mkdir(this.root, { recursive: true });
    try {
      this.baseline = Object.assign(
        Object.create(null),
        JSON.parse(await readFile(this.cache, "utf8")),
      );
    } catch {}
    const skipped: string[] = [];
    if (publishHost && !this.client.session?.workspace?.ready) {
      const files = await this.scan();
      const eligible: { file: string; bytes: Buffer }[] = [];
      let total = 0;
      for (const file of files) {
        let bytes: Buffer | undefined;
        try {
          bytes = await this.read(file);
        } catch {
          skipped.push(file + " (symlink or unreadable)");
          continue;
        }
        if (!bytes) continue;
        if (bytes.length > MAX_WORKSPACE_FILE) {
          skipped.push(file + " (over 512 KiB)");
          continue;
        }
        total += bytes.length;
        eligible.push({ file, bytes });
      }
      if (total > MAX_WORKSPACE_BYTES || eligible.length > MAX_WORKSPACE_FILES)
        throw Error("Live workspace exceeds 2,000 files / 32 MiB.");
      for (const { file, bytes } of eligible) {
        if (this.stopped) return;
        await this.client.request({
          op: "workspace.put",
          file,
          content: bytes.toString("base64"),
          before: this.baseline[file] || null,
        });
        this.baseline[file] = byteHash(bytes);
        await new Promise((r) => setTimeout(r, 22));
      }
      await this.save();
      await this.client.request({
        op: "workspace.ready",
        skipped: skipped.slice(0, 100),
      });
    }
    const deadline = Date.now() + 120000;
    while (!this.client.session?.workspace?.ready) {
      if (this.stopped || Date.now() > deadline)
        throw Error(
          "The host has not finished publishing its workspace. Ask them to keep the session open, then retry joining.",
        );
      await new Promise((r) => setTimeout(r, 300));
    }
    // Initial hydration must finish even when ongoing synchronization is paused.
    await this.pull(true);
    this.ready = true;
    this.client.on("state", this.listener);
    // A host may have changed files while the initial snapshot was downloading.
    this.listener();
    // Reconcile offline edits only against versions this mirror previously saw.
    if (
      this.client.session?.people.find(
        (p) => p.id === this.client.credentials?.personId,
      )?.role !== "viewer"
    )
      for (const file of new Set([
        ...(await this.scan()),
        ...Object.keys(this.baseline),
      ]))
        await this.publish(file);
  }
  publish(file: string) {
    if (
      !this.ready ||
      this.stopped ||
      this.applying.has(file) ||
      !workspacePath(file)
    )
      return Promise.resolve();
    this.pending.add(file);
    return this.enqueue(async () => {
      if (
        !this.client.connected ||
        !this.enabled() ||
        this.client.session?.people.find(
          (p) => p.id === this.client.credentials?.personId,
        )?.role === "viewer"
      )
        return;
      const ignored = await git(this.root, [
        "check-ignore",
        "--quiet",
        "--",
        file,
      ]).then(
        () => true,
        () => false,
      );
      if (ignored) {
        this.pending.delete(file);
        return;
      }
      const bytes = await this.read(file);
      if (bytes && bytes.length > MAX_WORKSPACE_FILE)
        throw Error(`Not shared: ${file} exceeds 512 KiB.`);
      const hash = bytes ? byteHash(bytes) : undefined;
      if (hash === this.baseline[file]) {
        this.pending.delete(file);
        return;
      }
      try {
        await this.client.request({
          op: "workspace.put",
          file,
          before: this.baseline[file] || null,
          content: bytes?.toString("base64") ?? null,
        });
        if (hash) this.baseline[file] = hash;
        else delete this.baseline[file];
        this.conflicts.delete(file);
        await this.save();
        this.pending.delete(file);
      } catch (e: any) {
        this.conflicts.set(file, e.message);
        throw e;
      }
    }).catch((e: any) => this.notice(e.message));
  }
  private async pull(hydrating = false) {
    if (!hydrating && !this.enabled()) {
      this.offline = true;
      return;
    }
    const index = await this.client.request({ op: "workspace.index" });
    if (!index.summary?.ready) return;
    const remote = new Map<string, { hash: string }>(
      index.files.map((f: WorkspaceFile) => [f.file, f]),
    );
    for (const file of new Set([
      ...Object.keys(this.baseline),
      ...remote.keys(),
    ])) {
      if (this.stopped) return;
      if (remote.get(file)?.hash === this.baseline[file]) continue;
      let local: Buffer | undefined;
      try {
        local = await this.read(file);
        const localHash = local ? byteHash(local) : undefined;
        // Keep bulk hydration below the relay's per-socket request limit.
        if (remote.has(file)) await new Promise((r) => setTimeout(r, 22));
        const next: WorkspaceFile | null = remote.has(file)
          ? await this.client.request({ op: "workspace.get", file })
          : null;
        if (localHash === next?.hash) {
          if (next) this.baseline[file] = next.hash;
          else delete this.baseline[file];
          this.conflicts.delete(file);
          continue;
        }
        if (localHash !== this.baseline[file])
          throw Error(
            `Local changes overlap with ${file}; your copy was preserved.`,
          );
        const path = await safeMirrorPath(this.root, file);
        const bytes = next ? Buffer.from(next.content, "base64") : undefined;
        if (next && byteHash(bytes!) !== next.hash)
          throw Error("Workspace checksum mismatch.");
        this.applying.add(file);
        try {
          if (this.io) await this.io.write(file, bytes, localHash || null);
          else if (bytes) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes);
          } else await rm(path, { force: true });
          if (next) this.baseline[file] = next.hash;
          else delete this.baseline[file];
          this.conflicts.delete(file);
        } finally {
          this.applying.delete(file);
        }
      } catch (e: any) {
        this.conflicts.set(file, e.message);
        this.notice(e.message);
        if (hydrating && !local)
          throw Error(
            `The workspace could not finish loading ${file}: ${e.message}. Retry joining.`,
          );
      }
    }
    this.revision = index.summary.revision;
    await this.save();
  }
  async flush() {
    await this.queue;
  }
  dispose() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.pulling);
    this.client.off("state", this.listener);
  }
}
