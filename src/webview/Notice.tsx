import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "./motion";

// Keep only the visual shell for a short exit. Dismissed actions become inert
// immediately; a replacement error cancels the pending removal.
export function Notice({
  message,
  className,
  dismiss,
}: {
  message?: string;
  className: string;
  dismiss: () => void;
}) {
  const [lastMessage, setLastMessage] = useState(message);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (message || reduced) {
      setLastMessage(message);
      return;
    }
    const timer = window.setTimeout(() => setLastMessage(undefined), 160);
    return () => window.clearTimeout(timer);
  }, [message, reduced]);
  if (!message && (!lastMessage || reduced)) return null;
  return (
    <div
      className={`${className} motion-notice`}
      data-exiting={!message || undefined}
      role={message ? "alert" : undefined}
      aria-hidden={!message || undefined}
      inert={!message}
    >
      <span>{message || lastMessage}</span>
      <button
        className="icon-button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
