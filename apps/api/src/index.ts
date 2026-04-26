export interface Env {
  AI: Ai;
  DB: D1Database;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cf_ai_interview_coach" });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
};

