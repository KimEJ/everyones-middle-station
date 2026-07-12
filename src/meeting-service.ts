import type { Station, TravelTimeAdapter } from "./domain.ts"
import { TravelTimeLookupTimeoutError, UnknownStationError } from "./errors.ts"
import { calculateFairnessScore, type FairnessBreakdown, roundToOneDecimal } from "./fairness.ts"

export type FindMeetingAreasRequest = {
  readonly originNames: readonly string[]
  readonly maxCandidates: number
  readonly candidateNames?: readonly string[]
}

export type CompareMeetingAreasRequest = {
  readonly originNames: readonly string[]
  readonly candidateNames: readonly string[]
}

export type TravelTimeEstimate = {
  readonly origin: string
  readonly minutes: number
}

export type MeetingAreaCandidate = {
  readonly station: string
  readonly travelTimes: readonly TravelTimeEstimate[]
  readonly averageMinutes: number
  readonly maxDifferenceMinutes: number
  readonly fairness: FairnessBreakdown
}

type Origin = {
  readonly requestedName: string
  readonly station: Station
}

const MAX_CONCURRENT_TRAVEL_TIME_LOOKUPS = 6

export class MeetingAreaService {
  private readonly travelTimeAdapter: TravelTimeAdapter

  constructor(travelTimeAdapter: TravelTimeAdapter) {
    this.travelTimeAdapter = travelTimeAdapter
  }

  async findAreas(
    request: FindMeetingAreasRequest,
    signal?: AbortSignal,
  ): Promise<readonly MeetingAreaCandidate[]> {
    const origins = this.resolveOrigins(request.originNames)
    const candidates =
      request.candidateNames === undefined
        ? this.travelTimeAdapter.listStations()
        : this.resolveStations(request.candidateNames)

    return (await this.evaluate(origins, candidates, signal)).slice(0, request.maxCandidates)
  }

  async compareAreas(
    request: CompareMeetingAreasRequest,
    signal?: AbortSignal,
  ): Promise<readonly MeetingAreaCandidate[]> {
    return this.evaluate(
      this.resolveOrigins(request.originNames),
      this.resolveStations(request.candidateNames),
      signal,
    )
  }

  private resolveOrigins(originNames: readonly string[]): readonly Origin[] {
    return originNames.map((requestedName) => ({
      requestedName,
      station: this.resolveStation(requestedName),
    }))
  }

  private resolveStations(stationNames: readonly string[]): readonly Station[] {
    const stationsById = new Map<Station["id"], Station>()
    for (const stationName of stationNames) {
      const station = this.resolveStation(stationName)
      if (!stationsById.has(station.id)) {
        stationsById.set(station.id, station)
      }
    }
    return [...stationsById.values()]
  }

  private resolveStation(stationName: string): Station {
    const station = this.travelTimeAdapter.resolveStation(stationName)
    if (station === undefined) {
      throw new UnknownStationError(stationName)
    }
    return station
  }

  private async evaluate(
    origins: readonly Origin[],
    candidates: readonly Station[],
    signal: AbortSignal | undefined,
  ): Promise<readonly MeetingAreaCandidate[]> {
    const estimateTasks = candidates.flatMap((candidate) =>
      origins.map((origin, originIndex) => ({ candidate, origin, originIndex })),
    )
    const estimates = await mapWithConcurrency(
      estimateTasks,
      MAX_CONCURRENT_TRAVEL_TIME_LOOKUPS,
      async (task) => ({
        candidateId: task.candidate.id,
        originIndex: task.originIndex,
        origin: task.origin.requestedName,
        minutes: await resolveEstimate(
          signal === undefined
            ? this.travelTimeAdapter.estimateMinutes(task.origin.station.id, task.candidate.id)
            : this.travelTimeAdapter.estimateMinutes(task.origin.station.id, task.candidate.id, {
                signal,
              }),
          signal,
        ),
      }),
    )

    const evaluatedCandidates = candidates.map((candidate) => {
      const travelTimes = estimates
        .filter((estimate) => estimate.candidateId === candidate.id)
        .sort((left, right) => left.originIndex - right.originIndex)
        .map((estimate) => ({ origin: estimate.origin, minutes: estimate.minutes }))
      const minutes = travelTimes.map((travelTime) => travelTime.minutes)
      const averageMinutes = minutes.reduce((total, value) => total + value, 0) / minutes.length
      const maxDifferenceMinutes = Math.max(...minutes) - Math.min(...minutes)

      return {
        station: candidate.name,
        travelTimes,
        averageMinutes: roundToOneDecimal(averageMinutes),
        maxDifferenceMinutes,
        fairness: calculateFairnessScore({ averageMinutes, maxDifferenceMinutes }),
      }
    })
    return evaluatedCandidates.sort(compareCandidates)
  }
}

async function resolveEstimate(
  estimate: Promise<number>,
  signal: AbortSignal | undefined,
): Promise<number> {
  if (signal === undefined) {
    return estimate
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(new TravelTimeLookupTimeoutError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void estimate.then(
      (minutes) => {
        signal.removeEventListener("abort", onAbort)
        resolve(minutes)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
    if (signal.aborted) {
      onAbort()
    }
  })
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  maxConcurrentOperations: number,
  operation: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const results: Output[] = []
  let nextIndex = 0
  let hasFailure = false
  const workerCount = Math.min(maxConcurrentOperations, inputs.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (!hasFailure && nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      const input = inputs[index]
      if (input === undefined) {
        return
      }
      try {
        results[index] = await operation(input)
      } catch (error) {
        hasFailure = true
        throw error
      }
    }
  })
  await Promise.all(workers)
  return results
}

function compareCandidates(left: MeetingAreaCandidate, right: MeetingAreaCandidate): number {
  if (left.fairness.fairnessScore !== right.fairness.fairnessScore) {
    return right.fairness.fairnessScore - left.fairness.fairnessScore
  }
  if (left.averageMinutes !== right.averageMinutes) {
    return left.averageMinutes - right.averageMinutes
  }
  if (left.maxDifferenceMinutes !== right.maxDifferenceMinutes) {
    return left.maxDifferenceMinutes - right.maxDifferenceMinutes
  }
  return left.station.localeCompare(right.station, "ko-KR")
}
