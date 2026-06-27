export function getPath(value: unknown, path: string): unknown {
  if (path.length === 0) return value;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const next = current[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const finalSegment = segments.at(-1);
  if (finalSegment !== undefined) current[finalSegment] = value;
}

export function expandDottedObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.includes(".")) {
      setPath(output, key, value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      output[key] = expandDottedObject(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}
