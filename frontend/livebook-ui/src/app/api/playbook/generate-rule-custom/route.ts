const backendBaseUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:5002";
const backendUrl = `${backendBaseUrl}/playbook/generate-rule-custom`;

export async function POST(request: Request) {
  console.log("[PROXY /api/playbook/generate-rule-custom] Incoming request");

  try {
    const body = await request.text();
    console.log("  body (first 500 chars):", body.substring(0, 500));

    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
      },
      body,
    });

    console.log("[PROXY /api/playbook/generate-rule-custom] Backend response:");
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
        "content-type": backendResponse.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("[PROXY /api/playbook/generate-rule-custom] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}
