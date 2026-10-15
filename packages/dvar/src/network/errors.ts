/** Never include destination URLs, request bodies, headers, or resolver errors here. */
export class DvarNetworkError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(`Dvar network request rejected (${code})`);
    this.name = "DvarNetworkError";
    this.code = code;
  }
}
