import type { Server } from "node:http"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { describe, expect, it } from "vitest"
import type { TravelTimeAdapter } from "../src/domain.ts"
import type { HttpSecurityOptions } from "../src/http-security.ts"
import { createMcpHttpServer } from "../src/http-server.ts"
import { createSampleTravelTimeAdapter } from "../src/sample-network.ts"
import { StreamableHttpClientTransportAdapter } from "../src/streamable-http-client-transport.ts"
import { createHangingAdapter } from "./http-test-helpers.ts"

const TEST_SECURITY = {
  allowedHostnames: ["127.0.0.1"],
  allowedOrigins: [],
  maxBodyBytes: 262_144,
  maxConcurrentRequests: 5,
  requestTimeoutMs: 30_000,
} as const satisfies HttpSecurityOptions

type RunningServer = {
  readonly server: Server
  readonly endpoint: URL
}

describe("Streamable HTTP transport", () => {
  it("serves an MCP tool call through a real local HTTP connection", async () => {
    // Given
    const runningServer = await startTestServer(TEST_SECURITY)
    const client = new Client({ name: "http-test-client", version: "0.1.0" })
    const transport = new StreamableHttpClientTransportAdapter(runningServer.endpoint)

    try {
      // When
      await client.connect(transport)
      const result = await client.callTool({
        name: "explain_fairness_score",
        arguments: { average_minutes: 30, max_difference_minutes: 15 },
      })

      // Then
      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toMatchObject({
        example: { fairness_score: 60, efficiency_penalty: 20, imbalance_penalty: 20 },
      })
    } finally {
      await client.close()
      await closeTestServer(runningServer.server)
    }
  })

  it("accepts a managed gateway host when the deployment wildcard is configured", async () => {
    // Given
    const runningServer = await startTestServer({ ...TEST_SECURITY, allowedHostnames: ["*"] })

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          host: "managed-gateway.playmcp.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "gateway-host-request",
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "gateway-host-test-client", version: "0.1.0" },
          },
        }),
      })

      // Then
      expect(response.status).toBe(200)
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("rejects a browser origin that is not explicitly allowed", async () => {
    // Given
    const runningServer = await startTestServer(TEST_SECURITY)

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: "{}",
      })

      // Then
      expect(response.status).toBe(403)
      expect(await response.text()).toContain("Request origin is not allowed")
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("serves CORS preflight for an explicitly allowed browser origin", async () => {
    // Given
    const runningServer = await startTestServer({
      ...TEST_SECURITY,
      allowedOrigins: ["https://app.example"],
    })

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example",
          "access-control-request-method": "POST",
        },
      })

      // Then
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example")
      expect(await response.text()).toBe("")
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("includes CORS headers on an allowed MCP POST response", async () => {
    // Given
    const runningServer = await startTestServer({
      ...TEST_SECURITY,
      allowedOrigins: ["https://app.example"],
    })

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "initialize-request",
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "cors-test-client", version: "0.1.0" },
          },
        }),
      })

      // Then
      expect(response.status).toBe(200)
      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example")
      expect(response.headers.get("vary")).toBe("Origin")
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("rejects an oversized JSON-RPC request before MCP dispatch", async () => {
    // Given
    const runningServer = await startTestServer({ ...TEST_SECURITY, maxBodyBytes: 64 })

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(80) }),
      })

      // Then
      expect(response.status).toBe(413)
      expect(await response.text()).toContain("Request body is too large")
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("rejects a JSON-RPC batch to keep request fan-out bounded", async () => {
    // Given
    const runningServer = await startTestServer(TEST_SECURITY)

    try {
      // When
      const response = await fetch(runningServer.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      })

      // Then
      expect(response.status).toBe(400)
      expect(await response.text()).toContain("Batch requests are not supported")
    } finally {
      await closeTestServer(runningServer.server)
    }
  })

  it("returns a handled timeout and aborts a cancellation-aware adapter", async () => {
    // Given
    const hangingAdapter = createHangingAdapter()
    const runningServer = await startTestServer(
      { ...TEST_SECURITY, requestTimeoutMs: 100 },
      hangingAdapter,
    )
    const client = new Client({ name: "timeout-test-client", version: "0.1.0" })
    const transport = new StreamableHttpClientTransportAdapter(runningServer.endpoint)

    try {
      // When
      await client.connect(transport)
      const result = await client.callTool({
        name: "find_fair_meeting_areas",
        arguments: { origins: ["강남역", "수원역"], max_candidates: 1 },
      })

      // Then
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        error: { code: "TravelTimeLookupTimeoutError" },
      })
    } finally {
      await client.close()
      await closeTestServer(runningServer.server)
    }
  })

  it("aborts a cancellation-aware adapter when the HTTP client disconnects", async () => {
    // Given
    let resolveEstimateStarted: (() => void) | undefined
    const estimateStarted = new Promise<void>((resolve) => {
      resolveEstimateStarted = resolve
    })
    let resolveAdapterAborted: (() => void) | undefined
    const adapterAborted = new Promise<void>((resolve) => {
      resolveAdapterAborted = resolve
    })
    const runningServer = await startTestServer(
      { ...TEST_SECURITY, requestTimeoutMs: 1_000 },
      createHangingAdapter({
        onEstimateStarted: () => resolveEstimateStarted?.(),
        onAbort: () => resolveAdapterAborted?.(),
      }),
    )
    const clientAbort = new AbortController()

    try {
      // When
      const requestOutcome = fetch(runningServer.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "disconnect-request",
          method: "tools/call",
          params: {
            name: "find_fair_meeting_areas",
            arguments: { origins: ["강남역", "수원역"], max_candidates: 1 },
          },
        }),
        signal: clientAbort.signal,
      }).then(
        () => "completed",
        () => "aborted",
      )
      await estimateStarted
      clientAbort.abort()
      const adapterAbortedPromptly = await Promise.race([
        adapterAborted.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
      ])

      // Then
      expect(await requestOutcome).toBe("aborted")
      expect(adapterAbortedPromptly).toBe(true)
    } finally {
      await closeTestServer(runningServer.server)
    }
  })
})

async function startTestServer(
  security: HttpSecurityOptions,
  travelTimeAdapter: TravelTimeAdapter = createSampleTravelTimeAdapter(),
): Promise<RunningServer> {
  const server = createMcpHttpServer({
    travelTimeAdapter,
    security,
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await closeTestServer(server)
    throw new Error("HTTP test server did not expose a TCP port")
  }
  return { server, endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`) }
}

function closeTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}
