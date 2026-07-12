import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js"

export class StreamableHttpClientTransportAdapter implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  private readonly transport: StreamableHTTPClientTransport

  constructor(url: URL) {
    this.transport = new StreamableHTTPClientTransport(url)
  }

  async start(): Promise<void> {
    this.transport.onclose = () => {
      this.onclose?.()
    }
    this.transport.onerror = (error) => {
      this.onerror?.(error)
    }
    this.transport.onmessage = (message) => {
      this.onmessage?.(message)
    }
    await this.transport.start()
  }

  async close(): Promise<void> {
    await this.transport.close()
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    await this.transport.send(message, options)
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion(version)
  }
}
