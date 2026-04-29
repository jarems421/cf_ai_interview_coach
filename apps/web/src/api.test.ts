import { afterEach, describe, expect, it, vi } from "vitest";
import { parseResponse, streamChatMessage } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("reads streamed chat deltas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: delta\ndata: {"text":"Hello"}\n\nevent: done\ndata: {"reply":"Hello"}\n\n'
              )
            );
            controller.close();
          }
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" }
        });
      })
    );

    const deltas: string[] = [];
    await expect(
      streamChatMessage(
        {
          clientId: "browser-1",
          sessionId: "session-1",
          message: "hello"
        },
        (delta) => deltas.push(delta)
      )
    ).resolves.toEqual({ reply: "Hello" });
    expect(deltas).toEqual(["Hello"]);
  });
});
