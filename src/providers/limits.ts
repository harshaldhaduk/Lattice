/** Only terminal quota/usage failures qualify; transport/auth errors do not. */
export function isProviderLimit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(insufficient_quota|usage_limit_reached|rate_limit_exceeded)\b|(?:usage|spending|credit|token|rate)[ -]limit (?:reached|exceeded)|(?:exceeded|reached|hit) (?:your |the )?(?:usage|spending|credit|token|rate) limit|out of (?:usage|credits)|extra usage is disabled|rate limit rejected/i.test(
    message,
  );
}
