import { describe, it, expect } from "vitest";
import { cityFromGeo } from "../lib/luma/client";

describe("cityFromGeo", () => {
  it("uses the structured city when present", () => {
    expect(cityFromGeo({ city: "New York", city_state: "New York, NY" })).toBe("New York");
  });
  it("falls back to the first segment of city_state (non-US, null city)", () => {
    expect(cityFromGeo({ city: null, city_state: "Seoul, South Korea" })).toBe("Seoul");
  });
  it("returns null when neither is present", () => {
    expect(cityFromGeo({})).toBeNull();
    expect(cityFromGeo(null)).toBeNull();
  });
});
