import { useEffect, useState } from "react";

// VS Code can request reduced motion independently of the OS preference.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.body.classList.contains("vscode-reduce-motion"),
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () =>
      setReduced(
        media.matches ||
          document.body.classList.contains("vscode-reduce-motion"),
      );
    const observer = new MutationObserver(update);
    media.addEventListener("change", update);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    update();
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return reduced;
}
