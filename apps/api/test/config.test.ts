import { describe, expect, it } from "vitest";
import { webOrigins } from "../src/config";

describe("webOrigins", () => {
  it("adds the www or bare twin of the site", () => {
    expect(webOrigins("https://codewrapped.app")).toEqual(["https://codewrapped.app", "https://www.codewrapped.app"]);
    expect(webOrigins("https://www.codewrapped.app/")).toEqual(["https://www.codewrapped.app", "https://codewrapped.app"]);
    expect(webOrigins("http://localhost:3001")).toEqual(["http://localhost:3001"]);
  });
});
