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
