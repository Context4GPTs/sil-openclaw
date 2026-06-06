/**
 * UNIT — stub tool contract (tier: unit, <100ms, no I/O, mock api).
 *
 * Covers the card's "Tools register and return stub responses" + "a
 * developer can follow the existing pattern" criteria at the unit tier:
 *
 *   - each stub's execute(params) returns a well-formed ToolResult of
 *     shape { content: [{ type: "text", text: <json-string> }] } with a
 *     placeholder payload, and performs no network/backend call;
 *   - the placeholder payload ECHOES the received params (request →
 *     response wiring is real even though the body is stubbed);
 *   - ≥2 stubs exist and are structurally identical, so "the existing
 *     pattern" is demonstrably a pattern and not a single example.
 *
 * Everything here runs against createMockPluginApi() — no host, no
 * network, no filesystem. The stub tools are the pattern a future dev
 * copies; this file is the guardrail on that pattern's shape.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   src/tools/examples.ts exports `registerExampleTools(api)` which
 *   registers `sil_ping` and `sil_echo` via api.registerTool, each with
 *   a TypeBox `parameters` object and an async execute() returning a
 *   jsonResult-shaped placeholder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerExampleTools } from "../../tools/examples.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

/** The stub tools the skeleton ships. Two same-shape instances so the
 * "pattern" is a pattern. If the implementation renames these, the
 * manifest drift guard (manifest-contract.integration.test.ts) is the
 * authority on the real names — but the skeleton's own assumptions fix
 * these two, and the card names them explicitly. */
const STUB_TOOLS = ["sil_ping", "sil_echo"] as const;

/** Parse a ToolResult's text payload back to an object. Throws a
 * legible error (not a bare JSON.parse SyntaxError) when the text is
 * absent or unparseable — a malformed stub return should name itself. */
function parsePayload(text: string | undefined): Record<string, unknown> {
  if (typeof text !== "string") {
    throw new Error(`ToolResult content[0].text is not a string: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("example stub tools — registration", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    api = createMockPluginApi();
    registerExampleTools(api);
  });

  it("registers every stub tool exactly once", () => {
    for (const name of STUB_TOOLS) {
      // getTool throws (listing what IS registered) if the name is missing.
      expect(getTool(api, name).name).toBe(name);
    }
    expect(api._tools.size).toBe(STUB_TOOLS.length);
  });

  it("ships at least two stubs so 'the pattern' is a pattern, not one example", () => {
    expect(api._tools.size).toBeGreaterThanOrEqual(2);
  });

  it("gives every stub a non-empty name, label, description, and a parameters object", () => {
    for (const name of STUB_TOOLS) {
      const tool = getTool(api, name);
      expect(tool.name).toBe(name);
      expect(typeof tool.label).toBe("string");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      // TypeBox Type.Object(...) produces a JSON-schema object with
      // `type: "object"`. We assert the schema shape, not the lib.
      expect(tool.parameters).toBeTypeOf("object");
      expect((tool.parameters as { type?: unknown }).type).toBe("object");
      expect(tool.execute).toBeTypeOf("function");
    }
  });

  it("registers all stubs with the SAME structural shape (the pattern is uniform)", () => {
    // Adversarial: a dev copies one stub to make another. If the two
    // stubs differ in structure (one returns a bare string, one wraps
    // in content[]), "the pattern" is ambiguous. Assert the shape keys
    // match across every stub.
    const shapes = STUB_TOOLS.map((name) => {
      const t = getTool(api, name);
      return {
        keys: Object.keys(t).sort(),
        paramsType: (t.parameters as { type?: unknown }).type,
        executeIsFn: typeof t.execute === "function",
      };
    });
    const first = JSON.stringify(shapes[0]);
    for (const shape of shapes) {
      expect(JSON.stringify(shape)).toBe(first);
    }
  });
});

describe("example stub tools — execute() returns a well-formed stub ToolResult", () => {
  let api: MockPluginAPI;

  beforeEach(() => {
    api = createMockPluginApi();
    registerExampleTools(api);
  });

  for (const name of STUB_TOOLS) {
    it(`${name}: returns { content: [{ type: "text", text: <json> }] }`, async () => {
      const tool = getTool(api, name);
      const result = await tool.execute("call-1", {});

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(typeof result.content[0]!.text).toBe("string");
      // The text must be valid JSON — a stub that returns a non-JSON
      // string breaks the jsonResult contract the agent relies on.
      expect(() => parsePayload(result.content[0]!.text)).not.toThrow();
    });

    it(`${name}: marks the payload as a stub and names the tool`, async () => {
      const tool = getTool(api, name);
      const payload = parsePayload(
        (await tool.execute("call-1", {})).content[0]!.text,
      );
      expect(payload["stub"]).toBe(true);
      expect(payload["tool"]).toBe(name);
    });

    it(`${name}: echoes the received params back in the payload`, async () => {
      // Proves the request → response wiring is real even though the
      // body is stubbed. The echoed value must deep-equal what went in.
      const tool = getTool(api, name);
      const params = { hello: "world", n: 7, nested: { a: [1, 2, 3] } };
      const payload = parsePayload(
        (await tool.execute("call-1", params)).content[0]!.text,
      );
      expect(payload["echo"]).toEqual(params);
    });

    it(`${name}: echoes EMPTY params as an empty object (adversarial edge)`, async () => {
      // A stub that drops empty params (e.g. returns `echo: undefined`,
      // which JSON.stringify omits) would silently lose the wiring
      // proof. Empty-in must round-trip as empty-object-out.
      const tool = getTool(api, name);
      const payload = parsePayload(
        (await tool.execute("call-1", {})).content[0]!.text,
      );
      expect(payload).toHaveProperty("echo");
      expect(payload["echo"]).toEqual({});
    });

    it(`${name}: does not flag the result as an error`, async () => {
      const tool = getTool(api, name);
      const result = await tool.execute("call-1", {});
      // A stub success must not carry isError — that's the error shape.
      expect(result.isError).toBeUndefined();
    });

    it(`${name}: opens no network — completes synchronously-fast with no global fetch call`, async () => {
      // Adversarial: a stub must NOT call a backend. We can't prove a
      // negative perfectly, but we can spy on the most common egress
      // (global fetch) and assert it was never touched.
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network egress is forbidden in a stub"));
      try {
        const tool = getTool(api, name);
        await tool.execute("call-1", { x: 1 });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  }
});
