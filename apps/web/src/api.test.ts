import { describe, expect, it } from "vitest";
import { parseResponse } from "./api";

describe("api client", () => {
  it("explains when the API returns a Cloudflare Access page", async () => {
    const response = new Response("<!DOCTYPE html><title>Sign in</title>", {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });

    await expect(parseResponse(response)).rejects.toThrow(
      "sign-in page instead of app data"
    );
  });

  it("uses server errors from JSON responses", async () => {
    const response = Response.json(
      { error: "Session not found." },
      { status: 404 }
    );

    await expect(parseResponse(response)).rejects.toThrow("Session not found.");
  });
});
