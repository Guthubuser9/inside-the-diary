export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });
  }

  const body = await req.json();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
      system: body.system,
      messages: body.messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    return new Response(JSON.stringify({ error: error.error?.message || 'API error' }), { status: response.status });
  }

  // Transform the Anthropic SSE stream into clean text chunks for the frontend
  const transformer = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`)
              );
            }
          } catch (e) {
            // skip malformed chunks
          }
        }
      }
    }
  });

  return new Response(response.body.pipeThrough(transformer), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
