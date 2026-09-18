import { test } from "node:test";
import assert from "node:assert/strict";
import { PresenceMotion } from "../src/extension/presence-motion";

test("native presence moves through intermediate positions and settles exactly", () => {
  const motion = new PresenceMotion({ line: 2, column: 0 });
  motion.move({ line: 6, column: 40 }, 100, true);
  assert.deepEqual(motion.sample(100), { line: 2, column: 0 });
  assert.deepEqual(motion.sample(180), { line: 4, column: 20 });
  assert.deepEqual(motion.sample(260), { line: 6, column: 40 });
  assert.equal(motion.moving(260), false);
});

test("new presence retargets from the displayed position without jumping backwards", () => {
  const motion = new PresenceMotion({ line: 0, column: 0 });
  motion.move({ line: 0, column: 40 }, 0, true);
  const current = motion.sample(80);
  motion.move({ line: 0, column: 60 }, 80, true);
  assert.deepEqual(motion.sample(80), current);
  assert.ok(motion.sample(120).column > current.column);
  // Unrelated state events must not keep restarting the animation.
  motion.move({ line: 0, column: 60 }, 200, true);
  assert.deepEqual(motion.sample(240), { line: 0, column: 60 });
  assert.equal(motion.moving(240), false);
});

test("navigation jumps and reduced motion snap, including an in-flight animation", () => {
  const motion = new PresenceMotion({ line: 0, column: 0 });
  motion.move({ line: 500, column: 30 }, 0, true);
  assert.deepEqual(motion.sample(0), { line: 500, column: 30 });
  assert.equal(motion.moving(0), false);
  motion.move({ line: 500, column: 70 }, 10, true);
  assert.equal(motion.moving(20), true);
  motion.move({ line: 500, column: 70 }, 20, false);
  assert.deepEqual(motion.sample(20), { line: 500, column: 70 });
  assert.equal(motion.moving(20), false);
});
