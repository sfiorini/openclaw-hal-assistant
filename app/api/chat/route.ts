import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN
  const agentId = process.env.OPENCLAW_AGENT_ID || "main"

  if (!gatewayUrl || !gatewayToken) {
    return NextResponse.json(
      { error: "OpenClaw gateway is not configured" },
      { status: 500 }
    )
  }

  try {
    const { message, conversationHistory } = await request.json()

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "No message provided" },
        { status: 400 }
      )
    }

    // Build conversation messages
    const messages = [
      {
        role: "system" as const,
        content:
          "You are HAL 9000, the advanced AI from 2001: A Space Odyssey. You speak in a calm, measured, and polite tone. You are helpful, knowledgeable, and always precise. Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown formatting, code blocks, or special characters in your responses.",
      },
      ...(conversationHistory || []),
      { role: "user" as const, content: message },
    ]

    // Call the OpenClaw gateway (OpenAI Chat Completions compatible)
    const response = await fetch(
      `${gatewayUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          model: agentId,
          messages,
          temperature: 0.7,
          max_tokens: 500,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("OpenClaw gateway error:", errorText)
      return NextResponse.json(
        { error: "Chat completion failed" },
        { status: response.status }
      )
    }

    const data = await response.json()
    const assistantMessage =
      data.choices?.[0]?.message?.content || "I'm sorry, I could not generate a response."

    return NextResponse.json({
      text: assistantMessage,
      conversationHistory: [
        ...(conversationHistory || []),
        { role: "user", content: message },
        { role: "assistant", content: assistantMessage },
      ],
    })
  } catch (error) {
    console.error("Chat route error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
