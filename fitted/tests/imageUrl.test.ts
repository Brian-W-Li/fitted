/**
 * resolveImageSrc — the §6.5 image-reference resolver used by the dashboard + history surfaces.
 * Regression pin for the bug where an already-resolved `displayItems.imageUrl="/api/images/<id>"`
 * (what `mlRequestAdapter.resolveImageUrl` emits into the immutable snapshot) rendered as no image
 * because the old helper only understood `mongo:` and returned null for it.
 */
import { resolveImageSrc } from "@/lib/imageUrl";

describe("resolveImageSrc", () => {
  it("passes an already-resolved §6.5 displayItems.imageUrl through unchanged (the fixed bug)", () => {
    expect(resolveImageSrc("/api/images/6a4eb442443135439ac080d9")).toBe(
      "/api/images/6a4eb442443135439ac080d9",
    );
  });

  it("resolves a raw mongo:<id> reference (the wardrobe surface)", () => {
    expect(resolveImageSrc("mongo:6a4eb442443135439ac080d9")).toBe(
      "/api/images/6a4eb442443135439ac080d9",
    );
  });

  it("passes external http(s) imageUrls through (§15.2 passthrough)", () => {
    expect(resolveImageSrc("https://img.example/x.jpg")).toBe("https://img.example/x.jpg");
    expect(resolveImageSrc("http://img.example/x.jpg")).toBe("http://img.example/x.jpg");
  });

  it("treats a no-image reference as null (a no-image item is legitimate)", () => {
    expect(resolveImageSrc("")).toBeNull();
    expect(resolveImageSrc(undefined)).toBeNull();
    expect(resolveImageSrc(null)).toBeNull();
  });

  it("rejects an unrecognized/unsafe scheme → null", () => {
    expect(resolveImageSrc("javascript:alert(1)")).toBeNull();
    expect(resolveImageSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(resolveImageSrc("ftp://x/y")).toBeNull();
  });
});
