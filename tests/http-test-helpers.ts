import type { TravelTimeAdapter } from "../src/domain.ts"
import { createSampleTravelTimeAdapter } from "../src/sample-network.ts"

export type HangingAdapterHooks = {
  readonly onEstimateStarted?: () => void
  readonly onAbort?: () => void
}

export function createHangingAdapter(hooks: HangingAdapterHooks = {}): TravelTimeAdapter {
  const sampleAdapter = createSampleTravelTimeAdapter()
  return {
    listStations: () => sampleAdapter.listStations(),
    resolveStation: (name) => sampleAdapter.resolveStation(name),
    estimateMinutes: (_originId, _destinationId, options) =>
      new Promise<number>((_resolve, reject) => {
        const signal = options?.signal
        if (signal === undefined) {
          reject(new Error("Expected a request abort signal"))
          return
        }
        hooks.onEstimateStarted?.()
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener(
          "abort",
          () => {
            hooks.onAbort?.()
            reject(signal.reason)
          },
          { once: true },
        )
      }),
  }
}
