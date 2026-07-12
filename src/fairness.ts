export type FairnessInput = {
  readonly averageMinutes: number
  readonly maxDifferenceMinutes: number
}

export type FairnessBreakdown = {
  readonly efficiencyPenalty: number
  readonly imbalancePenalty: number
  readonly fairnessScore: number
}

const AVERAGE_MINUTES_CAP = 60
const MAX_DIFFERENCE_MINUTES_CAP = 45
const MAX_EFFICIENCY_PENALTY = 40
const MAX_IMBALANCE_PENALTY = 60

export function calculateFairnessScore(input: FairnessInput): FairnessBreakdown {
  const rawEfficiencyPenalty = Math.min(
    MAX_EFFICIENCY_PENALTY,
    (input.averageMinutes / AVERAGE_MINUTES_CAP) * MAX_EFFICIENCY_PENALTY,
  )
  const rawImbalancePenalty = Math.min(
    MAX_IMBALANCE_PENALTY,
    (input.maxDifferenceMinutes / MAX_DIFFERENCE_MINUTES_CAP) * MAX_IMBALANCE_PENALTY,
  )

  return {
    efficiencyPenalty: roundToOneDecimal(rawEfficiencyPenalty),
    imbalancePenalty: roundToOneDecimal(rawImbalancePenalty),
    fairnessScore: roundToOneDecimal(Math.max(0, 100 - rawEfficiencyPenalty - rawImbalancePenalty)),
  }
}

export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
