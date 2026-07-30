export type DataComparisonSeed = {
  deviceId: string;
  streamId: string;
  startTime?: string;
  endTime?: string;
};

export function encodeComparisonSeeds(items: DataComparisonSeed[]) {
  return JSON.stringify(items.slice(0, 8));
}

export function parseComparisonSeeds(value: string | null): DataComparisonSeed[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is DataComparisonSeed =>
          typeof item === "object"
          && item !== null
          && typeof (item as DataComparisonSeed).deviceId === "string"
          && typeof (item as DataComparisonSeed).streamId === "string"
          && (
            (item as DataComparisonSeed).startTime === undefined
            || typeof (item as DataComparisonSeed).startTime === "string"
          )
          && (
            (item as DataComparisonSeed).endTime === undefined
            || typeof (item as DataComparisonSeed).endTime === "string"
          )
          && Boolean((item as DataComparisonSeed).deviceId)
          && Boolean((item as DataComparisonSeed).streamId),
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function dataComparisonPath(
  items: DataComparisonSeed[],
  startTime: string,
  endTime: string,
) {
  const params = new URLSearchParams({
    items: encodeComparisonSeeds(items),
    start: startTime,
    end: endTime,
  });
  return `/data-compare?${params}`;
}

export function datasetCreatePath(input: {
  sourceIds: string[];
  startTime: string;
  endTime: string;
  name?: string;
}) {
  const params = new URLSearchParams({
    sources: input.sourceIds.slice(0, 32).join(","),
    start: input.startTime,
    end: input.endTime,
  });
  if (input.name) params.set("name", input.name);
  return `/datasets/new?${params}`;
}
