jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));
jest.mock("@/lib/imageStorage", () => ({
  MAX_WARDROBE_IMAGE_BYTES: 5 * 1024 * 1024,
  uploadWardrobeImage: jest.fn(),
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function makeFile(sizeBytes = 8) {
  return new File([new Uint8Array(sizeBytes).fill(1)], "test.png", { type: "image/png" });
}

function makeRequest({
  file = makeFile(),
  contentLength,
}: {
  file?: File;
  contentLength?: string;
} = {}) {
  const fd = new FormData();
  fd.append("file", file);

  const formData = jest.fn(async () => fd);
  return {
    headers: {
      get: (h: string) => {
        const header = h.toLowerCase();
        if (header === "authorization") return "Bearer fake-token";
        if (header === "content-length") return contentLength ?? null;
        return null;
      },
    },
    formData,
  };
}

function setupMocks() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  const { uploadWardrobeImage } = jest.requireMock("@/lib/imageStorage") as {
    uploadWardrobeImage: jest.Mock;
  };

  adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });

  const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
  initDatabase.mockResolvedValue({
    User: {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
      }),
    },
    WardrobeItem: {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "item-1", imagePath: undefined }),
      }),
      updateOne,
    },
    WardrobeImage: {
      deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    },
  });

  uploadWardrobeImage.mockResolvedValue({ imagePath: "mongo:image-1" });
  return { updateOne, uploadWardrobeImage };
}

describe("POST /api/wardrobe/[id]/image — upload bounds", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns 413 from Content-Length before buffering multipart form data", async () => {
    const { uploadWardrobeImage } = setupMocks();
    const req = makeRequest({ contentLength: String(5 * 1024 * 1024 + 64 * 1024 + 1) });

    const { POST } = await import("@/app/api/wardrobe/[id]/image/route");
    const res = await POST(req as any, params("item-1"));

    expect(res.status).toBe(413);
    expect(req.formData).not.toHaveBeenCalled();
    expect(uploadWardrobeImage).not.toHaveBeenCalled();
  });

  it("returns 413 when the storage cap catches an oversized image without a length header", async () => {
    const { updateOne, uploadWardrobeImage } = setupMocks();
    uploadWardrobeImage.mockRejectedValue(new Error("Image too large (max 5MB)"));
    const req = makeRequest();

    const { POST } = await import("@/app/api/wardrobe/[id]/image/route");
    const res = await POST(req as any, params("item-1"));

    expect(res.status).toBe(413);
    expect(req.formData).toHaveBeenCalledTimes(1);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

export {};
