import type { StationId } from "./domain.ts"

export class UnknownStationError extends Error {
  readonly name = "UnknownStationError"
  readonly stationName: string

  constructor(stationName: string) {
    super(`지원하지 않는 역입니다: ${stationName}`)
    this.stationName = stationName
  }
}

export class RouteUnavailableError extends Error {
  readonly name = "RouteUnavailableError"
  readonly originId: StationId
  readonly destinationId: StationId

  constructor(originId: StationId, destinationId: StationId) {
    super(`이동 경로를 찾을 수 없습니다: ${originId} → ${destinationId}`)
    this.originId = originId
    this.destinationId = destinationId
  }
}

export class InvalidNetworkDataError extends Error {
  readonly name = "InvalidNetworkDataError"
  readonly detail: string

  constructor(detail: string) {
    super(`역 네트워크 데이터 오류: ${detail}`)
    this.detail = detail
  }
}

export class RuntimeModeError extends Error {
  readonly name = "RuntimeModeError"
  readonly value: never

  constructor(value: never) {
    super(`지원하지 않는 실행 모드입니다: ${String(value)}`)
    this.value = value
  }
}

export class TravelTimeLookupTimeoutError extends Error {
  readonly name = "TravelTimeLookupTimeoutError"

  constructor() {
    super("이동시간 계산 시간이 초과되었습니다.")
  }
}

export class ToolExecutionError extends Error {
  readonly name = "ToolExecutionError"

  constructor() {
    super("도구 실행 중 내부 오류가 발생했습니다.")
  }
}
