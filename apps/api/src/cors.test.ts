import { afterAll, describe, expect, it } from "vitest";
import { app } from "./app.js";

const server = app.listen(0);
const listening = new Promise<void>(resolve => server.once("listening", resolve));

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("CORS configuration", () => {
  it("allows the configured local frontend and credentialed requests", async () => {
    await listening;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
