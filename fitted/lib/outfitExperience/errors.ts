/** Field failures that the future experience API can map to a client validation response. */
export class ExperienceValidationError extends Error {
  constructor(
    public readonly field: "occurredOn" | "timezone" | "context" | "request",
    message: string,
  ) {
    super(message);
    this.name = "ExperienceValidationError";
  }
}

export class ExperienceError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ExperienceError";
  }
}
