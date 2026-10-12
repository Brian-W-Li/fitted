// jsdom project setup — jest-dom matchers (toBeInTheDocument, toBeDisabled, …) for the
// client-component behavioral tests. Node-project tests never load this file.
import "@testing-library/jest-dom";

// jsdom does not implement object-URL creation; the add form's image-preview effect calls it.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:mock", writable: true });
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
}

// Native dialog focus/inert behavior is covered by the authenticated browser baseline.
// jsdom only needs its open-state methods for component interaction tests.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
}
