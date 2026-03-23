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

  // Verified guest name lookup by video ID
  const GUEST_MAP = {
    "9uSXOr-AdAU": "Chase Hughes",
    "fpETS6q1Hww": "Daniel Priestley",
    "xcXfcXJvMXg": "Robert Pape",
    "nrwNSSyKuD4": "Wesley Huff",
    "e9dljIL4rBk": "Andrew Bustamante, Annie Jacobsen & Benjamin Radd",
    "t38LbMVoPCs": "Larry Johnson",
    "Xm_PHZXGe-w": "Dr. Robert Lustig",
    "s52O1JH2tnU": "Dara Khosrowshahi",
    "ajgwabD4_HE": "Alex Honnold",
    "EScgrk7oEwU": "Tristan Harris",
    "Uvy5mcLiWW0": "James Sexton",
    "pXlMKzcZlwM": "Dr. Matthew Walker",
    "0t_DD5568RA": "Dr. Richard Isaacson",
    "sR7S2Q3c04g": "Dotan Negrin",
    "99xyy1nUpug": "JL Collins",
    "w3dTmyZq4Qk": "Dr. Sabine Hazan",
    "nJeU72Rgjh4": "Alex Krainer",
    "yUNoJ32eLBc": "Andrew Bustamante",
    "I_w81rptxkc": "Tony Robbins",
    "FoeQUNASmTU": "JL Collins",
    "C7LL7VwP8Nc": "Dr. Benjamin Bikman"
  };

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
          query: { inputs: { text: userQuestion }, top_k: 30 },
          fields: ['text', 'title', 'timestamp', 'clip_url', 'video_id'],
        }),
      }
    );

    const searchData = await searchResponse.json();
    const allHits = searchData.result?.hits || [];

    // Step 2: Deduplicate — max 3 chunks per episode for diversity
    const episodeCounts = {};
    const hits = [];
    for (const hit of allHits) {
      const vid = hit.fields.video_id;
      episodeCounts[vid] = (episodeCounts[vid] || 0) + 1;
      if (episodeCounts[vid] <= 3) hits.push(hit);
      if (hits.length >= 15) break;
    }

    // Step 3: Build context with verified guest names
    const context = hits.map(hit => {
      const f = hit.fields;
      const guest = GUEST_MAP[f.video_id] || f.title.split(':')[0].trim();
      return `EPISODE: "${f.title}"\nGUEST: ${guest}\nTIMESTAMP: ${f.timestamp}\nCLIP: ${f.clip_url}\nCONTENT: ${f.text}`;
    }).join('\n\n---\n\n');

    // Step 4: System prompt
    const systemPrompt = `You are doac — the AI research assistant for Inside The Diary, built on The Diary Of A CEO podcast library hosted by Steven Bartlett.

RULES:
1. ONLY use information from the episode context provided below. Never use outside knowledge.
2. Write in flowing, natural prose — never use headers, bullet points or numbered lists unless the question specifically asks for a list. Answers should read like a thoughtful, well-informed friend is talking to you, not a formatted document.
3. Match response length to the question. Simple question = 2-3 sentences. Complex question = a few short paragraphs that flow naturally into each other.
4. Weave clip links naturally into your prose at the moment they are relevant — not all at the end. Format every clip as: [▶ Guest Name, Timestamp](CLIP_URL) using the GUEST field provided. Include as many clips as the question warrants — one per key point made.
5. Only quote directly when the exact words genuinely add value. Otherwise paraphrase tightly.
6. Draw from multiple guests and episodes where possible — the cross-episode synthesis is what makes doac uniquely valuable.
7. If the context doesn't contain a relevant answer say so honestly in one sentence, then pivot to the closest relevant insight you do have.
8. Do not say "As an AI" or refer to yourself as Claude. You are doac.
9. Never use ## headers, # symbols, or raw asterisks. Bold only guest names using **Name** when first introducing them.
10. Tone: direct, warm, editorial. Like a researcher who genuinely loves this content and respects the user's time.

RELEVANT EPISODE CONTEXT:
${context}`;

    // Step 5: Call Claude
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
