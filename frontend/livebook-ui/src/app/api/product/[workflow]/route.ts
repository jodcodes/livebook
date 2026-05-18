import { NextRequest } from "next/server";

const backendBaseUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:5002";

const workflowEndpoints: Record<string, string> = {
  "word-review": "/product/word-review",
  "word-review-list": "/product/word-review/list",
  "word-review-actions": "/product/word-review/actions",
  "word-review-action": "/product/word-review/action",
  "word-review-bulk-apply": "/product/word-review/bulk-apply",
  "draft-clause": "/product/draft-clause",
  "clause-library-search": "/product/clause-library/search",
  "clause-library-save": "/product/clause-library/save",
  "clause-library-list": "/product/clause-library/list",
  "precedents-upload": "/product/precedents/upload",
  "precedents-upload-file": "/product/precedents/upload-file",
  "precedents-list": "/product/precedents/list",
  "document-chat": "/product/document-chat",
  "associate-project": "/product/associate-project",
  "associate-project-list": "/product/associate-project/list",
  "associate-project-actions": "/product/associate-project/actions",
  proofread: "/product/proofread",
  "workspace-settings-get": "/product/workspace-settings/get",
  "workspace-settings-save": "/product/workspace-settings/save",
  "workspace-activity-list": "/product/workspace-activity/list",
  "workspace-activity-append": "/product/workspace-activity/append",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflow: string }> }
) {
  const { workflow } = await params;
  const endpoint = workflowEndpoints[workflow];

  if (!endpoint) {
    return Response.json({ error: `Unknown product workflow: ${workflow}` }, { status: 404 });
  }

  try {
    const body = await request.arrayBuffer();
    const backendResponse = await fetch(`${backendBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
      },
      body,
    });
    const responseBody = await backendResponse.text();

    return new Response(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: {
        "content-type": backendResponse.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    return Response.json({ error: "Proxy error", details: String(error) }, { status: 500 });
  }
}
