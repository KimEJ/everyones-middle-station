import type { Server } from "node:http"

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import type { TravelTimeAdapter } from "./domain.ts"
import type { HttpSecurityOptions } from "./http-security.ts"
import { createMcpHttpServer } from "./http-server.ts"
import { createMcpServer } from "./mcp-server.ts"

export type HttpServerOptions = {
  readonly host: string
  readonly port: number
  readonly travelTimeAdapter: TravelTimeAdapter
  readonly security: HttpSecurityOptions
}

export async function startStdioServer(travelTimeAdapter: TravelTimeAdapter): Promise<void> {
  const server = createMcpServer(travelTimeAdapter)
  await server.connect(new StdioServerTransport())
}

export async function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const server = createMcpHttpServer({
    travelTimeAdapter: options.travelTimeAdapter,
    security: options.security,
  })
  await listen(server, options)
  return server
}

function listen(server: Server, options: HttpServerOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }

    server.once("listening", onListening)
    server.once("error", onError)
    server.listen(options.port, options.host)
  })
}
