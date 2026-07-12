import { describe, expect, it } from "vitest"

import { calculateFairnessScore } from "../src/fairness.ts"

describe("calculateFairnessScore", () => {
  it("returns deterministic penalties when average time and participant gap are supplied", () => {
    // Given
    const input = { averageMinutes: 30, maxDifferenceMinutes: 15 }

    // When
    const result = calculateFairnessScore(input)

    // Then
    expect(result).toEqual({
      efficiencyPenalty: 20,
      fairnessScore: 60,
      imbalancePenalty: 20,
    })
  })

  it("rounds the final score after calculating both penalties at full precision", () => {
    // Given
    const input = { averageMinutes: 14, maxDifferenceMinutes: 31 }

    // When
    const result = calculateFairnessScore(input)

    // Then
    expect(result).toEqual({
      efficiencyPenalty: 9.3,
      fairnessScore: 49.3,
      imbalancePenalty: 41.3,
    })
  })
})
