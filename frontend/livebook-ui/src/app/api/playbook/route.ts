const backendBaseUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:5002";
const backendUrl = `${backendBaseUrl}/playbook`;

export async function GET() {
  console.log("[PROXY /api/playbook] Incoming GET request");

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
    });

    console.log("[PROXY /api/playbook] Backend response:");
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
    console.error("[PROXY /api/playbook] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  console.log("[PROXY /api/playbook] Incoming request:");
  console.log("  method:", request.method);
  console.log("  content-type:", request.headers.get("content-type"));

  try {
    const body = await request.arrayBuffer();
    console.log("  body size bytes:", body.byteLength);

    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") || "",
      },
      body,
    });

    console.log("[PROXY /api/playbook] Backend response:");
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
    console.error("[PROXY /api/playbook] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  console.log("[PROXY /api/playbook] Incoming PATCH request");

  try {
    const body = await request.text();
    console.log("  body (first 500 chars):", body.substring(0, 500));

    const backendResponse = await fetch(backendUrl, {
      method: "PATCH",
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
      },
      body,
    });

    console.log("[PROXY /api/playbook] Backend response:");
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
    console.error("[PROXY /api/playbook] Proxy error:", error);
    return Response.json(
      { error: "Proxy error", details: String(error) },
      { status: 500 }
    );
  }
}
