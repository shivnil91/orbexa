import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length < 3) {
    throw new Error(hex);
  }
  const [red, green, blue] = channels.slice(0, 3).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function block(css: string, selector: string): Record<string, string> {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`));
  if (!match) {
    throw new Error(selector);
  }
  const pairs: Record<string, string> = {};
  for (const line of match[1].split(";")) {
    const [name, value] = line.split(":");
    if (name && value) {
      pairs[name.trim()] = value.trim();
    }
  }
  return pairs;
}

test("text tokens clear WCAG 2.2 AA contrast in both schemes", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const light = block(css, ":root");
  const dark = block(css, "@media \\(prefers-color-scheme: dark\\) \\{\\s*:root");
  for (const tokens of [light, dark]) {
    assert.ok(contrast(tokens["--foreground"], tokens["--background"]) >= 4.5);
    assert.ok(contrast(tokens["--muted"], tokens["--background"]) >= 4.5);
    assert.ok(contrast(tokens["--accent-foreground"], tokens["--accent"]) >= 4.5);
    assert.ok(contrast(tokens["--missing"], tokens["--missing-bg"]) >= 4.5);
    assert.ok(contrast(tokens["--supported"], tokens["--supported-bg"]) >= 4.5);
    assert.ok(contrast(tokens["--warning"], tokens["--warning-bg"]) >= 4.5);
  }
  assert.ok(contrast("#71717a", "#ffffff") >= 4.5);
});
