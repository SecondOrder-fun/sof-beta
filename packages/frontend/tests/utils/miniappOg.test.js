import { describe, it, expect } from "vitest";
import {
  generateSeasonOgSvg,
  generateMarketOgSvg,
  escapeXml,
} from "../../src/utils/miniappOg.js";

describe("miniappOg utilities", () => {
  describe("escapeXml", () => {
    it("escapes XML special characters", () => {
      expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
      expect(escapeXml('"test"')).toBe("&quot;test&quot;");
      expect(escapeXml("'test'")).toBe("&apos;test&apos;");
      expect(escapeXml("a & b")).toBe("a &amp; b");
    });

    it("returns empty string for non-string inputs", () => {
      expect(escapeXml(null)).toBe("");
      expect(escapeXml(undefined)).toBe("");
      expect(escapeXml(123)).toBe("");
    });

    it("returns unchanged string when no escaping needed", () => {
      expect(escapeXml("Hello World")).toBe("Hello World");
    });
  });

  describe("generateSeasonOgSvg", () => {
    it("returns valid SVG with correct dimensions", () => {
      const svg = generateSeasonOgSvg({ seasonId: "1" });

      expect(svg).toContain("<svg");
      expect(svg).toContain('width="1200"');
      expect(svg).toContain('height="630"');
      expect(svg).toContain("</svg>");
    });

    it("includes season ID in the SVG", () => {
      const svg = generateSeasonOgSvg({ seasonId: "42" });

      expect(svg).toContain("#42");
      expect(svg).toContain("Season 42");
    });

    it("uses custom season name when provided", () => {
      const svg = generateSeasonOgSvg({
        seasonId: "1",
        seasonName: "Genesis Season",
      });

      expect(svg).toContain("Genesis Season");
    });

    it("includes brand name", () => {
      const svg = generateSeasonOgSvg({ seasonId: "1" });

      expect(svg).toContain("SecondOrder.fun");
    });

    it("includes call to action text", () => {
      const svg = generateSeasonOgSvg({ seasonId: "1" });

      expect(svg).toContain("Join the raffle");
      expect(svg).toContain("Win big prizes");
    });

    it("escapes XSS attempts in season name", () => {
      const svg = generateSeasonOgSvg({
        seasonId: "1",
        seasonName: '<script>alert("xss")</script>',
      });

      expect(svg).not.toContain("<script>alert");
      expect(svg).toContain("&lt;script&gt;");
    });

    it("includes gradient definitions", () => {
      const svg = generateSeasonOgSvg({ seasonId: "1" });

      expect(svg).toContain("<defs>");
      expect(svg).toContain("linearGradient");
      expect(svg).toContain('id="bg"');
      expect(svg).toContain('id="accent"');
    });
  });

  describe("generateMarketOgSvg", () => {
    it("returns valid SVG with correct dimensions", () => {
      const svg = generateMarketOgSvg({ marketId: "1" });

      expect(svg).toContain("<svg");
      expect(svg).toContain('width="1200"');
      expect(svg).toContain('height="630"');
      expect(svg).toContain("</svg>");
    });

    it("includes market ID in the SVG", () => {
      const svg = generateMarketOgSvg({ marketId: "99" });

      expect(svg).toContain("#99");
      expect(svg).toContain("Market 99");
    });

    it("uses custom market name when provided", () => {
      const svg = generateMarketOgSvg({
        marketId: "5",
        marketName: "Who wins Season 1?",
      });

      expect(svg).toContain("Who wins Season 1?");
    });

    it("includes brand name", () => {
      const svg = generateMarketOgSvg({ marketId: "1" });

      expect(svg).toContain("SecondOrder.fun");
    });

    it("includes prediction-specific call to action", () => {
      const svg = generateMarketOgSvg({ marketId: "1" });

      expect(svg).toContain("Trade predictions");
      expect(svg).toContain("InfoFi markets");
    });

    it("uses different color scheme than season", () => {
      const seasonSvg = generateSeasonOgSvg({ seasonId: "1" });
      const marketSvg = generateMarketOgSvg({ marketId: "1" });

      expect(seasonSvg).toContain("#e94560");
      expect(marketSvg).toContain("#00d9ff");
    });

    it("escapes XSS attempts in market name", () => {
      const svg = generateMarketOgSvg({
        marketId: "1",
        marketName: '<script>alert("xss")</script>',
      });

      expect(svg).not.toContain("<script>alert");
      expect(svg).toContain("&lt;script&gt;");
    });
  });
});
