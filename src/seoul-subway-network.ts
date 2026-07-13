import type { Station, StationId, TravelTimeAdapter, TravelTimeRequestOptions } from "./domain.ts"
import {
  AmbiguousStationError,
  InvalidNetworkDataError,
  RouteUnavailableError,
  TravelTimeLookupTimeoutError,
} from "./errors.ts"
import {
  loadSeoulSubwayData,
  type SeoulSubwayData,
  type TransitNodeId,
} from "./seoul-subway-data.ts"
import {
  buildSeoulSubwayNetworkIndex,
  normalizeStationName,
  type TransitNeighbor,
} from "./seoul-subway-index.ts"

export class SeoulSubwayTravelTimeAdapter implements TravelTimeAdapter {
  private readonly stationList: readonly Station[]
  private readonly stationByName: ReadonlyMap<string, Station>
  private readonly ambiguousStationNames: ReadonlyMap<string, readonly string[]>
  private readonly nodeIdsByStationId: ReadonlyMap<StationId, readonly TransitNodeId[]>
  private readonly neighbors: ReadonlyMap<TransitNodeId, readonly TransitNeighbor[]>
  private readonly distanceCache = new Map<StationId, Promise<ReadonlyMap<TransitNodeId, number>>>()

  constructor(data: SeoulSubwayData = loadSeoulSubwayData()) {
    const index = buildSeoulSubwayNetworkIndex(data)
    this.stationList = index.stationList
    this.stationByName = index.stationByName
    this.ambiguousStationNames = index.ambiguousStationNames
    this.nodeIdsByStationId = index.nodeIdsByStationId
    this.neighbors = index.neighbors
  }

  listStations(): readonly Station[] {
    return this.stationList
  }

  resolveStation(name: string): Station | undefined {
    const normalizedName = normalizeStationName(name)
    const candidates = this.ambiguousStationNames.get(normalizedName)
    if (candidates !== undefined) {
      throw new AmbiguousStationError(name, candidates)
    }
    return this.stationByName.get(normalizedName)
  }

  async estimateMinutes(
    originId: StationId,
    destinationId: StationId,
    options?: TravelTimeRequestOptions,
  ): Promise<number> {
    throwIfAborted(options?.signal)
    if (originId === destinationId) {
      return 0
    }

    const destinationNodeIds = this.nodeIdsByStationId.get(destinationId)
    if (destinationNodeIds === undefined) {
      throw new RouteUnavailableError(originId, destinationId)
    }

    const distances = await this.distancesFrom(originId)
    throwIfAborted(options?.signal)
    const minutes = Math.min(
      ...destinationNodeIds.map((nodeId) => distances.get(nodeId) ?? Number.POSITIVE_INFINITY),
    )
    if (minutes === Number.POSITIVE_INFINITY) {
      throw new RouteUnavailableError(originId, destinationId)
    }
    return minutes
  }

  private distancesFrom(originId: StationId): Promise<ReadonlyMap<TransitNodeId, number>> {
    const cached = this.distanceCache.get(originId)
    if (cached !== undefined) {
      return cached
    }
    const pending = Promise.resolve().then(() => this.calculateDistances(originId))
    this.distanceCache.set(originId, pending)
    return pending
  }

  private calculateDistances(originId: StationId): ReadonlyMap<TransitNodeId, number> {
    const originNodeIds = this.nodeIdsByStationId.get(originId)
    if (originNodeIds === undefined) {
      throw new RouteUnavailableError(originId, originId)
    }

    const distances = new Map<TransitNodeId, number>(
      [...this.neighbors.keys()].map((nodeId) => [nodeId, Number.POSITIVE_INFINITY]),
    )
    for (const nodeId of originNodeIds) {
      distances.set(nodeId, 0)
    }
    const visited = new Set<TransitNodeId>()

    while (visited.size < distances.size) {
      const current = nextUnvisitedNode(distances, visited)
      if (current === undefined) {
        break
      }
      visited.add(current.nodeId)
      for (const neighbor of this.neighbors.get(current.nodeId) ?? []) {
        if (visited.has(neighbor.nodeId)) {
          continue
        }
        const known = distances.get(neighbor.nodeId)
        if (known === undefined) {
          throw new InvalidNetworkDataError(`연결 대상이 없는 역 노드: ${neighbor.nodeId}`)
        }
        const proposed = current.minutes + neighbor.minutes
        if (proposed < known) {
          distances.set(neighbor.nodeId, proposed)
        }
      }
    }
    return distances
  }
}

export function createSeoulSubwayTravelTimeAdapter(): SeoulSubwayTravelTimeAdapter {
  return new SeoulSubwayTravelTimeAdapter()
}

function nextUnvisitedNode(
  distances: ReadonlyMap<TransitNodeId, number>,
  visited: ReadonlySet<TransitNodeId>,
): { readonly nodeId: TransitNodeId; readonly minutes: number } | undefined {
  let candidate: TransitNodeId | undefined
  let minutes = Number.POSITIVE_INFINITY
  for (const [nodeId, value] of distances) {
    if (!visited.has(nodeId) && value < minutes) {
      candidate = nodeId
      minutes = value
    }
  }
  return candidate === undefined ? undefined : { nodeId: candidate, minutes }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new TravelTimeLookupTimeoutError()
  }
}
