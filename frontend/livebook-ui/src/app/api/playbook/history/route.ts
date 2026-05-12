export async function GET() {
  const backendBaseUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:5002";
  const backendUrl = `${backendBaseUrl}/playbook/history`;

  console.log("[PROXY /api/playbook/history] Incoming GET request");

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
    });

    console.log("[PROXY /api/playbook/history] Backend response:");
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
    console.error("[PROXY /api/playbook/history] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}
