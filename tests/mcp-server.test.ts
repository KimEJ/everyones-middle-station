import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"

import type { TravelTimeAdapter } from "../src/domain.ts"
import { createMcpServer } from "../src/mcp-server.ts"
import { createSampleTravelTimeAdapter } from "../src/sample-network.ts"
import { createSeoulSubwayTravelTimeAdapter } from "../src/seoul-subway-network.ts"

describe("MCP server tools", () => {
  it("lists all three tools and returns structured meeting candidates", async () => {
    // Given
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(createSampleTravelTimeAdapter())
    await server.connect(serverTransport)
    const client = new Client({ name: "test-client", version: "0.1.0" })
    await client.connect(clientTransport)

    try {
      // When
      const tools = await client.listTools()
      const result = await client.callTool({
        name: "find_fair_meeting_areas",
        arguments: { origins: ["강남역", "수원역", "일산역"], max_candidates: 3 },
      })

      // Then
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "find_fair_meeting_areas",
          "compare_meeting_areas",
          "explain_fairness_score",
        ]),
      )
      const toolsByName = new Map(tools.tools.map((tool) => [tool.name, tool]))
      for (const toolName of [
        "find_fair_meeting_areas",
        "compare_meeting_areas",
        "explain_fairness_score",
      ]) {
        const tool = toolsByName.get(toolName)
        expect(tool?.description).toContain("모두의 중간역")
        expect(tool?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        })
      }
      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toMatchObject({
        algorithm: "그래프 기반 최단시간 추정",
      })
      expect(JSON.stringify(result.structuredContent)).toContain('"fairness_score"')
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("returns a handled tool error for an unsupported station", async () => {
    // Given
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(createSampleTravelTimeAdapter())
    await server.connect(serverTransport)
    const client = new Client({ name: "test-client", version: "0.1.0" })
    await client.connect(clientTransport)

    try {
      // When
      const result = await client.callTool({
        name: "find_fair_meeting_areas",
        arguments: { origins: ["강남역", "없는역"] },
      })

      // Then
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        error: { code: "UnknownStationError" },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("returns a handled tool error for an ambiguous station name in the DB graph", async () => {
    // Given
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(createSeoulSubwayTravelTimeAdapter())
    await server.connect(serverTransport)
    const client = new Client({ name: "test-client", version: "0.1.0" })
    await client.connect(clientTransport)

    try {
      // When
      const result = await client.callTool({
        name: "find_fair_meeting_areas",
        arguments: { origins: ["양평역", "강남역"] },
      })

      // Then
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        error: { code: "AmbiguousStationError" },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("aborts adapter work when a MCP client cancels before the server deadline", async () => {
    // Given
    const sampleAdapter = createSampleTravelTimeAdapter()
    const serverDeadline = new AbortController()
    const clientCancellation = new AbortController()
    const adapterStarted = Promise.withResolvers<void>()
    const cancellationObserved = Promise.withResolvers<void>()
    let receivedSignal: AbortSignal | undefined
    const hangingAdapter: TravelTimeAdapter = {
      listStations: () => sampleAdapter.listStations(),
      resolveStation: (name) => sampleAdapter.resolveStation(name),
      estimateMinutes: (_originId, _destinationId, options) => {
        const signal = options?.signal
        receivedSignal = signal
        adapterStarted.resolve()
        return new Promise<number>((_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error("Expected a request abort signal"))
            return
          }
          if (signal.aborted) {
            cancellationObserved.resolve()
            reject(signal.reason)
            return
          }
          signal.addEventListener(
            "abort",
            () => {
              cancellationObserved.resolve()
              reject(signal.reason)
            },
            { once: true },
          )
        })
      },
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(hangingAdapter, serverDeadline.signal)
    await server.connect(serverTransport)
    const client = new Client({ name: "test-client", version: "0.1.0" })
    await client.connect(clientTransport)

    try {
      const toolCallOutcome = client
        .callTool(
          {
            name: "find_fair_meeting_areas",
            arguments: { origins: ["강남역", "수원역"], max_candidates: 1 },
          },
          undefined,
          { signal: clientCancellation.signal },
        )
        .then(
          () => "fulfilled" as const,
          () => "rejected" as const,
        )
      await adapterStarted.promise

      // When
      clientCancellation.abort()
      await Promise.resolve()

      // Then
      expect(receivedSignal?.aborted).toBe(true)
      await cancellationObserved.promise
      expect(await toolCallOutcome).toBe("rejected")
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("explains the full-precision calculation behind displayed penalty values", async () => {
    // Given
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(createSampleTravelTimeAdapter())
    await server.connect(serverTransport)
    const client = new Client({ name: "test-client", version: "0.1.0" })
    await client.connect(clientTransport)

    try {
      // When
      const result = await client.callTool({
        name: "explain_fairness_score",
        arguments: { average_minutes: 14, max_difference_minutes: 31 },
      })

      // Then
      expect(result.structuredContent).toMatchObject({
        formula: "round(max(0, 100 - raw_efficiency_penalty - raw_imbalance_penalty), 1)",
        example: { fairness_score: 49.3, efficiency_penalty: 9.3, imbalance_penalty: 41.3 },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
