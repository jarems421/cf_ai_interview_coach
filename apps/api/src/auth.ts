import { requireString } from "./http";
import type { AuthUser, Env } from "./types";

export async function getRequestUser(
  _request: Request,
  _env: Env,
  clientIdValue: unknown
): Promise<AuthUser> {
  const clientId = requireString(clientIdValue, "clientId");

  return {
    id: clientId,
    email: null,
    name: null,
    authenticated: false
  };
}

export function getAuthLinks(_env: Env) {
  return {
    loginUrl: "/",
    logoutUrl: "/"
  };
}
