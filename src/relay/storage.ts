import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
  fsyncSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";

export class SessionStore {
  private key?: Buffer;
  constructor(
    private directory: string,
    encryptionKey?: string,
  ) {
    if (encryptionKey) {
      this.key = Buffer.from(encryptionKey, "hex");
      if (!/^[a-f\d]{64}$/i.test(encryptionKey))
        throw Error("LATTICE_STORAGE_KEY must contain 64 hex characters.");
    }
  }
  read(): unknown[] {
    const raw = JSON.parse(
      readFileSync(join(this.directory, "sessions.json"), "utf8"),
    );
    if (Array.isArray(raw)) {
      if (this.key)
        throw Error(
          "Existing storage is unencrypted. Export it and migrate explicitly before enabling encryption.",
        );
      return raw;
    }
    // The authenticated format tag may carry a previous product prefix.
    // Keep its original bytes as AAD when reading; writes use the current tag.
    if (
      typeof raw.format !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}-aes256gcm-v1$/.test(raw.format) ||
      !this.key
    )
      throw Error("An encrypted store requires its original storage key.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(raw.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
    decipher.setAAD(Buffer.from(raw.format));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(raw.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  write(rooms: unknown[]) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    let value = JSON.stringify(rooms);
    if (this.key) {
      const iv = randomBytes(12),
        format = "lattice-aes256gcm-v1";
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(format));
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      value = JSON.stringify({
        format,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      });
    }
    const file = join(this.directory, "sessions.json");
    const temporary = file + ".tmp";
    writeFileSync(temporary, value, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    const fd = openSync(temporary, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(file)) {
      copyFileSync(file, file + ".backup");
      chmodSync(file + ".backup", 0o600);
    }
    renameSync(temporary, file);
  }
}
