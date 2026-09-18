import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { initials, type Person } from "../shared/protocol";
export class PresenceAvatars {
  private cache = new Map<string, vscode.Uri>();
  private pending = new Set<string>();
  private disposed = false;
  constructor(
    private directory: string,
    private refresh: () => void,
  ) {}
  private key(p: Person, size: number) {
    return createHash("sha256")
      .update(p.name + p.color + (p.avatar || "") + size)
      .digest("hex")
      .slice(0, 20);
  }
  get(p: Person, size = 12) {
    const key = this.key(p, size);
    if (!this.cache.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      void this.prepare(p, key, size).finally(() => this.pending.delete(key));
    }
    return this.cache.get(key);
  }
  private async prepare(p: Person, key: string, size: number) {
    try {
      await mkdir(this.directory, { recursive: true });
      const name = initials(p.name).replace(
        /[<>&"']/g,
        (c) =>
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
          })[c]!,
      );
      let file = join(this.directory, key + ".svg");
      await writeFile(
        file,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="${p.color}"/><text x="10" y="13" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="600" fill="white">${name}</text></svg>`,
      );
      if (this.disposed) return;
      this.cache.set(key, vscode.Uri.file(file));
      this.refresh();
      if (p.avatar) {
        try {
          const u = new URL(p.avatar);
          if (
            u.hostname !== "avatars.githubusercontent.com" ||
            u.protocol !== "https:"
          )
            return;
          u.searchParams.set("s", "40");
          const response = await fetch(u, {
            signal: AbortSignal.timeout(4000),
          });
          if (
            !response.ok ||
            !/^image\/(png|jpeg|webp)/.test(
              response.headers.get("content-type") || "",
            )
          )
            return;
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 256000) return;
          file = join(this.directory, key + "-photo.svg");
          const mime = response.headers.get("content-type")!.split(";")[0];
          // VS Code's image attachment uses the asset's intrinsic dimensions.
          // Embed photos in a small circular SVG so they cannot enlarge a code line.
          await writeFile(
            file,
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20"><defs><clipPath id="circle"><circle cx="10" cy="10" r="10"/></clipPath></defs><image width="20" height="20" preserveAspectRatio="xMidYMid slice" clip-path="url(#circle)" href="data:${mime};base64,${bytes.toString("base64")}"/></svg>`,
          );
          if (!this.disposed) {
            this.cache.set(key, vscode.Uri.file(file));
            this.refresh();
          }
        } catch {}
      }
    } catch {}
  }
  dispose() {
    this.disposed = true;
  }
}
