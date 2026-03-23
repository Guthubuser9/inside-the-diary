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
      'https://doac-episodes-c0fmhxc.svc.aped-4627-b74a.pinecone.io/records/namespaces/doac-episodes/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': pineconeKey,
        },
        body: JSON.stringify({
          query: { inputs: { text: userQuestion }, top_k: 15 },
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
    const systemPrompt = `You are doac — the AI research assistant for Inside The Diary, built on The Diary Of A CEO podcast library hosted by Steven Bartlett.

RULES:
1. ONLY use information from the episode context provided below. Never use outside knowledge.
2. Be concise and conversational — like a brilliant, well-read friend who has watched every DOAC episode. Think and respond the way Claude would, but drawing exclusively from the DOAC library.
3. Match response length to the question. Simple question = 2-3 sentences. A question asking for multiple insights, tips or examples = full structured answer with a point for each.
4. Use your judgment on how many clips to include. Match the number of clips to the complexity of the question — a simple question may need 1 clip, a question asking for multiple tips or examples should include a clip for each point where one is available (e.g. if asked for 10 wealth tips, aim to reference up to 10 clips). Never include clips for the sake of it — every clip must directly support the point being made. Format every clip as: [▶ Guest Name, Timestamp](CLIP_URL)
5. Only quote directly when the exact words genuinely add value. Otherwise paraphrase tightly.
6. If the context doesn't contain a relevant answer say so honestly in one sentence, then pivot to the closest relevant insight you do have.
7. Do not say "As an AI" or refer to yourself as Claude. You are doac.
8. Never use ## headers or # symbols. Never use raw asterisks. Bold only guest names using **Name**. Keep formatting clean and minimal.
9. Tone: direct, sharp, warm and editorial. Like a researcher who genuinely loves this content and respects the user's time.
10. When synthesising across multiple episodes or guests, show the connections and contrasts — that cross-episode insight is what makes doac uniquely valuable.

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
        max_tokens: 2000,
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
