import { describe, expect, it } from "vitest";
import { Breaker, ScanGate, SlidingCounter } from "@/lib/ratelimit";

describe("abuse limits", () => {
  it("counts within a window and forgets after it", () => {
    const counter = new SlidingCounter(1000);
    expect(counter.take("ip", 2, 0)).toBe(true);
    expect(counter.take("ip", 2, 10)).toBe(true);
    expect(counter.take("ip", 2, 20)).toBe(false);
    expect(counter.take("ip", 2, 1200)).toBe(true);
  });

  it("opens after repeated failures and closes after the cooldown", () => {
    const breaker = new Breaker(2, 500);
    breaker.recordFailure(0);
    expect(breaker.isOpen(0)).toBe(false);
    breaker.recordFailure(10);
    expect(breaker.isOpen(10)).toBe(true);
    expect(breaker.isOpen(600)).toBe(false);
  });

  it("refuses a caller who scans too often, and lets another one through", () => {
    const gate = new ScanGate({ perIpPerMinute: 2, perDestinationPerMinute: 99, globalPerMinute: 99, concurrency: 9 });
    expect(gate.enter("1.1.1.1", "a.example").ok).toBe(true);
    gate.leave("ok");
    expect(gate.enter("1.1.1.1", "a.example").ok).toBe(true);
    gate.leave("ok");
    const third = gate.enter("1.1.1.1", "a.example");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.status).toBe(429);
    expect(gate.enter("2.2.2.2", "a.example").ok).toBe(true);
  });

  it("refuses when too many scans run at once", () => {
    const gate = new ScanGate({ perIpPerMinute: 99, perDestinationPerMinute: 99, globalPerMinute: 99, concurrency: 1 });
    expect(gate.enter("1.1.1.1", "a.example").ok).toBe(true);
    const second = gate.enter("2.2.2.2", "b.example");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(503);
    gate.leave("ok");
    expect(gate.enter("2.2.2.2", "b.example").ok).toBe(true);
  });

  it("protects one destination from the whole page", () => {
    const gate = new ScanGate({ perIpPerMinute: 99, perDestinationPerMinute: 1, globalPerMinute: 99, concurrency: 9 });
    expect(gate.enter("1.1.1.1", "target.example").ok).toBe(true);
    gate.leave("ok");
    expect(gate.enter("2.2.2.2", "target.example").ok).toBe(false);
  });
});
