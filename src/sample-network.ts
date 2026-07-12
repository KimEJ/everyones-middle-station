import type { TravelTimeAdapter } from "./domain.ts"
import { InMemoryTravelTimeAdapter } from "./in-memory-network.ts"
import { SAMPLE_NETWORK_LINKS, SAMPLE_STATIONS } from "./sample-data.ts"

export function createSampleTravelTimeAdapter(): TravelTimeAdapter {
  return new InMemoryTravelTimeAdapter(SAMPLE_STATIONS, SAMPLE_NETWORK_LINKS)
}
