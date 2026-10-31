import { collectionExists, getCollectionName, getQdrantClient, isQdrantConfigured } from "@/lib/qdrant";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    return Response.json({ error: "Invalid document id." }, { status: 400 });
  }
  if (!isQdrantConfigured()) {
    return Response.json({ error: "Qdrant is not configured." }, { status: 503 });
  }

  try {
    if (await collectionExists()) {
      await getQdrantClient().delete(getCollectionName(), {
        wait: true,
        filter: {
          must: [{ key: "documentId", match: { value: documentId } }],
        },
      });
    }
    return Response.json({ deleted: true });
  } catch {
    return Response.json(
      { error: "Could not remove the document from Qdrant." },
      { status: 503 },
    );
  }
}
