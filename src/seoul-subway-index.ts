import { type Station, type StationId, StationIdSchema } from "./domain.ts"
import { InvalidNetworkDataError } from "./errors.ts"
import type { SeoulSubwayData, TransitNodeId } from "./seoul-subway-data.ts"

export type TransitNeighbor = {
  readonly nodeId: TransitNodeId
  readonly minutes: number
}

type StationGroupSeed = {
  readonly ordinal: number
  readonly rawName: string
  readonly displayName: string
  readonly lines: readonly string[]
  readonly nodeIds: readonly TransitNodeId[]
}

type StationGroup = {
  readonly station: Station
  readonly nodeIds: readonly TransitNodeId[]
}

export type SeoulSubwayNetworkIndex = {
  readonly stationList: readonly Station[]
  readonly stationByName: ReadonlyMap<string, Station>
  readonly ambiguousStationNames: ReadonlyMap<string, readonly string[]>
  readonly nodeIdsByStationId: ReadonlyMap<StationId, readonly TransitNodeId[]>
  readonly neighbors: ReadonlyMap<TransitNodeId, readonly TransitNeighbor[]>
}

export function buildSeoulSubwayNetworkIndex(data: SeoulSubwayData): SeoulSubwayNetworkIndex {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
  const neighbors = new Map<TransitNodeId, TransitNeighbor[]>(
    data.nodes.map((node) => [node.id, []]),
  )
  const transferNeighbors = new Map<TransitNodeId, TransitNodeId[]>(
    data.nodes.map((node) => [node.id, []]),
  )

  for (const edge of data.edges) {
    const outgoing = neighbors.get(edge.from)
    if (outgoing === undefined || !nodeById.has(edge.to)) {
      throw new InvalidNetworkDataError(`존재하지 않는 역 노드 연결: ${edge.from} → ${edge.to}`)
    }
    outgoing.push({ nodeId: edge.to, minutes: edge.minutes })
    if (edge.kind === "transfer") {
      addTransferNeighbor(transferNeighbors, edge.from, edge.to)
      addTransferNeighbor(transferNeighbors, edge.to, edge.from)
    }
  }

  const seeds = collectStationGroupSeeds(data, nodeById, transferNeighbors)
  const ambiguousDisplayNames = findAmbiguousDisplayNames(seeds)
  const ambiguousRawNames = findAmbiguousRawNames(seeds)
  const groups = createStationGroups(seeds, ambiguousDisplayNames)
  const stationByName = new Map<string, Station>()
  const nodeIdsByStationId = new Map<StationId, readonly TransitNodeId[]>()
  for (const group of groups) {
    nodeIdsByStationId.set(group.station.id, group.nodeIds)
    for (const name of [group.station.name, ...group.station.aliases]) {
      const key = normalizeStationName(name)
      if (stationByName.has(key)) {
        throw new InvalidNetworkDataError(`중복 역 이름: ${name}`)
      }
      stationByName.set(key, group.station)
    }
  }
  const ambiguousStationNames = createAmbiguousStationNames(
    seeds,
    groups,
    ambiguousDisplayNames,
    ambiguousRawNames,
  )
  addUniqueRawNameAliases(seeds, groups, stationByName, ambiguousRawNames, ambiguousStationNames)

  return {
    stationList: groups.map((group) => group.station),
    stationByName,
    ambiguousStationNames,
    nodeIdsByStationId,
    neighbors,
  }
}

export function normalizeStationName(name: string): string {
  return name.replaceAll(" ", "").toLocaleLowerCase("ko-KR")
}

function createStationGroups(
  seeds: readonly StationGroupSeed[],
  ambiguousDisplayNames: ReadonlySet<string>,
): readonly StationGroup[] {
  return seeds.map((seed) => {
    const lineQualifiedName = `${seed.displayName} (${seed.lines.join("·")})`
    const ambiguous = ambiguousDisplayNames.has(seed.displayName)
    const name = ambiguous ? lineQualifiedName : seed.displayName
    const aliases = ambiguous
      ? distinctNames([`${seed.rawName} (${seed.lines.join("·")})`], name)
      : distinctNames([seed.rawName, seed.displayName], name)
    return {
      station: {
        id: StationIdSchema.parse(`seoul-subway-${seed.ordinal + 1}`),
        name,
        aliases,
      },
      nodeIds: seed.nodeIds,
    }
  })
}

function createAmbiguousStationNames(
  seeds: readonly StationGroupSeed[],
  groups: readonly StationGroup[],
  ambiguousDisplayNames: ReadonlySet<string>,
  ambiguousRawNames: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const names = new Map<string, string[]>()
  for (const [index, seed] of seeds.entries()) {
    if (!ambiguousDisplayNames.has(seed.displayName)) {
      continue
    }
    const group = groups[index]
    if (group === undefined) {
      throw new InvalidNetworkDataError(`역 그룹을 찾을 수 없습니다: ${seed.displayName}`)
    }
    const namesToRegister = ambiguousRawNames.has(seed.rawName)
      ? [seed.displayName, seed.rawName]
      : [seed.displayName]
    for (const stationName of new Set(namesToRegister)) {
      const key = normalizeStationName(stationName)
      const candidates = names.get(key) ?? []
      candidates.push(group.station.name)
      names.set(key, candidates)
    }
  }
  return names
}

function addUniqueRawNameAliases(
  seeds: readonly StationGroupSeed[],
  groups: readonly StationGroup[],
  stationByName: Map<string, Station>,
  ambiguousRawNames: ReadonlySet<string>,
  ambiguousStationNames: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [index, seed] of seeds.entries()) {
    if (ambiguousRawNames.has(seed.rawName)) {
      continue
    }
    const group = groups[index]
    if (group === undefined) {
      throw new InvalidNetworkDataError(`역 그룹을 찾을 수 없습니다: ${seed.rawName}`)
    }
    const key = normalizeStationName(seed.rawName)
    if (ambiguousStationNames.has(key)) {
      continue
    }
    const existing = stationByName.get(key)
    if (existing === undefined) {
      stationByName.set(key, group.station)
    } else if (existing.id !== group.station.id) {
      throw new InvalidNetworkDataError(`중복 역 이름: ${seed.rawName}`)
    }
  }
}

function collectStationGroupSeeds(
  data: SeoulSubwayData,
  nodeById: ReadonlyMap<TransitNodeId, { readonly name: string; readonly line: string }>,
  transferNeighbors: ReadonlyMap<TransitNodeId, readonly TransitNodeId[]>,
): readonly StationGroupSeed[] {
  const visited = new Set<TransitNodeId>()
  const seeds: StationGroupSeed[] = []
  for (const node of data.nodes) {
    if (visited.has(node.id)) {
      continue
    }
    const nodeIds = collectTransferComponent(node.id, transferNeighbors, visited).sort()
    const members = nodeIds.map((nodeId) => requiredNode(nodeById, nodeId))
    const [first] = members
    if (first === undefined || members.some((member) => member.name !== first.name)) {
      throw new InvalidNetworkDataError("환승 연결된 역 노드의 이름이 일치하지 않습니다")
    }
    seeds.push({
      ordinal: seeds.length,
      rawName: first.name,
      displayName: displayStationName(first.name),
      lines: [...new Set(members.map((member) => member.line))].sort(),
      nodeIds,
    })
  }
  return seeds
}

function collectTransferComponent(
  start: TransitNodeId,
  transferNeighbors: ReadonlyMap<TransitNodeId, readonly TransitNodeId[]>,
  visited: Set<TransitNodeId>,
): TransitNodeId[] {
  const queue = [start]
  const component: TransitNodeId[] = []
  visited.add(start)
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]
    if (nodeId === undefined) {
      continue
    }
    component.push(nodeId)
    for (const neighbor of transferNeighbors.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return component
}

function findAmbiguousDisplayNames(seeds: readonly StationGroupSeed[]): ReadonlySet<string> {
  return findRepeatedNames(seeds.map((seed) => seed.displayName))
}

function findAmbiguousRawNames(seeds: readonly StationGroupSeed[]): ReadonlySet<string> {
  return findRepeatedNames(seeds.map((seed) => seed.rawName))
}

function findRepeatedNames(names: readonly string[]): ReadonlySet<string> {
  const countByName = new Map<string, number>()
  for (const name of names) {
    countByName.set(name, (countByName.get(name) ?? 0) + 1)
  }
  return new Set([...countByName].flatMap(([name, count]) => (count > 1 ? [name] : [])))
}

function addTransferNeighbor(
  transferNeighbors: Map<TransitNodeId, TransitNodeId[]>,
  from: TransitNodeId,
  to: TransitNodeId,
): void {
  const neighbors = transferNeighbors.get(from)
  if (neighbors === undefined) {
    throw new InvalidNetworkDataError(`환승 시작점이 없는 역 노드: ${from}`)
  }
  if (!neighbors.includes(to)) {
    neighbors.push(to)
  }
}

function requiredNode(
  nodeById: ReadonlyMap<TransitNodeId, { readonly name: string; readonly line: string }>,
  nodeId: TransitNodeId,
): { readonly name: string; readonly line: string } {
  const node = nodeById.get(nodeId)
  if (node === undefined) {
    throw new InvalidNetworkDataError(`역 노드를 찾을 수 없습니다: ${nodeId}`)
  }
  return node
}

function displayStationName(rawName: string): string {
  return rawName.endsWith("역") ? rawName : `${rawName}역`
}

function distinctNames(names: readonly string[], stationName: string): readonly string[] {
  return [...new Set(names)].filter((name) => name !== stationName)
}
