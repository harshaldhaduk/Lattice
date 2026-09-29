import React, { useLayoutEffect, useState } from "react";
import { useReducedMotion } from "./motion";

// Retain a dismissed dialog only for its visual exit, never for interaction.
// Reopening during the exit cancels removal and uses the new dialog's content.
export function ModalPresence({
  children,
}: {
  children:
    React.ReactElement<{ leaving?: boolean }> | false | null | undefined;
}) {
  const reduced = useReducedMotion();
  const [last, setLast] = useState(children);
  useLayoutEffect(() => {
    if (children || reduced) {
      setLast(children);
      return;
    }
    const timeout = window.setTimeout(() => setLast(null), 160);
    return () => window.clearTimeout(timeout);
  }, [children, reduced]);
  if (children) return children;
  if (!last || reduced) return null;
  return React.cloneElement(last, { leaving: true });
}
