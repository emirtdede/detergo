import { describe, expect, it } from "vitest";

import { categoryOptionsOf, projectOptionsOf } from "../features/items/table-utils";
import { makeItem } from "./fixtures";

describe("ItemTable filter options", () => {
  it("deduplicates project names and skips items without one", () => {
    const items = [
      makeItem({ projectName: "b-app" }),
      makeItem({ projectName: "a-app" }),
      makeItem({ projectName: "b-app" }),
      makeItem({ projectName: null }),
    ];

    expect(projectOptionsOf(items)).toEqual(["a-app", "b-app"]);
  });

  it("returns sorted category slugs, never localized labels", () => {
    const items = [
      makeItem({ category: "cache" }),
      makeItem({ category: "dependencies" }),
      makeItem({ category: "cache" }),
    ];

    expect(categoryOptionsOf(items)).toEqual(["cache", "dependencies"]);
  });

  it("carries slugs and raw user data only, so a locale change cannot invalidate the memo", () => {
    const items = [
      makeItem({ category: "cache", projectName: "app" }),
      makeItem({ category: "logs", projectName: "lib" }),
    ];

    // The table memoizes on `[items]`. That is only correct because neither
    // list contains localized text: labels are resolved during render.
    expect(categoryOptionsOf(items)).toEqual(["cache", "logs"]);
    expect(projectOptionsOf(items)).toEqual(["app", "lib"]);
  });
});
