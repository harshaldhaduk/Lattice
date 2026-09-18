export interface CursorPoint {
  line: number;
  column: number;
}

const same = (a: CursorPoint, b: CursorPoint) =>
  a.line === b.line && a.column === b.column;

/** Native decorations accept text positions, not pixel coordinates. */
export class PresenceMotion {
  private from: CursorPoint;
  private target: CursorPoint;
  private started = 0;
  private duration = 0;

  constructor(position: CursorPoint) {
    this.from = this.target = { ...position };
  }

  sample(now: number): CursorPoint {
    const t = this.duration
      ? Math.min(1, Math.max(0, (now - this.started) / this.duration))
      : 1;
    const ease = t * t * (3 - 2 * t);
    return {
      line: Math.round(
        this.from.line + (this.target.line - this.from.line) * ease,
      ),
      column: Math.round(
        this.from.column + (this.target.column - this.from.column) * ease,
      ),
    };
  }

  move(position: CursorPoint, now: number, animate: boolean) {
    if (same(position, this.target) && animate) return;
    this.from = this.sample(now);
    this.target = { ...position };
    this.started = now;
    // Navigation jumps should not imply editing every intervening line.
    this.duration =
      animate &&
      Math.abs(this.from.line - position.line) <= 12 &&
      Math.abs(this.from.column - position.column) <= 120
        ? 160
        : 0;
  }

  moving(now: number) {
    return !same(this.from, this.target) && now < this.started + this.duration;
  }
}
