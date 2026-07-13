import { describe, expect, it } from "vitest"

import { AmbiguousStationError, InvalidNetworkDataError } from "../src/errors.ts"
import { MeetingAreaService } from "../src/meeting-service.ts"
import { loadSeoulSubwayData, parseSeoulSubwayData } from "../src/seoul-subway-data.ts"
import { buildSeoulSubwayNetworkIndex } from "../src/seoul-subway-index.ts"
import { createSeoulSubwayTravelTimeAdapter } from "../src/seoul-subway-network.ts"

describe("SeoulSubwayTravelTimeAdapter", () => {
  it("loads the imported Discover Seoul subway topology as public station groups", () => {
    // Given
    const adapter = createSeoulSubwayTravelTimeAdapter()

    // When
    const stations = adapter.listStations()

    // Then
    expect(stations).toHaveLength(657)
    expect(adapter.resolveStation("강남역")?.name).toBe("강남역")
    expect(adapter.resolveStation("수원역")?.name).toBe("수원역")
    expect(adapter.resolveStation("일산역")?.name).toBe("일산역")
  })

  it("preserves the DB line label for the 9호선 노들 station node", () => {
    // Given
    const data = loadSeoulSubwayData()

    // When
    const node = data.nodes.find((candidate) => candidate.id === "station:9호선:4118")

    // Then
    expect(node?.name).toBe("노들")
    expect(node?.line).toBe("9호선")
    expect(data.nodes.some((candidate) => candidate.line.includes("\uFFFD"))).toBe(false)
  })

  it("rejects duplicate node IDs, dangling edges, and incorrect edge weights", () => {
    // Given
    const data = loadSeoulSubwayData()
    const firstNode = data.nodes.at(0)
    const secondNode = data.nodes.at(1)
    const firstEdge = data.edges.at(0)
    if (firstNode === undefined || secondNode === undefined || firstEdge === undefined) {
      throw new Error("Expected the imported subway data to contain nodes and edges")
    }
    const duplicateNodeId = {
      ...data,
      nodes: data.nodes.map((node) =>
        node.id === secondNode.id ? { ...node, id: firstNode.id } : node,
      ),
    }
    const danglingEdge = {
      ...data,
      edges: data.edges.map((edge) =>
        edge === firstEdge ? { ...edge, to: "station:missing" } : edge,
      ),
    }
    const incorrectWeight = {
      ...data,
      edges: data.edges.map((edge) => (edge === firstEdge ? { ...edge, minutes: 3 } : edge)),
    }

    // Then
    expect(() => parseSeoulSubwayData(duplicateNodeId)).toThrow(InvalidNetworkDataError)
    expect(() => parseSeoulSubwayData(danglingEdge)).toThrow(InvalidNetworkDataError)
    expect(() => parseSeoulSubwayData(incorrectWeight)).toThrow(InvalidNetworkDataError)
  })

  it("requires a line-qualified name for physically separate stations with the same name", () => {
    // Given
    const adapter = createSeoulSubwayTravelTimeAdapter()

    // Then
    expect(() => adapter.resolveStation("양평역")).toThrow(AmbiguousStationError)
    expect(() => adapter.resolveStation("양평")).toThrow(AmbiguousStationError)
    expect(adapter.resolveStation("양평역 (5호선)")?.name).toBe("양평역 (5호선)")
    expect(adapter.resolveStation("양평역 (경의중앙선)")?.name).toBe("양평역 (경의중앙선)")
    expect(adapter.resolveStation("서울")?.name).toBe("서울역 (GTX-A)")
    expect(adapter.resolveStation("서울 (GTX-A)")?.name).toBe("서울역 (GTX-A)")
  })

  it("does not register a station alias that conflicts with an ambiguity error", () => {
    // Given
    const index = buildSeoulSubwayNetworkIndex(loadSeoulSubwayData())

    // Then
    const conflictingNames = [...index.stationByName.keys()].filter((name) =>
      index.ambiguousStationNames.has(name),
    )
    expect(conflictingNames).toEqual([])
  })

  it("calculates a transfer-aware route from the imported line graph", async () => {
    // Given
    const adapter = createSeoulSubwayTravelTimeAdapter()
    const gangnam = adapter.resolveStation("강남역")
    const hongdae = adapter.resolveStation("홍대입구역")
    expect(gangnam).toBeDefined()
    expect(hongdae).toBeDefined()
    if (gangnam === undefined || hongdae === undefined) {
      return
    }

    // When
    const minutes = await adapter.estimateMinutes(gangnam.id, hongdae.id)

    // Then
    expect(minutes).toBe(34)
  })

  it("omits disconnected automatic candidates instead of failing the recommendation", async () => {
    // Given
    const service = new MeetingAreaService(createSeoulSubwayTravelTimeAdapter())

    // When
    const candidates = await service.findAreas({
      originNames: ["강남역", "수원역", "일산역"],
      maxCandidates: 3,
    })

    // Then
    expect(candidates).toHaveLength(3)
    expect(candidates.map((candidate) => candidate.station)).not.toContain("신길온천역")
    expect(candidates.every((candidate) => candidate.travelTimes.length === 3)).toBe(true)
  })
})
