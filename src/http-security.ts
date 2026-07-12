import type { IncomingMessage } from "node:http"

export type HttpSecurityOptions = {
  readonly allowedHostnames: readonly string[]
  readonly allowedOrigins: readonly string[]
  readonly maxBodyBytes: number
  readonly maxConcurrentRequests: number
  readonly requestTimeoutMs: number
}

export class RequestBodyTooLargeError extends Error {
  readonly name = "RequestBodyTooLargeError"
}

export class InvalidJsonBodyError extends Error {
  readonly name = "InvalidJsonBodyError"
}

export class BatchRequestNotSupportedError extends Error {
  readonly name = "BatchRequestNotSupportedError"
}

export function getAllowedHostHeader(
  request: IncomingMessage,
  allowedHostnames: readonly string[],
): string | undefined {
  const hostHeader = request.headers.host
  if (hostHeader === undefined) {
    return undefined
  }

  const hostname = getHostname(hostHeader)
  if (hostname === undefined) {
    return undefined
  }
  return allowedHostnames.some((allowedHostname) => hostname === normalizeHostname(allowedHostname))
    ? hostHeader
    : undefined
}

export function getAllowedOrigin(
  request: IncomingMessage,
  allowedOrigins: readonly string[],
): string | undefined {
  const origin = request.headers.origin
  return origin !== undefined && allowedOrigins.includes(origin) ? origin : undefined
}

export async function readMcpRequestBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const declaredLength = request.headers["content-length"]
  if (declaredLength !== undefined && Number(declaredLength) > maxBodyBytes) {
    throw new RequestBodyTooLargeError("Request body exceeds the configured size limit")
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
    totalBytes += buffer.byteLength
    if (totalBytes > maxBodyBytes) {
      throw new RequestBodyTooLargeError("Request body exceeds the configured size limit")
    }
    chunks.push(buffer)
  }

  const payload = Buffer.concat(chunks).toString("utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonBodyError("Request body is not valid JSON")
    }
    throw error
  }

  if (Array.isArray(parsed)) {
    throw new BatchRequestNotSupportedError("JSON-RPC batch requests are not supported")
  }
  return parsed
}

function getHostname(hostHeader: string): string | undefined {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLocaleLowerCase("en-US")
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined
    }
    throw error
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLocaleLowerCase("en-US")
}
