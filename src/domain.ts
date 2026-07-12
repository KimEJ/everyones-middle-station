import { z } from "zod/v4"

export const StationIdSchema = z.string().min(1).brand<"StationId">()

export type StationId = z.infer<typeof StationIdSchema>

export type Station = {
  readonly id: StationId
  readonly name: string
  readonly aliases: readonly string[]
}

export type NetworkLink = {
  readonly from: StationId
  readonly to: StationId
  readonly minutes: number
}

export type TravelTimeRequestOptions = {
  readonly signal?: AbortSignal
}

export interface TravelTimeAdapter {
  listStations(): readonly Station[]
  resolveStation(name: string): Station | undefined
  estimateMinutes(
    originId: StationId,
    destinationId: StationId,
    options?: TravelTimeRequestOptions,
  ): Promise<number>
}
