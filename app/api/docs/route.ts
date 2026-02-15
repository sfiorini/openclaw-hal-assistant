import { NextRequest, NextResponse } from "next/server"

import { getServerEnvConfig } from "../../../lib/config/env"

const createSwaggerHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>OpenClaw HAL API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      body {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: "/api/openapi",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis],
        })
      }
    </script>
    </body>
</html>`
const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error")

export async function GET(request: NextRequest) {
  let env

  try {
    env = getServerEnvConfig()
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }

  if (!env.OPENCLAW_API_DOCS_ENABLED) {
    return NextResponse.json({ error: "API docs are disabled" }, { status: 404 })
  }

  if (env.OPENCLAW_API_DOCS_TOKEN && request.headers.get("x-api-docs-token") !== env.OPENCLAW_API_DOCS_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return new NextResponse(createSwaggerHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}
