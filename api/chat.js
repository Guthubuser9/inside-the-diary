export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;

  if (!anthropicKey || !pineconeKey) {
    return res.status(500).json({ error: 'API keys not configured' });
  }

  const { messages } = req.body;
  const userQuestion = messages[messages.length - 1].content;

  try {
    // Step 1: Search Pinecone for relevant chunks
    const searchResponse = await fetch(
      'https://doac-episodes-your-index-host.svc.pinecone.io/records/namespaces/doac-episodes/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': pineconeKey,
        },
        body: JSON.stringify({
          query: { inputs: { text: userQuestion }, top_k: 8 },
          fields: ['text', 'title', 'timestamp', 'clip_url', 'video_id'],
        }),
      }
    );

    const searchData = await searchResponse.json();
    const hits = searchData.result?.hits || [];

    // Step 2: Build context from relevant chunks
    const context = hits.map(hit => {
      const f = hit.fields;
      return `EPISODE: "${f.title}"\nTIMESTAMP: ${f.timestamp}\nCLIP: ${f.clip_url}\nCONTENT: ${f.text}`;
    }).join('\n\n---\n\n');

    // Step 3: Build system prompt with retrieved context
    const systemPrompt = `You are doac — the AI research assistant for Inside The Diary, built on The Diary Of A CEO episode library.

RULES:
1. ONLY use information from the episode context provided below. Never use outside knowledge.
2. Be concise and conversational. Match length to the question — simple = 2-3 sentences, complex = short paragraphs.
3. Always include at least one timestamped clip link per response using: [▶ Guest Name, Timestamp](CLIP_URL). Clips are non-negotiable.
4. Only quote directly when the exact words genuinely add value. Otherwise paraphrase.
5. Never include more than 2 clip links per response.
6. If the context doesn't contain a relevant answer say so honestly in one sentence.
7. Do not say "As an AI" or refer to yourself as Claude. You are doac.
8. Never use ## headers or # symbols. Never use raw asterisks. Bold only guest names using **Name**.
9. Tone: direct, sharp, editorial. Respect the user's time.

RELEVANT EPISODE CONTEXT:
${context}`;

    // Step 4: Call Claude with the retrieved context
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages,
      }),
    });

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      return res.status(claudeResponse.status).json({
        error: claudeData.error?.message || 'Claude API error',
      });
    }

    return res.status(200).json(claudeData);

  } catch (error) {
    return res.status(500).json({
      error: 'Something went wrong',
      message: error.message,
    });
  }
}
```

Before you commit — I need one thing from you. Go to **Pinecone → your `doac-episodes` index → click on it** and look for a **Host** URL. It will look something like:
```
doac-episodes-abc123.svc.pinecone.io
