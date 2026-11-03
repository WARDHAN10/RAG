const MAX_RESET_REQUEST_BYTES = 1024;

export async function handleResetRequest(
  request: Request,
  resetCollection: () => Promise<void>,
) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESET_REQUEST_BYTES) {
    return Response.json({ error: "Reset confirmation request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Confirm the reset request before clearing the index." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirm !== true) {
    return Response.json({ error: "Reset was not confirmed." }, { status: 400 });
  }

  try {
    await resetCollection();
    return Response.json({ reset: true });
  } catch {
    return Response.json(
      { error: "Could not reset the Qdrant index. Check the database and try again." },
      { status: 503 },
    );
  }
}
