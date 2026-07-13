import { readFileSync } from "node:fs"

import { z } from "zod/v4"

import { InvalidNetworkDataError } from "./errors.ts"

export const TransitNodeIdSchema = z.string().startsWith("station:").brand<"TransitNodeId">()

export type TransitNodeId = z.infer<typeof TransitNodeIdSchema>

const TransitEdgeSchema = z
  .object({
    from: TransitNodeIdSchema,
    to: TransitNodeIdSchema,
    kind: z.enum(["ride", "transfer"]),
    minutes: z.number().positive(),
  })
  .strict()

const TransitNodeSchema = z
  .object({
    id: TransitNodeIdSchema,
    name: z.string().min(1),
    line: z.string().min(1),
  })
  .strict()

const SeoulSubwayDataSchema = z
  .object({
    schema_version: z.literal(1),
    source: z
      .object({
        project: z.literal("디스커버서울"),
        database: z.literal("discoverseoul"),
        station_line_nodes: z.number().int().positive(),
        directed_transit_edges: z.number().int().positive(),
        ride_minutes_per_stop: z.number().positive(),
        transfer_minutes: z.number().positive(),
      })
      .strict(),
    nodes: z.array(TransitNodeSchema).min(1),
    edges: z.array(TransitEdgeSchema).min(1),
  })
  .strict()

export type SeoulSubwayData = z.infer<typeof SeoulSubwayDataSchema>

export function loadSeoulSubwayData(): SeoulSubwayData {
  return parseSeoulSubwayData(readSnapshot())
}

export function parseSeoulSubwayData(snapshot: unknown): SeoulSubwayData {
  const parsed = SeoulSubwayDataSchema.safeParse(snapshot)
  if (!parsed.success) {
    throw new InvalidNetworkDataError(`지하철 데이터 스키마 오류: ${parsed.error.message}`)
  }

  const data = parsed.data
  if (
    data.nodes.length !== data.source.station_line_nodes ||
    data.edges.length !== data.source.directed_transit_edges
  ) {
    throw new InvalidNetworkDataError("지하철 데이터 건수와 source 메타데이터가 일치하지 않습니다")
  }
  validateCrossRecordData(data)
  return data
}

function validateCrossRecordData(data: SeoulSubwayData): void {
  const nodeIds = new Set<TransitNodeId>()
  for (const node of data.nodes) {
    if (nodeIds.has(node.id)) {
      throw new InvalidNetworkDataError(`중복 역 노드 ID: ${node.id}`)
    }
    nodeIds.add(node.id)
  }

  for (const edge of data.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new InvalidNetworkDataError(`존재하지 않는 역 노드 연결: ${edge.from} → ${edge.to}`)
    }
    const expectedMinutes =
      edge.kind === "ride" ? data.source.ride_minutes_per_stop : data.source.transfer_minutes
    if (edge.minutes !== expectedMinutes) {
      throw new InvalidNetworkDataError(
        `${edge.kind} 간선 가중치가 source 메타데이터와 일치하지 않습니다: ${edge.from} → ${edge.to}`,
      )
    }
  }
}

function readSnapshot(): unknown {
  const path = new URL("../data/seoul-subway-network.json", import.meta.url)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    throw new InvalidNetworkDataError(
      `지하철 데이터 파일을 읽을 수 없습니다: ${errorMessage(error)}`,
    )
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new InvalidNetworkDataError(
      `지하철 데이터 JSON이 올바르지 않습니다: ${errorMessage(error)}`,
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류"
}
