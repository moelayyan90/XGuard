import { createHash } from "node:crypto";
import { XGuardError } from "./errors.js";

export interface StrictJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxKeys: number;
}

const DEFAULT_LIMITS: StrictJsonLimits = {
  maxBytes: 64 * 1024,
  maxDepth: 32,
  maxKeys: 1_000,
};

class StrictJsonParser {
  private index = 0;
  private keys = 0;

  public constructor(
    private readonly input: string,
    private readonly limits: StrictJsonLimits,
  ) {}

  public parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length)
      this.fail("Unexpected trailing content");
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > this.limits.maxDepth) this.fail("JSON nesting limit exceeded");
    this.skipWhitespace();
    const char = this.input[this.index];
    if (char === "{") return this.parseObject(depth + 1);
    if (char === "[") return this.parseArray(depth + 1);
    if (char === '"') return this.parseString();
    if (char === "t") return this.parseLiteral("true", true);
    if (char === "f") return this.parseLiteral("false", false);
    if (char === "n") return this.parseLiteral("null", null);
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9"))
      return this.parseNumber();
    this.fail("Invalid JSON value");
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.input[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.input[this.index] !== '"')
        this.fail("Object keys must be strings");
      const key = this.parseString();
      if (seen.has(key)) this.fail(`Duplicate object key: ${key}`);
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        this.fail(`Forbidden object key: ${key}`);
      }
      seen.add(key);
      this.keys += 1;
      if (this.keys > this.limits.maxKeys) this.fail("JSON key limit exceeded");
      this.skipWhitespace();
      if (this.input[this.index] !== ":")
        this.fail("Expected ':' after object key");
      this.index += 1;
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      const char = this.input[this.index];
      if (char === "}") {
        this.index += 1;
        return result;
      }
      if (char !== ",") this.fail("Expected ',' or '}' in object");
      this.index += 1;
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.input[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const char = this.input[this.index];
      if (char === "]") {
        this.index += 1;
        return result;
      }
      if (char !== ",") this.fail("Expected ',' or ']' in array");
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.input.length) {
      const char = this.input[this.index];
      if (char === '"') {
        this.index += 1;
        const raw = this.input.slice(start, this.index);
        try {
          return JSON.parse(raw) as string;
        } catch {
          this.fail("Invalid JSON string");
        }
      }
      if (char === "\\") {
        this.index += 1;
        const escaped = this.input[this.index];
        if (escaped === "u") {
          const hex = this.input.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            this.fail("Invalid Unicode escape");
          this.index += 5;
          continue;
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped))
          this.fail("Invalid string escape");
        this.index += 1;
        continue;
      }
      if (char === undefined || char.charCodeAt(0) < 0x20)
        this.fail("Unescaped control character in string");
      this.index += 1;
    }
    this.fail("Unterminated JSON string");
  }

  private parseNumber(): number {
    const rest = this.input.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      rest,
    );
    if (!match) this.fail("Invalid JSON number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value))
      this.fail("JSON number is outside the finite range");
    return value;
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.input.slice(this.index, this.index + literal.length) !== literal)
      this.fail("Invalid JSON literal");
    this.index += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (
      /\s/.test(this.input[this.index] ?? "") &&
      this.index < this.input.length
    )
      this.index += 1;
  }

  private fail(message: string): never {
    throw new XGuardError(
      "BAD_REQUEST",
      `${message} at byte ${this.index}`,
      400,
    );
  }
}

export function parseJsonStrict(
  raw: string,
  limits: Partial<StrictJsonLimits> = {},
): unknown {
  const resolved = { ...DEFAULT_LIMITS, ...limits };
  if (Buffer.byteLength(raw, "utf8") > resolved.maxBytes) {
    throw new XGuardError(
      "BAD_REQUEST",
      `Request exceeds ${resolved.maxBytes} bytes`,
      413,
    );
  }
  return new StrictJsonParser(raw, resolved).parse();
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Non-finite numbers are not canonical JSON");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON type: ${typeof value}`);
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}
