import { z } from "zod/v4"

const StationNameSchema = z.string().trim().min(1).max(80)

export const FindFairMeetingAreasInputSchema = z
  .object({
    origins: z.array(StationNameSchema).min(2).max(10),
    max_candidates: z.number().int().min(1).max(10).default(5),
    candidate_stations: z.array(StationNameSchema).min(1).max(30).optional(),
  })
  .strict()

export const CompareMeetingAreasInputSchema = z
  .object({
    origins: z.array(StationNameSchema).min(2).max(10),
    candidate_stations: z.array(StationNameSchema).min(2).max(30),
  })
  .strict()

export const ExplainFairnessScoreInputSchema = z
  .object({
    average_minutes: z.number().nonnegative().optional(),
    max_difference_minutes: z.number().nonnegative().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasAverage = input.average_minutes !== undefined
    const hasDifference = input.max_difference_minutes !== undefined
    if (hasAverage !== hasDifference) {
      context.addIssue({
        code: "custom",
        message: "average_minutes와 max_difference_minutes는 함께 입력해야 합니다.",
      })
    }
  })
