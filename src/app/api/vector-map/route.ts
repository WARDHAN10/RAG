import { getCollectionName, getQdrantClient, isQdrantConfigured } from "@/lib/qdrant";

const MAX_MAP_POINTS = 200;

type MapPoint = {
  id: string;
  documentId: string;
  name: string;
  chunkIndex: number;
  vector: number[];
};

type ProjectedPoint = Omit<MapPoint, "vector"> & { x: number; y: number };

function normalize(vector: Float64Array) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!length) return new Float64Array(vector.length);
  return Float64Array.from(vector, (value) => value / length);
}

function multiply(matrix: Float64Array[], vector: Float64Array) {
  return Float64Array.from(matrix, (row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  );
}

function principalComponent(matrix: Float64Array[], previous?: Float64Array) {
  let component = normalize(
    Float64Array.from({ length: matrix.length }, (_, index) => Math.sin((index + 1) * 1.618)),
  );

  for (let iteration = 0; iteration < 40; iteration += 1) {
    let next = multiply(matrix, component);
    if (previous) {
      const projection = next.reduce((sum, value, index) => sum + value * previous[index], 0);
      next = Float64Array.from(next, (value, index) => value - projection * previous[index]);
    }
    next = normalize(next);
    if (!next.some((value) => value !== 0)) return next;
    component = next;
  }
  return component;
}

function projectToTwoDimensions(points: MapPoint[]): ProjectedPoint[] {
  if (points.length === 0) return [];

  const dimensions = Math.min(...points.map((point) => point.vector.length));
  const means = new Float64Array(dimensions);
  for (const point of points) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      means[dimension] += point.vector[dimension] / points.length;
    }
  }

  const centered = points.map((point) =>
    Float64Array.from(point.vector.slice(0, dimensions), (value, index) => value - means[index]),
  );
  const gram = centered.map((left, leftIndex) =>
    Float64Array.from(centered, (right, rightIndex) => {
      if (rightIndex > leftIndex) return 0;
      let dot = 0;
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        dot += left[dimension] * right[dimension];
      }
      return dot;
    }),
  );
  for (let row = 0; row < gram.length; row += 1) {
    for (let column = row + 1; column < gram.length; column += 1) {
      gram[row][column] = gram[column][row];
    }
  }

  const first = principalComponent(gram);
  const second = principalComponent(gram, first);
  const firstCoordinates = Array.from(first);
  const secondCoordinates = Array.from(second);
  const firstScale = Math.max(...firstCoordinates.map(Math.abs)) || 1;
  const secondScale = Math.max(...secondCoordinates.map(Math.abs)) || 1;

  return points.map((point, index) => ({
    id: point.id,
    documentId: point.documentId,
    name: point.name,
    chunkIndex: point.chunkIndex,
    x: 50 + (firstCoordinates[index] / firstScale) * 44,
    y: 50 - (secondCoordinates[index] / secondScale) * 44,
  }));
}

export async function GET() {
  if (!isQdrantConfigured()) {
    return Response.json({ error: "Qdrant is not configured." }, { status: 503 });
  }

  try {
    const client = getQdrantClient();
    const collectionName = getCollectionName();
    const collections = await client.getCollections();
    if (!collections.collections.some((collection) => collection.name === collectionName)) {
      return Response.json({ points: [], sampleLimit: MAX_MAP_POINTS });
    }

    const page = await client.scroll(collectionName, {
      limit: MAX_MAP_POINTS,
      with_payload: true,
      with_vector: true,
    });
    const points: MapPoint[] = [];

    for (const point of page.points) {
      const payload = point.payload as Record<string, unknown> | null;
      const rawPoint = point as unknown as { id: string | number; vector?: unknown };
      const rawVector = rawPoint.vector;
      const vector = Array.isArray(rawVector)
        ? rawVector.filter((value): value is number => typeof value === "number")
        : null;

      if (
        !payload ||
        typeof payload.documentId !== "string" ||
        typeof payload.name !== "string" ||
        typeof payload.chunkIndex !== "number" ||
        !vector?.length
      ) {
        continue;
      }

      points.push({
        id: String(rawPoint.id),
        documentId: payload.documentId,
        name: payload.name,
        chunkIndex: payload.chunkIndex,
        vector,
      });
    }

    return Response.json(
      { points: projectToTwoDimensions(points), sampleLimit: MAX_MAP_POINTS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Could not load the vector map from Qdrant." }, { status: 503 });
  }
}
