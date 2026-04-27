import { describe, it, expect } from "vitest";
import {
  parseCorsOrigins,
  resolveCorsOrigin,
} from "../../shared/parseCorsOrigins.js";

describe("parseCorsOrigins", () => {
  it("returns origins=null when env is undefined", () => {
    expect(parseCorsOrigins(undefined)).toEqual({ origins: null, errors: [] });
  });

  it("returns origins=null when env is blank", () => {
    expect(parseCorsOrigins("   ")).toEqual({ origins: null, errors: [] });
  });

  it("parses a single string origin", () => {
    const r = parseCorsOrigins("https://example.com");
    expect(r.errors).toEqual([]);
    expect(r.origins).toEqual(["https://example.com"]);
  });

  it("strips trailing slash from string origins", () => {
    const r = parseCorsOrigins("https://example.com/");
    expect(r.origins).toEqual(["https://example.com"]);
  });

  it("trims whitespace around each entry", () => {
    const r = parseCorsOrigins(
      "  https://a.com  ,\thttps://b.com\n,https://c.com  ",
    );
    expect(r.errors).toEqual([]);
    expect(r.origins).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("drops empty entries from trailing or doubled commas", () => {
    const r = parseCorsOrigins("https://a.com,,https://b.com,");
    expect(r.origins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("parses regex entries", () => {
    const r = parseCorsOrigins("/\\.vercel\\.app$/");
    expect(r.errors).toEqual([]);
    expect(r.origins).toHaveLength(1);
    expect(r.origins[0]).toBeInstanceOf(RegExp);
    expect(r.origins[0].test("https://preview-123.vercel.app")).toBe(true);
    expect(r.origins[0].test("https://example.com")).toBe(false);
  });

  it("supports regex flags", () => {
    const r = parseCorsOrigins("/preview-.*\\.app$/i");
    expect(r.errors).toEqual([]);
    expect(r.origins[0].flags).toBe("i");
    expect(r.origins[0].test("https://PREVIEW-X.app")).toBe(true);
  });

  it("mixes string and regex entries", () => {
    const r = parseCorsOrigins(
      "https://app.example.com,/\\.vercel\\.app$/,https://staging.example.com/",
    );
    expect(r.errors).toEqual([]);
    expect(r.origins).toHaveLength(3);
    expect(r.origins[0]).toBe("https://app.example.com");
    expect(r.origins[1]).toBeInstanceOf(RegExp);
    expect(r.origins[2]).toBe("https://staging.example.com");
  });

  it("accepts the wildcard '*'", () => {
    const r = parseCorsOrigins("*");
    expect(r.errors).toEqual([]);
    expect(r.origins).toEqual(["*"]);
  });

  it("rejects malformed plain origins (not a URL)", () => {
    const r = parseCorsOrigins("not-a-url");
    expect(r.origins).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/not-a-url/);
  });

  it("rejects regex with no closing slash", () => {
    const r = parseCorsOrigins("/foo");
    // "/foo" looks like a regex by prefix but has no closing slash; this
    // gets caught by the regex-shape check, not silently treated as a URL.
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/no closing/);
  });

  it("rejects empty regex like '//i' (slashes with flags but no pattern)", () => {
    const r = parseCorsOrigins("//i");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/empty regex/);
  });

  it("rejects regex with invalid syntax (unclosed bracket)", () => {
    const r = parseCorsOrigins("/foo[bar/");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/not a valid regex/);
  });

  it("rejects regex schemes that aren't http(s)/ws(s)", () => {
    const r = parseCorsOrigins("javascript:alert(1)");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/javascript/);
  });

  it("collects ALL bad entries before reporting", () => {
    const r = parseCorsOrigins("https://ok.com,not-a-url,/bad[/,still-bad");
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    // Good entry still made it through
    expect(r.origins).toContain("https://ok.com");
  });
});

describe("resolveCorsOrigin", () => {
  it("returns true (allow-all) when env is blank in dev", () => {
    expect(resolveCorsOrigin(undefined, { isProduction: false })).toBe(true);
    expect(resolveCorsOrigin("", { isProduction: false })).toBe(true);
  });

  it("throws when env is blank in production", () => {
    expect(() => resolveCorsOrigin("", { isProduction: true })).toThrow(
      /required in production/,
    );
  });

  it("throws ONE error listing every invalid entry", () => {
    let caught;
    try {
      resolveCorsOrigin("not-a-url,/bad[/", { isProduction: false });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/not-a-url/);
    expect(caught.message).toMatch(/bad\[/);
  });

  it("returns parsed origin list when valid", () => {
    const origins = resolveCorsOrigin(
      "https://a.com,/\\.vercel\\.app$/",
      { isProduction: true },
    );
    expect(Array.isArray(origins)).toBe(true);
    expect(origins).toHaveLength(2);
  });
});
