import { describe, expect, it } from "vitest"

import type { TravelTimeAdapter } from "../src/domain.ts"
import {
  RouteUnavailableError,
  TravelTimeLookupTimeoutError,
  UnknownStationError,
} from "../src/errors.ts"
import { MeetingAreaService } from "../src/meeting-service.ts"
import { createSampleTravelTimeAdapter } from "../src/sample-network.ts"

describe("MeetingAreaService", () => {
  it("ranks requested number of candidates with every participant travel time", async () => {
    // Given
    const service = new MeetingAreaService(createSampleTravelTimeAdapter())

    // When
    const candidates = await service.findAreas({
      originNames: ["강남역", "수원역", "일산역"],
      maxCandidates: 3,
    })

    // Then
    expect(candidates).toHaveLength(3)
    expect(candidates.map((candidate) => candidate.travelTimes)).toSatisfy(
      (travelTimes: readonly unknown[]) =>
        travelTimes.every((times) => Array.isArray(times) && times.length === 3),
    )
    expect(candidates.map((candidate) => candidate.fairness.fairnessScore)).toEqual(
      [...candidates.map((candidate) => candidate.fairness.fairnessScore)].sort(
        (left, right) => right - left,
      ),
    )
  })

  it("compares only the requested stations with the shared scoring rule", async () => {
    // Given
    const service = new MeetingAreaService(createSampleTravelTimeAdapter())

    // When
    const candidates = await service.compareAreas({
      originNames: ["강남역", "수원역", "일산역"],
      candidateNames: ["서울역", "신도림역", "왕십리역"],
    })

    // Then
    expect(candidates.map((candidate) => candidate.station).sort()).toEqual(
      ["서울역", "신도림역", "왕십리역"].sort(),
    )
  })

  it("deduplicates candidate aliases by their canonical station", async () => {
    // Given
    const service = new MeetingAreaService(createSampleTravelTimeAdapter())

    // When
    const candidates = await service.compareAreas({
      originNames: ["강남역", "수원역"],
      candidateNames: ["서울", "서울역"],
    })

    // Then
    expect(
      candidates.map((candidate) => ({
        station: candidate.station,
        origins: candidate.travelTimes.map((travelTime) => travelTime.origin),
      })),
    ).toEqual([{ station: "서울역", origins: ["강남역", "수원역"] }])
  })

  it("rejects an origin outside the sample network", async () => {
    // Given
    const service = new MeetingAreaService(createSampleTravelTimeAdapter())

    // When
    const findAreas = service.findAreas({ originNames: ["강남역", "없는역"], maxCandidates: 3 })

    // Then
    await expect(findAreas).rejects.toThrow(UnknownStationError)
  })

  it("propagates a rejected asynchronous travel-time lookup", async () => {
    // Given
    const sampleAdapter = createSampleTravelTimeAdapter()
    const failingAdapter: TravelTimeAdapter = {
      listStations: () => sampleAdapter.listStations(),
      resolveStation: (name) => sampleAdapter.resolveStation(name),
      estimateMinutes: async (originId, destinationId) => {
        throw new RouteUnavailableError(originId, destinationId)
      },
    }
    const service = new MeetingAreaService(failingAdapter)

    // When
    const findingAreas = service.findAreas({ originNames: ["강남역", "수원역"], maxCandidates: 1 })

    // Then
    await expect(findingAreas).rejects.toThrow(RouteUnavailableError)
  })

  it("does not leave a rejecting lookup unhandled for an already-aborted request", async () => {
    // Given
    const sampleAdapter = createSampleTravelTimeAdapter()
    const rejectingAdapter: TravelTimeAdapter = {
      listStations: () => sampleAdapter.listStations(),
      resolveStation: (name) => sampleAdapter.resolveStation(name),
      estimateMinutes: async (originId, destinationId) => {
        throw new RouteUnavailableError(originId, destinationId)
      },
    }
    const service = new MeetingAreaService(rejectingAdapter)
    const requestController = new AbortController()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason)
    }
    requestController.abort()
    process.on("unhandledRejection", onUnhandledRejection)

    try {
      // When
      const comparison = service.compareAreas(
        {
          originNames: ["강남역"],
          candidateNames: ["서울역"],
        },
        requestController.signal,
      )

      // Then
      await expect(comparison).rejects.toThrow(TravelTimeLookupTimeoutError)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }
  })

  it("does not start queued lookups after a sibling lookup rejects", async () => {
    // Given
    const sampleAdapter = createSampleTravelTimeAdapter()
    const startedDestinationIds: string[] = []
    const pendingLookups: PromiseWithResolvers<number>[] = []
    const failingAdapter: TravelTimeAdapter = {
      listStations: () => sampleAdapter.listStations(),
      resolveStation: (name) => sampleAdapter.resolveStation(name),
      estimateMinutes: (originId, destinationId) => {
        startedDestinationIds.push(destinationId)
        if (startedDestinationIds.length === 1) {
          return Promise.reject(new RouteUnavailableError(originId, destinationId))
        }
        const pendingLookup = Promise.withResolvers<number>()
        pendingLookups.push(pendingLookup)
        return pendingLookup.promise
      },
    }
    const service = new MeetingAreaService(failingAdapter)

    try {
      // When
      const comparison = service.compareAreas({
        originNames: ["강남역"],
        candidateNames: [
          "강남역",
          "사당역",
          "신도림역",
          "서울역",
          "홍대입구역",
          "정발산역",
          "대화역",
        ],
      })
      await expect(comparison).rejects.toThrow(RouteUnavailableError)
      expect(startedDestinationIds).toHaveLength(6)

      for (const pendingLookup of pendingLookups) {
        pendingLookup.resolve(10)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))

      // Then
      expect(startedDestinationIds).toHaveLength(6)
    } finally {
      for (const pendingLookup of pendingLookups) {
        pendingLookup.resolve(10)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  })

  it("keeps asynchronous route lookups within the fixed concurrency bound", async () => {
    // Given
    const sampleAdapter = createSampleTravelTimeAdapter()
    let activeLookups = 0
    let peakLookups = 0
    const boundedAdapter: TravelTimeAdapter = {
      listStations: () => sampleAdapter.listStations(),
      resolveStation: (name) => sampleAdapter.resolveStation(name),
      estimateMinutes: async () => {
        activeLookups += 1
        peakLookups = Math.max(peakLookups, activeLookups)
        await Promise.resolve()
        activeLookups -= 1
        return 10
      },
    }
    const service = new MeetingAreaService(boundedAdapter)

    // When
    await service.findAreas({ originNames: ["강남역", "수원역"], maxCandidates: 10 })

    // Then
    expect(peakLookups).toBeGreaterThan(1)
    expect(peakLookups).toBeLessThanOrEqual(6)
  })
})
