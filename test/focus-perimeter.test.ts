import { test } from "node:test";
import assert from "node:assert/strict";
import { focusPerimeter } from "../src/webview/focus-perimeter";

test("focus perimeter begins at bottom center and heads clockwise", () => {
  const path = focusPerimeter(200, 40);
  assert.ok(path.startsWith("M 100 39.25 H 6.75 Q 0.75 39.25"));
  assert.ok(path.endsWith("H 100 Z"));
  assert.equal((path.match(/ Q /g) || []).length, 4);
});
test("focus perimeter clamps corners for compact fields", () => {
  assert.ok(focusPerimeter(10, 8, 99).startsWith("M 5 7.25 H 4"));
});
test("focus perimeter ignores zero-sized and invalid frames", () => {
  for (const [width, height] of [
    [0, 40],
    [40, 0],
    [-1, 40],
    [NaN, 40],
    [40, Infinity],
  ])
    assert.equal(focusPerimeter(width, height), "");
});
