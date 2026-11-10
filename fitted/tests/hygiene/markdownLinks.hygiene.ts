import { markdownLocalTargets } from "./markdownLinks";

describe("maintained Markdown navigation", () => {
  test("relative navigation and image targets retain their path while discarding fragments", () => {
    expect(markdownLocalTargets('[guide](../README.md#workflow) ![view](images/demo.png) [space](<folder name/guide.md>) [encoded](folder%20name/guide.md)')).toEqual([
      "../README.md", "images/demo.png", "folder name/guide.md",
    ]);
  });

  test("reference links are checked, including an optional title", () => {
    expect(markdownLocalTargets('[guide][entry]\n[entry]: plans/current.md#next "Current plan"')).toEqual(["plans/current.md"]);
  });

  test("external links, same-file fragments and code examples are skipped", () => {
    expect(markdownLocalTargets('[web](https://example.com/page) [mail](mailto:owner@example.com) [fragment](#section) [shared](//example.com/path) `[example](missing.md)`\n```md\n[example](also-missing.md)\n```')).toEqual([]);
  });
});
