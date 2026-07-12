import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import type { TravelTimeAdapter } from "./domain.ts"
import type { HttpSecurityOptions } from "./http-security.ts"
import {
  BatchRequestNotSupportedError,
  getAllowedHostHeader,
  getAllowedOrigin,
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readMcpRequestBody,
} from "./http-security.ts"
import { createMcpServer, SERVER_VERSION } from "./mcp-server.ts"
import { StreamableHttpTransportAdapter } from "./streamable-http-transport.ts"

export type McpHttpServerOptions = {
  readonly travelTimeAdapter: TravelTimeAdapter
  readonly security: HttpSecurityOptions
}

type HttpRequestContext = {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly options: McpHttpServerOptions
}

type RequestGate = {
  activeRequests: number
}

export function createMcpHttpServer(options: McpHttpServerOptions): Server {
  const requestGate: RequestGate = { activeRequests: 0 }
  const server = createServer((request, response) => {
    if (requestGate.activeRequests >= options.security.maxConcurrentRequests) {
      writeAndCloseRequest(request, response, 503, -32001, "Server is busy")
      return
    }

    requestGate.activeRequests += 1
    void handleRequest({ request, response, options })
      .catch((error: unknown) => {
        if (!response.headersSent) {
          writeHandledError(
            response,
            error,
            getAllowedOrigin(request, options.security.allowedOrigins),
          )
          closeRequestAfterResponse(request, response)
        }
      })
      .finally(() => {
        requestGate.activeRequests -= 1
      })
  })
  server.requestTimeout = options.security.requestTimeoutMs
  server.headersTimeout = Math.min(options.security.requestTimeoutMs, 10_000)
  server.keepAliveTimeout = 5_000
  server.maxConnections = options.security.maxConcurrentRequests * 2
  return server
}

async function handleRequest(context: HttpRequestContext): Promise<void> {
  const requestUrl = new URL(context.request.url ?? "/", "http://mcp.local")

  if (requestUrl.pathname === "/health") {
    writeJson(context.response, 200, {
      status: "ok",
      transport: "streamable-http",
      version: SERVER_VERSION,
    })
    return
  }

  if (requestUrl.pathname !== "/mcp") {
    writeJson(context.response, 404, { error: "Not found" })
    return
  }

  const allowedHostHeader = getAllowedHostHeader(
    context.request,
    context.options.security.allowedHostnames,
  )
  const allowedOrigin = getAllowedOrigin(context.request, context.options.security.allowedOrigins)
  if (
    allowedHostHeader === undefined ||
    (context.request.headers.origin !== undefined && allowedOrigin === undefined)
  ) {
    writeAndCloseRequest(
      context.request,
      context.response,
      403,
      -32000,
      "Request origin is not allowed",
    )
    return
  }

  if (context.request.method === "OPTIONS") {
    if (allowedOrigin === undefined) {
      writeJsonRpcError(context.response, 403, -32000, "Request origin is not allowed")
      return
    }
    writePreflightResponse(context.response, allowedOrigin)
    return
  }

  if (context.request.method !== "POST") {
    writeAndCloseRequest(
      context.request,
      context.response,
      405,
      -32000,
      "Method not allowed",
      allowedOrigin,
    )
    return
  }

  const requestAbort = createRequestAbortSignal(
    context.response,
    context.options.security.requestTimeoutMs,
  )

  try {
    const parsedBody = await readMcpRequestBody(
      context.request,
      context.options.security.maxBodyBytes,
    )
    applyCorsHeaders(context.response, allowedOrigin)
    const transport = new StreamableHttpTransportAdapter({
      allowedHostHeader,
      allowedOrigins: context.options.security.allowedOrigins,
    })
    const server = createMcpServer(context.options.travelTimeAdapter, requestAbort.signal)

    try {
      await server.connect(transport)
      await transport.handleRequest(context.request, context.response, parsedBody)
    } finally {
      await transport.close()
      await server.close()
    }
  } finally {
    requestAbort.release()
  }
}

type RequestAbortSignal = {
  readonly signal: AbortSignal
  release(): void
}

function createRequestAbortSignal(response: ServerResponse, timeoutMs: number): RequestAbortSignal {
  const clientAbort = new AbortController()
  const abortOnUnfinishedResponseClose = () => {
    if (!response.writableFinished) {
      clientAbort.abort()
    }
  }

  response.once("close", abortOnUnfinishedResponseClose)

  return {
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), clientAbort.signal]),
    release: () => {
      response.off("close", abortOnUnfinishedResponseClose)
    },
  }
}

function writeAndCloseRequest(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
  allowedOrigin?: string,
): void {
  writeJsonRpcError(response, statusCode, code, message, allowedOrigin)
  closeRequestAfterResponse(request, response)
}

function closeRequestAfterResponse(request: IncomingMessage, response: ServerResponse): void {
  response.once("finish", () => {
    if (!request.destroyed) {
      request.destroy()
    }
  })
}

function writeHandledError(
  response: ServerResponse,
  error: unknown,
  allowedOrigin: string | undefined,
): void {
  if (error instanceof RequestBodyTooLargeError) {
    writeJsonRpcError(response, 413, -32600, "Request body is too large", allowedOrigin)
    return
  }
  if (error instanceof InvalidJsonBodyError) {
    writeJsonRpcError(response, 400, -32700, "Parse error", allowedOrigin)
    return
  }
  if (error instanceof BatchRequestNotSupportedError) {
    writeJsonRpcError(response, 400, -32600, "Batch requests are not supported", allowedOrigin)
    return
  }
  writeJsonRpcError(response, 500, -32603, "Internal server error", allowedOrigin)
}

function writeJsonRpcError(
  response: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
  allowedOrigin?: string,
): void {
  writeJson(
    response,
    statusCode,
    {
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    },
    allowedOrigin,
  )
}

function writePreflightResponse(response: ServerResponse, allowedOrigin: string): void {
  response.writeHead(204, createCorsHeaders(allowedOrigin))
  response.end()
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  allowedOrigin?: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...createCorsHeaders(allowedOrigin),
  })
  response.end(JSON.stringify(payload))
}

function applyCorsHeaders(response: ServerResponse, allowedOrigin: string | undefined): void {
  for (const [name, value] of Object.entries(createCorsHeaders(allowedOrigin))) {
    response.setHeader(name, value)
  }
}

function createCorsHeaders(allowedOrigin: string | undefined): Record<string, string> {
  if (allowedOrigin === undefined) {
    return {}
  }
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, mcp-protocol-version, mcp-session-id, last-event-id",
    vary: "Origin",
  }
}
