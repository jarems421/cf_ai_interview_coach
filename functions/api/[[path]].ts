// Same-origin proxy: the browser calls /api/* on the Pages domain (already behind
// Cloudflare Access) and this function forwards the request to the Worker API.
// Prefer the `API` service binding; fall back to `API_ORIGIN` (a Worker URL).
interface Env {
  API?: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN?: string;
}

export const onRequest = async ({
  request,
  env
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const url = new URL(request.url);

  try {
    if (env.API) {
      return await env.API.fetch(request);
    }

    if (env.API_ORIGIN) {
      const target = new URL(url.pathname + url.search, env.API_ORIGIN);
      return await fetch(new Request(target, request));
    }
  } catch {
    return Response.json(
      { error: "The API Worker could not be reached from Pages." },
      { status: 502 }
    );
  }

  return Response.json(
    {
      error:
        "API is not configured. Add an `API` service binding (or an `API_ORIGIN` variable) to the Pages project."
    },
    { status: 503 }
  );
};
