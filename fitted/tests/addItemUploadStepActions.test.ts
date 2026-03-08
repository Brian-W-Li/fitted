import React from "react";
import { AddItemUploadStepActions } from "@/lib/addItemUploadStepActions";

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], "shirt.png", { type: "image/png" });
}

function nodeText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) return nodeText(node.props.children);
  return "";
}

function findElement(
  node: unknown,
  predicate: (el: React.ReactElement) => boolean
): React.ReactElement | null {
  if (node == null || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;

  if (predicate(node)) return node;
  return findElement(node.props.children, predicate);
}

describe("AddItemUploadStepActions", () => {
  it("renders a visible manual-entry option", () => {
    const tree = AddItemUploadStepActions({
      imageFile: null,
      onClose: () => {},
    });
    expect(nodeText(tree)).toContain("Skip photo · Enter manually");
  });

  it("clicking 'Skip photo · Enter manually' calls onSkipToForm with the current file (or null)", () => {
    const onSkipToForm = jest.fn();
    const file = makeFile();

    const treeWithFile = AddItemUploadStepActions({
      imageFile: file,
      onClose: () => {},
      onSkipToForm,
    });

    const skipBtn = findElement(treeWithFile, (el) => el.type === "button" && nodeText(el) === "Skip photo · Enter manually");
    expect(skipBtn).not.toBeNull();
    (skipBtn!.props.onClick as () => void)();
    expect(onSkipToForm).toHaveBeenCalledWith(file);

    onSkipToForm.mockClear();
    const treeNoFile = AddItemUploadStepActions({
      imageFile: null,
      onClose: () => {},
      onSkipToForm,
    });
    const skipBtn2 = findElement(treeNoFile, (el) => el.type === "button" && nodeText(el) === "Skip photo · Enter manually");
    (skipBtn2!.props.onClick as () => void)();
    expect(onSkipToForm).toHaveBeenCalledWith(null);
  });

  it("when CV inference fails, renders a contextual banner and a 'Continue manually' action", () => {
    const onSkipToForm = jest.fn();
    const file = makeFile();
    const cvError = "Image analysis is temporarily unavailable. You can continue by filling the form manually.";

    const tree = AddItemUploadStepActions({
      imageFile: file,
      cvError,
      onClose: () => {},
      onSkipToForm,
    });

    expect(nodeText(tree)).toContain(cvError);
    const continueBtn = findElement(tree, (el) => el.type === "button" && nodeText(el) === "Continue manually →");
    expect(continueBtn).not.toBeNull();
    (continueBtn!.props.onClick as () => void)();
    expect(onSkipToForm).toHaveBeenCalledWith(file);
  });

  it("prevents duplicate analyze submits while analyzing by disabling the analyze button", () => {
    const file = makeFile();

    const analyzingTree = AddItemUploadStepActions({
      imageFile: file,
      isAnalyzing: true,
      onClose: () => {},
      onAnalyze: () => {},
    });
    const analyzeBtn = findElement(
      analyzingTree,
      (el) =>
        el.type === "button" &&
        typeof el.props.className === "string" &&
        el.props.className.includes("bg-slate-900")
    );
    expect(analyzeBtn).not.toBeNull();
    expect(analyzeBtn!.props.disabled).toBe(true);

    const noFileTree = AddItemUploadStepActions({
      imageFile: null,
      isAnalyzing: false,
      onClose: () => {},
      onAnalyze: () => {},
    });
    const analyzeBtn2 = findElement(
      noFileTree,
      (el) =>
        el.type === "button" &&
        typeof el.props.className === "string" &&
        el.props.className.includes("bg-slate-900")
    );
    expect(analyzeBtn2).not.toBeNull();
    expect(analyzeBtn2!.props.disabled).toBe(true);
  });
});

