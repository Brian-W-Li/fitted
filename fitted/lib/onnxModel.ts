import * as ort from "onnxruntime-node";
import { existsSync } from "fs";
import { resolve } from "path";

const EXPECTED_DIM = 160;

/**
 * ONNX model wrapper for outfit compatibility scoring.
 * Model: 160-dim pair features (e.g. top_embedding concat bottom_embedding) → compatibility score 0–1.
 */
export class ONNXModel {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;

  constructor(modelPath?: string) {
    if (modelPath) {
      this.modelPath = modelPath;
      return;
    }
    const cwd = process.cwd();
    const fromRoot = resolve(cwd, "ml-system", "outfit_model.onnx");
    const fromFitted = resolve(cwd, "..", "ml-system", "outfit_model.onnx");
    this.modelPath = existsSync(fromRoot)
      ? fromRoot
      : existsSync(fromFitted)
        ? fromFitted
        : fromRoot;
  }

  async init(): Promise<void> {
    if (this.session) return;

    const path = this.modelPath;
    try {
      this.session = await ort.InferenceSession.create(path, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes(".onnx.data") || msg.includes("file_size")) {
        throw new Error(
          "ONNX model was exported with external data. Re-export from Colab as a single file: " +
            "onnx.save(model, 'outfit_model.onnx') or add outfit_model.onnx.data to ml-system/"
        );
      }
      throw e;
    }
  }

  /**
   * Run inference: 160-dim pair feature vector → compatibility score in [0, 1].
   */
  async predict(pairFeatures: number[]): Promise<number> {
    if (pairFeatures.length !== EXPECTED_DIM) {
      throw new Error(
        `Expected ${EXPECTED_DIM}-dim pair features, got ${pairFeatures.length}`
      );
    }
    if (!this.session) {
      await this.init();
    }
    if (!this.session) {
      throw new Error("ONNX session failed to initialize");
    }

    const inputName = this.session.inputNames[0];
    const inputTensor = new ort.Tensor(
      "float32",
      new Float32Array(pairFeatures),
      [1, EXPECTED_DIM]
    );

    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await this.session.run(feeds);

    const outputName = this.session.outputNames[0];
    const output = results[outputName];
    if (!output || !("data" in output)) {
      throw new Error("ONNX model returned no output");
    }

    const data = (output as ort.Tensor).data as Float32Array;
    const score = Number(data[0]);
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Predict compatibility for multiple pairs in one batch (optional optimization).
   * Each row of pairFeatures is 160 dims; returns array of scores.
   */
  async predictBatch(pairFeaturesBatch: number[][]): Promise<number[]> {
    const batchSize = pairFeaturesBatch.length;
    for (const row of pairFeaturesBatch) {
      if (row.length !== EXPECTED_DIM) {
        throw new Error(
          `Expected ${EXPECTED_DIM}-dim pair features per row, got ${row.length}`
        );
      }
    }
    if (!this.session) {
      await this.init();
    }
    if (!this.session) {
      throw new Error("ONNX session failed to initialize");
    }

    const flat = new Float32Array(batchSize * EXPECTED_DIM);
    pairFeaturesBatch.forEach((row, i) => {
      flat.set(row, i * EXPECTED_DIM);
    });

    const inputName = this.session.inputNames[0];
    const inputTensor = new ort.Tensor("float32", flat, [
      batchSize,
      EXPECTED_DIM,
    ]);

    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    const results = await this.session.run(feeds);

    const outputName = this.session.outputNames[0];
    const output = results[outputName];
    if (!output || !("data" in output)) {
      throw new Error("ONNX model returned no output");
    }

    const data = (output as ort.Tensor).data as Float32Array;
    return Array.from(data).map((s) => Math.max(0, Math.min(1, Number(s))));
  }

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
  }
}
