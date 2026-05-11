import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const backendUrl = "http://localhost:3020/question";
  const q = request.nextUrl.searchParams.get("q");

  console.log("[PROXY /api/question] Incoming GET request");
  console.log("  q:", q);

  if (!q || q.trim().length === 0) {
    return Response.json(
      { error: "Missing query parameter 'q'" },
      { status: 400 }
    );
  }

  const url = `${backendUrl}?q=${encodeURIComponent(q)}`;

  try {
    const backendResponse = await fetch(url, {
      method: "GET",
    });

    console.log("[PROXY /api/question] Backend response:");
    console.log("  status:", backendResponse.status, backendResponse.statusText);

    const responseBody = await backendResponse.text();
    console.log(
      "  response body (first 2000 chars):",
      responseBody.substring(0, 2000)
    );

    return new Response(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: {
        "content-type": backendResponse.headers.get("content-type") || "text/plain",
      },
    });
  } catch (error) {
    console.error("[PROXY /api/question] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}
