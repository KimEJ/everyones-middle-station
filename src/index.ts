import { z } from "zod/v4"

import { RuntimeModeError } from "./errors.ts"
import { startHttpServer, startStdioServer } from "./runtime.ts"
import { createSampleTravelTimeAdapter } from "./sample-network.ts"

const RuntimeConfigSchema = z
  .object({
    transport: z.enum(["http", "stdio"]).default("http"),
    port: z.coerce.number().int().min(1).max(65535).default(3000),
    host: z.string().trim().min(1).default("127.0.0.1"),
    allowed_hosts: z.string().trim().min(1).optional(),
    allowed_origins: z.string().trim().min(1).optional(),
    max_body_bytes: z.coerce.number().int().min(1_024).max(1_048_576).default(262_144),
    max_concurrent_requests: z.coerce.number().int().min(1).max(100).default(20),
    request_timeout_ms: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  })
  .strict()

async function main(): Promise<void> {
  const config = RuntimeConfigSchema.parse({
    transport: getOptionValue("transport") ?? process.env["MCP_TRANSPORT"],
    port: getOptionValue("port") ?? process.env["MCP_PORT"],
    host: getOptionValue("host") ?? process.env["MCP_HOST"],
    allowed_hosts: process.env["MCP_ALLOWED_HOSTS"],
    allowed_origins: process.env["MCP_ALLOWED_ORIGINS"],
    max_body_bytes: process.env["MCP_MAX_BODY_BYTES"],
    max_concurrent_requests: process.env["MCP_MAX_CONCURRENT_REQUESTS"],
    request_timeout_ms: process.env["MCP_REQUEST_TIMEOUT_MS"],
  })
  const travelTimeAdapter = createSampleTravelTimeAdapter()

  switch (config.transport) {
    case "http":
      await startHttpServer({
        host: config.host,
        port: config.port,
        travelTimeAdapter,
        security: {
          allowedHostnames: parseDelimitedValues(config.allowed_hosts, [config.host]),
          allowedOrigins: parseDelimitedValues(config.allowed_origins, []),
          maxBodyBytes: config.max_body_bytes,
          maxConcurrentRequests: config.max_concurrent_requests,
          requestTimeoutMs: config.request_timeout_ms,
        },
      })
      return
    case "stdio":
      await startStdioServer(travelTimeAdapter)
      return
    default:
      throw new RuntimeModeError(config.transport)
  }
}

function getOptionValue(optionName: string): string | undefined {
  const prefix = `--${optionName}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function parseDelimitedValues(
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  const sourceValues = value === undefined ? fallback : value.split(",")
  return [...new Set(sourceValues.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 시작 오류"
  process.stderr.write(`MCP 서버를 시작하지 못했습니다: ${message}\n`)
  process.exitCode = 1
})
