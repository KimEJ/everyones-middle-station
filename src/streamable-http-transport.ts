import type { IncomingMessage, ServerResponse } from "node:http"

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js"

export type StreamableHttpTransportOptions = {
  readonly allowedHostHeader: string
  readonly allowedOrigins: readonly string[]
}

export class StreamableHttpTransportAdapter implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  private readonly transport: StreamableHTTPServerTransport

  constructor(options: StreamableHttpTransportOptions) {
    this.transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [options.allowedHostHeader],
      allowedOrigins: [...options.allowedOrigins],
    })
  }

  async start(): Promise<void> {
    this.transport.onclose = () => {
      this.onclose?.()
    }
    this.transport.onerror = (error) => {
      this.onerror?.(error)
    }
    this.transport.onmessage = (message, extra) => {
      this.onmessage?.(message, extra)
    }
    await this.transport.start()
  }

  async close(): Promise<void> {
    await this.transport.close()
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (options?.relatedRequestId === undefined) {
      await this.transport.send(message)
      return
    }
    await this.transport.send(message, { relatedRequestId: options.relatedRequestId })
  }

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    await this.transport.handleRequest(request, response, parsedBody)
  }
}
