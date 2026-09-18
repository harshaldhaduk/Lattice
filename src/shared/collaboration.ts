import * as Y from "yjs";
import { diffChars } from "diff";
import { contentHash } from "./files";

// Every peer starts with the same immutable seed. Subsequent edits use random
// Yjs client IDs, so concurrent inserts/deletes retain their distinct identities.
export function textDocument(content: string, state?: string) {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, Buffer.from(state, "base64"));
  else {
    const client = doc.clientID;
    doc.clientID = 1;
    doc.getText("source").insert(0, content);
    doc.clientID = client;
  }
  return doc;
}
export function encodeDocument(doc: Y.Doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}
export function replaceText(doc: Y.Doc, next: string) {
  const text = doc.getText("source");
  const changes = diffChars(text.toString(), next, { timeout: 1000 });
  if (!changes) throw Error("This edit is too large to merge interactively.");
  doc.transact(() => {
    let offset = 0;
    for (const change of changes) {
      if (change.removed) text.delete(offset, change.value.length);
      else {
        if (change.added) text.insert(offset, change.value);
        offset += change.value.length;
      }
    }
  });
}
export function textUpdate(before: string, after: string, state?: string) {
  const doc = textDocument(before, state);
  try {
    if (doc.getText("source").toString() !== before)
      throw Error("Local collaboration base no longer matches.");
    const vector = Y.encodeStateVector(doc);
    replaceText(doc, after);
    return {
      update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString(
        "base64",
      ),
      state: encodeDocument(doc),
    };
  } finally {
    doc.destroy();
  }
}
export function mergeText(base: string, update: string, state?: string) {
  const doc = textDocument(base, state);
  try {
    Y.applyUpdate(doc, Buffer.from(update, "base64"));
    doc.getText("source");
    if (
      doc.share.size !== 1 ||
      !doc.share.has("source") ||
      doc.store.pendingStructs ||
      doc.store.pendingDs
    )
      throw Error("Incomplete or unsupported collaborative update.");
    const content = doc.getText("source").toString();
    const crdtState = encodeDocument(doc);
    if (
      content.length > 32000 ||
      content.includes("\0") ||
      crdtState.length > 180000
    )
      throw Error(
        "Collaborative document limit reached. Start a new session to compact history.",
      );
    return { content, hash: contentHash(content), crdtState };
  } finally {
    doc.destroy();
  }
}
