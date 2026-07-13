import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { z } from "zod/v4"

import { StreamableHttpClientTransportAdapter } from "./streamable-http-client-transport.ts"

const SmokeTestUrlSchema = z.url().default("http://127.0.0.1:3000/mcp")

async function main(): Promise<void> {
  const endpoint = new URL(SmokeTestUrlSchema.parse(process.env["MCP_SMOKE_TEST_URL"]))
  const client = new Client({ name: "everyones-middle-station-smoke-test", version: "0.1.0" })
  const transport = new StreamableHttpClientTransportAdapter(endpoint)

  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: "find_fair_meeting_areas",
      arguments: {
        origins: ["강남역", "수원역", "일산역"],
        max_candidates: 3,
      },
    })

    if (result.isError === true) {
      throw new Error(extractErrorMessage(result))
    }

    process.stdout.write(`${JSON.stringify(result.structuredContent, null, 2)}\n`)
  } finally {
    await client.close()
  }
}

function extractErrorMessage(result: unknown): string {
  if (!hasContent(result)) {
    return "MCP 도구가 오류 응답을 반환했습니다."
  }

  const message = result.content
    .flatMap((item) => (isTextContent(item) ? [item.text] : []))
    .join("\n")
  return message.length > 0 ? message : "MCP 도구가 오류 응답을 반환했습니다."
}

function hasContent(value: unknown): value is { readonly content: readonly unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray(value.content)
  )
}

function isTextContent(item: unknown): item is { readonly type: "text"; readonly text: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "text" &&
    "text" in item &&
    typeof item.text === "string"
  )
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 MCP 스모크 테스트 오류"
  process.stderr.write(`MCP 스모크 테스트에 실패했습니다: ${message}\n`)
  process.exitCode = 1
})
