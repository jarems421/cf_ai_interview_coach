export function corsHeaders(request?: Request) {
  const origin = request?.headers.get("Origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export function json(data: unknown, init: ResponseInit = {}, request?: Request) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders(request),
      ...(init.headers ?? {})
    }
  });
}

export function noContent(request?: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function requireString(value: unknown, name: string, maxLength = 240) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${name} is required.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${name} must be ${maxLength} characters or less.`);
  }

  return trimmed;
}

export function optionalString(value: unknown, name: string, maxLength = 240) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${name} must be ${maxLength} characters or less.`);
  }

  return trimmed;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
