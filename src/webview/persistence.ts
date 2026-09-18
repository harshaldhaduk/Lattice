export function readDraft(): string {
  try {
    return (
      (
        window.LATTICE_STORAGE?.getState() ||
        JSON.parse(sessionStorage.getItem("lattice-composer") || "{}")
      ).draft || ""
    );
  } catch {
    return "";
  }
}
export function saveDraft(draft: string) {
  const storage = window.LATTICE_STORAGE;
  if (storage) storage.setState({ ...storage.getState(), draft });
  else sessionStorage.setItem("lattice-composer", JSON.stringify({ draft }));
}
