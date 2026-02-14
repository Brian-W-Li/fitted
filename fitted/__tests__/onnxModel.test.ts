/**
 * Unit tests for the ONNX model wrapper (Lab06).
 * Tests input validation and behavior without loading the real model file.
 */

import { ONNXModel } from "@/lib/onnxModel";

describe("ONNXModel", () => {
  it("resolves model path when constructor given no path", () => {
    const model = new ONNXModel();
    expect(model).toBeDefined();
    // init() may fail in test env (no .onnx file or wrong cwd); we only check construction
  });

  it("predict rejects invalid feature length before init", async () => {
    const model = new ONNXModel("/nonexistent/model.onnx");
    await expect(model.predict([])).rejects.toThrow(/160-dim/);
    await expect(model.predict(new Array(80).fill(0))).rejects.toThrow(/160-dim/);
    await expect(model.predict(new Array(200).fill(0))).rejects.toThrow(/160-dim/);
  });

  it("predictBatch rejects rows with wrong dimension", async () => {
    const model = new ONNXModel("/nonexistent/model.onnx");
    await expect(
      model.predictBatch([new Array(80).fill(0), new Array(160).fill(0)])
    ).rejects.toThrow(/160-dim/);
  });
});
