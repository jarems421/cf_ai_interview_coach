import { HttpError, requireString } from "./http";
import type { AuthUser, Env } from "./types";

type AccessCerts = {
  keys?: AccessJwk[];
};

type AccessJwk = JsonWebKey & {
  kid?: string;
};

type AccessClaims = {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
};

const accessJwtHeader = "cf-access-jwt-assertion";
const accessJwtCookie = "CF_Authorization";
const certCacheTtlMs = 10 * 60 * 1000;
const certCache = new Map<string, { keys: AccessJwk[]; expiresAt: number }>();

function getAuthMode(env: Env) {
  if (env.AUTH_MODE === "access" || env.AUTH_MODE === "development") {
    return env.AUTH_MODE;
  }

  return env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD ? "access" : "development";
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJsonPart<T>(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return "";
  }

  const value =
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? "";

  return value ? decodeURIComponent(value) : "";
}

function getAccessToken(request: Request) {
  return (
    request.headers.get(accessJwtHeader) ??
    getCookie(request, accessJwtCookie) ??
    ""
  );
}

function normalizeTeamDomain(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function hasAudience(claimAudience: unknown, expectedAudience: string) {
  if (typeof claimAudience === "string") {
    return claimAudience === expectedAudience;
  }

  return (
    Array.isArray(claimAudience) &&
    claimAudience.some((audience) => audience === expectedAudience)
  );
}

async function fetchAccessKeys(teamDomain: string) {
  const cached = certCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new HttpError(401, "Could not load Cloudflare Access signing keys.");
  }

  const certs = (await response.json()) as AccessCerts;
  const keys = certs.keys ?? [];
  certCache.set(teamDomain, {
    keys,
    expiresAt: Date.now() + certCacheTtlMs
  });
  return keys;
}

async function verifyAccessJwt(input: {
  token: string;
  teamDomain: string;
  audience: string;
  nowSeconds?: number;
}) {
  const parts = input.token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Missing or invalid Cloudflare Access token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: Partial<JsonWebKey> & { alg?: string; kid?: string };
  let claims: AccessClaims;

  try {
    header = decodeJsonPart(encodedHeader);
    claims = decodeJsonPart(encodedPayload);
  } catch {
    throw new HttpError(401, "Cloudflare Access token could not be decoded.");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new HttpError(401, "Unsupported Cloudflare Access token.");
  }

  const key = (await fetchAccessKeys(input.teamDomain)).find(
    (candidate) => candidate.kid === header.kid
  );
  if (!key) {
    throw new HttpError(401, "Cloudflare Access signing key was not found.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!verified) {
    throw new HttpError(401, "Cloudflare Access token signature is invalid.");
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) {
    throw new HttpError(401, "Cloudflare Access token has expired.");
  }

  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds) {
    throw new HttpError(401, "Cloudflare Access token is not active yet.");
  }

  if (claims.iss !== input.teamDomain) {
    throw new HttpError(401, "Cloudflare Access token issuer is invalid.");
  }

  if (!hasAudience(claims.aud, input.audience)) {
    throw new HttpError(401, "Cloudflare Access token audience is invalid.");
  }

  if (typeof claims.sub !== "string" || !claims.sub.trim()) {
    throw new HttpError(401, "Cloudflare Access token is missing a subject.");
  }

  return claims;
}

export async function getRequestUser(
  request: Request,
  env: Env,
  clientIdValue: unknown
): Promise<AuthUser> {
  if (getAuthMode(env) === "development") {
    const clientId = requireString(clientIdValue, "clientId");

    return {
      id: clientId,
      email: null,
      name: null,
      authenticated: false
    };
  }

  const teamDomain = normalizeTeamDomain(
    requireString(env.ACCESS_TEAM_DOMAIN, "ACCESS_TEAM_DOMAIN")
  );
  const audience = requireString(env.ACCESS_AUD, "ACCESS_AUD");
  const token = getAccessToken(request);
  if (!token) {
    throw new HttpError(401, "Sign in with Cloudflare Access to continue.");
  }

  const claims = await verifyAccessJwt({
    token,
    teamDomain,
    audience
  });
  const email = typeof claims.email === "string" ? claims.email : null;
  const name = typeof claims.name === "string" ? claims.name : email;

  return {
    id: `access:${claims.sub}`,
    email,
    name,
    authenticated: true
  };
}

export function getAuthLinks(env: Env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN
    ? normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN)
    : "";

  return {
    loginUrl: teamDomain ? `${teamDomain}/cdn-cgi/access/login` : "/",
    logoutUrl: teamDomain ? `${teamDomain}/cdn-cgi/access/logout` : "/"
  };
}

export const authTestExports = {
  certCache,
  decodeBase64Url,
  getAuthMode,
  getAccessToken,
  normalizeTeamDomain,
  verifyAccessJwt
};
