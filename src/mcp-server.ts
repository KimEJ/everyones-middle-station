import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { TravelTimeAdapter } from "./domain.ts"
import {
  InvalidNetworkDataError,
  RouteUnavailableError,
  ToolExecutionError,
  TravelTimeLookupTimeoutError,
  UnknownStationError,
} from "./errors.ts"
import { calculateFairnessScore } from "./fairness.ts"
import { type MeetingAreaCandidate, MeetingAreaService } from "./meeting-service.ts"
import {
  CompareMeetingAreasInputSchema,
  ExplainFairnessScoreInputSchema,
  FindFairMeetingAreasInputSchema,
} from "./tool-schemas.ts"

export const SERVER_NAME = "everyones-middle-station"
export const SERVER_VERSION = "0.1.0"

export function createMcpServer(
  travelTimeAdapter: TravelTimeAdapter,
  requestSignal?: AbortSignal,
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const meetingAreaService = new MeetingAreaService(travelTimeAdapter)

  server.registerTool(
    "find_fair_meeting_areas",
    {
      title: "공평한 만남 역 찾기",
      description:
        "여러 출발역의 평균 이동시간과 최대 편차를 함께 고려해 공평한 만남 역을 추천합니다.",
      inputSchema: FindFairMeetingAreasInputSchema,
    },
    async (input, extra) =>
      executeTool(async () => {
        const signal = combineRequestSignals(requestSignal, extra.signal)
        const candidates =
          input.candidate_stations === undefined
            ? await meetingAreaService.findAreas(
                {
                  originNames: input.origins,
                  maxCandidates: input.max_candidates,
                },
                signal,
              )
            : await meetingAreaService.findAreas(
                {
                  originNames: input.origins,
                  maxCandidates: input.max_candidates,
                  candidateNames: input.candidate_stations,
                },
                signal,
              )

        return {
          candidates: serializeCandidates(candidates),
          algorithm: "수도권 샘플 그래프 최단시간 추정",
        }
      }),
  )

  server.registerTool(
    "compare_meeting_areas",
    {
      title: "지정 만남 역 비교",
      description: "지정한 후보역을 같은 출발지와 공정성 산식으로 비교해 순위를 반환합니다.",
      inputSchema: CompareMeetingAreasInputSchema,
    },
    async (input, extra) =>
      executeTool(async () => {
        const signal = combineRequestSignals(requestSignal, extra.signal)
        return {
          candidates: serializeCandidates(
            await meetingAreaService.compareAreas(
              {
                originNames: input.origins,
                candidateNames: input.candidate_stations,
              },
              signal,
            ),
          ),
          algorithm: "수도권 샘플 그래프 최단시간 추정",
        }
      }),
  )

  server.registerTool(
    "explain_fairness_score",
    {
      title: "공정성 점수 설명",
      description: "fairness_score 산식과 평균 이동시간 및 사람 간 편차의 영향을 설명합니다.",
      inputSchema: ExplainFairnessScoreInputSchema,
    },
    async (input) =>
      executeTool(async () => {
        const explanation = {
          formula: "round(max(0, 100 - raw_efficiency_penalty - raw_imbalance_penalty), 1)",
          raw_efficiency_penalty: "min(40, average_minutes / 60 × 40)",
          raw_imbalance_penalty: "min(60, max_difference_minutes / 45 × 60)",
          displayed_penalties:
            "efficiency_penalty와 imbalance_penalty는 raw 값을 소수점 첫째 자리로 반올림한 값",
          max_difference_definition: "각 출발지 예상 이동시간 중 최댓값 - 최솟값",
          interpretation: "점수가 높을수록 전체 이동시간이 짧고, 참여자별 부담 차이가 작습니다.",
        }
        if (input.average_minutes === undefined || input.max_difference_minutes === undefined) {
          return explanation
        }

        return {
          ...explanation,
          example: {
            average_minutes: input.average_minutes,
            max_difference_minutes: input.max_difference_minutes,
            ...serializeFairness(
              calculateFairnessScore({
                averageMinutes: input.average_minutes,
                maxDifferenceMinutes: input.max_difference_minutes,
              }),
            ),
          },
        }
      }),
  )

  return server
}

async function executeTool(operation: () => Promise<Record<string, unknown>>) {
  try {
    return successResponse(await operation())
  } catch (error) {
    if (
      error instanceof UnknownStationError ||
      error instanceof RouteUnavailableError ||
      error instanceof InvalidNetworkDataError ||
      error instanceof TravelTimeLookupTimeoutError
    ) {
      return errorResponse(error)
    }
    return errorResponse(new ToolExecutionError())
  }
}

function combineRequestSignals(
  serverRequestSignal: AbortSignal | undefined,
  mcpRequestSignal: AbortSignal,
): AbortSignal {
  return serverRequestSignal === undefined
    ? mcpRequestSignal
    : AbortSignal.any([serverRequestSignal, mcpRequestSignal])
}

function successResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  }
}

function errorResponse(
  error:
    | UnknownStationError
    | RouteUnavailableError
    | InvalidNetworkDataError
    | TravelTimeLookupTimeoutError
    | ToolExecutionError,
) {
  const payload = {
    error: {
      code: error.name,
      message: error.message,
    },
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  }
}

function serializeCandidates(
  candidates: readonly MeetingAreaCandidate[],
): readonly Record<string, unknown>[] {
  return candidates.map((candidate, index) => ({
    rank: index + 1,
    station: candidate.station,
    travel_times: candidate.travelTimes.map((travelTime) => ({
      origin: travelTime.origin,
      minutes: travelTime.minutes,
    })),
    average_minutes: candidate.averageMinutes,
    max_difference_minutes: candidate.maxDifferenceMinutes,
    ...serializeFairness(candidate.fairness),
  }))
}

function serializeFairness(
  fairness: ReturnType<typeof calculateFairnessScore>,
): Record<string, number> {
  return {
    fairness_score: fairness.fairnessScore,
    efficiency_penalty: fairness.efficiencyPenalty,
    imbalance_penalty: fairness.imbalancePenalty,
  }
}
