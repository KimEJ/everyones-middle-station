import type {
  NetworkLink,
  Station,
  StationId,
  TravelTimeAdapter,
  TravelTimeRequestOptions,
} from "./domain.ts"
import {
  InvalidNetworkDataError,
  RouteUnavailableError,
  TravelTimeLookupTimeoutError,
} from "./errors.ts"

type Neighbor = {
  readonly stationId: StationId
  readonly minutes: number
}

export class InMemoryTravelTimeAdapter implements TravelTimeAdapter {
  private readonly stationList: readonly Station[]
  private readonly stationByName = new Map<string, Station>()
  private readonly neighbors = new Map<StationId, readonly Neighbor[]>()

  constructor(stationList: readonly Station[], links: readonly NetworkLink[]) {
    this.stationList = stationList
    for (const station of stationList) {
      this.neighbors.set(station.id, [])
      for (const name of [station.name, ...station.aliases]) {
        const normalizedName = normalizeStationName(name)
        if (this.stationByName.has(normalizedName)) {
          throw new InvalidNetworkDataError(`중복 역 이름: ${name}`)
        }
        this.stationByName.set(normalizedName, station)
      }
    }

    for (const link of links) {
      this.addNeighbor(link.from, { stationId: link.to, minutes: link.minutes })
      this.addNeighbor(link.to, { stationId: link.from, minutes: link.minutes })
    }
  }

  listStations(): readonly Station[] {
    return this.stationList
  }

  resolveStation(name: string): Station | undefined {
    return this.stationByName.get(normalizeStationName(name))
  }

  async estimateMinutes(
    originId: StationId,
    destinationId: StationId,
    options?: TravelTimeRequestOptions,
  ): Promise<number> {
    if (options?.signal?.aborted) {
      throw new TravelTimeLookupTimeoutError()
    }
    if (originId === destinationId) {
      return 0
    }

    const distances = new Map<StationId, number>(
      this.stationList.map((station) => [station.id, Number.POSITIVE_INFINITY]),
    )
    distances.set(originId, 0)
    const visited = new Set<StationId>()

    while (visited.size < this.stationList.length) {
      let currentId: StationId | undefined
      let currentMinutes = Number.POSITIVE_INFINITY

      for (const station of this.stationList) {
        const stationMinutes = distances.get(station.id)
        if (stationMinutes === undefined) {
          throw new InvalidNetworkDataError(`거리 테이블에 없는 역: ${station.name}`)
        }
        if (!visited.has(station.id) && stationMinutes < currentMinutes) {
          currentId = station.id
          currentMinutes = stationMinutes
        }
      }

      if (currentId === undefined || currentMinutes === Number.POSITIVE_INFINITY) {
        break
      }
      if (currentId === destinationId) {
        return currentMinutes
      }

      visited.add(currentId)
      for (const neighbor of this.neighbors.get(currentId) ?? []) {
        if (visited.has(neighbor.stationId)) {
          continue
        }
        const knownMinutes = distances.get(neighbor.stationId)
        if (knownMinutes === undefined) {
          throw new InvalidNetworkDataError(`연결 대상이 없는 역: ${neighbor.stationId}`)
        }
        const proposedMinutes = currentMinutes + neighbor.minutes
        if (proposedMinutes < knownMinutes) {
          distances.set(neighbor.stationId, proposedMinutes)
        }
      }
    }

    throw new RouteUnavailableError(originId, destinationId)
  }

  private addNeighbor(stationId: StationId, neighbor: Neighbor): void {
    const currentNeighbors = this.neighbors.get(stationId)
    if (currentNeighbors === undefined) {
      throw new InvalidNetworkDataError(`연결 시작점이 없는 역: ${stationId}`)
    }
    this.neighbors.set(stationId, [...currentNeighbors, neighbor])
  }
}

function normalizeStationName(name: string): string {
  return name.replaceAll(" ", "").toLocaleLowerCase("ko-KR")
}
