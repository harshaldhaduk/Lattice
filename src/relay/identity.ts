import type { Person } from "../shared/protocol";
export type Identity = NonNullable<Person["identity"]>;
export async function verifyGithub(
  token: string,
  organization?: string,
): Promise<Identity> {
  if (!token || token.length > 1000)
    throw Error("Sign in to GitHub to use this relay.");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "lattice",
  };
  const response = await fetch("https://api.github.com/user", {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw Error("GitHub sign-in was rejected. Reconnect your account.");
  const user = (await response.json()) as { id: number; login: string };
  if (!Number.isSafeInteger(user.id) || !user.login)
    throw Error("Invalid GitHub identity.");
  if (organization) {
    const membership = await fetch(
      `https://api.github.com/user/memberships/orgs/${encodeURIComponent(organization)}`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (
      !membership.ok ||
      ((await membership.json()) as { state: string }).state !== "active"
    )
      throw Error(`Active membership of ${organization} is required.`);
  }
  return { id: String(user.id), login: user.login, provider: "github" };
}
