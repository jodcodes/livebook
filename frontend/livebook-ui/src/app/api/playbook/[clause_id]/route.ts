import { NextRequest } from "next/server";

const backendBaseUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:5002";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ clause_id: string }> }
) {
  const { clause_id } = await params;
  console.log(`[PROXY /api/playbook/${clause_id}] Incoming DELETE request`);

  try {
    const backendResponse = await fetch(`${backendBaseUrl}/playbook/${encodeURIComponent(clause_id)}`, {
      method: "DELETE",
    });

    console.log(`[PROXY /api/playbook/${clause_id}] Backend response:`);
    console.log("  status:", backendResponse.status, backendResponse.statusText);

    const responseBody = await backendResponse.text();

    return new Response(responseBody || null, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: {
        "content-type": backendResponse.headers.get("content-type") || "text/plain",
      },
    });
  } catch (error) {
    console.error(`[PROXY /api/playbook/${clause_id}] Proxy error:`, error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}
