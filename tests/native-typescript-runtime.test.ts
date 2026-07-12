import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

describe("native TypeScript development runtime", () => {
  it("loads source modules through Node type stripping without a transform-only syntax error", () => {
    // Given
    const sourceImport = [
      'import { UnknownStationError } from "./src/errors.ts"',
      'process.stdout.write(new UnknownStationError("test").name)',
    ].join("; ")

    // When
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", sourceImport], {
      cwd: process.cwd(),
      encoding: "utf8",
    })

    // Then
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toBe("UnknownStationError")
  })
})
