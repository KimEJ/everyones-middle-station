import { describe, expect, it } from "vitest"

import {
  ExplainFairnessScoreInputSchema,
  FindFairMeetingAreasInputSchema,
} from "../src/tool-schemas.ts"

describe("MCP tool input schemas", () => {
  it("applies the default candidate limit for valid meeting search input", () => {
    // Given
    const input = { origins: ["강남역", "수원역"] }

    // When
    const parsed = FindFairMeetingAreasInputSchema.parse(input)

    // Then
    expect(parsed.max_candidates).toBe(5)
  })

  it("rejects an incomplete fairness explanation example", () => {
    // Given
    const input = { average_minutes: 30 }

    // When
    const result = ExplainFairnessScoreInputSchema.safeParse(input)

    // Then
    expect(result.success).toBe(false)
  })
})
