// api/generate-tips.js
// Generates per-hole caddie tips for a given course.
// Called from admin.html after a new course is saved.
//
// POST body: {
//   courseName: string,       // e.g. "Hoebridge Golf Centre"
//   courseSlug: string,       // e.g. "hoebridge-golf-centre"
//   location:   string,       // e.g. "Woking, Surrey"
//   holes: [                  // 18 items
//     { num, par, si, yardage }
//   ]
// }
//
// Response: {
//   tips: [
//     { hole: 1, tip: "...", confidence: "high"|"medium"|"low", source: "golf_monthly"|"club_website"|"general_review"|"inferred" }
//   ]
// }

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const { courseName, courseSlug, location, holes } = req.body || {};

    if (!courseName || !holes || !Array.isArray(holes) || holes.length !== 18) {
        return res.status(400).json({ error: 'Missing or invalid fields. Requires courseName and 18 holes.' });
    }

    // Build the hole data summary for the prompt
    const holesSummary = holes.map(h =>
        `Hole ${h.num}: Par ${h.par}, SI ${h.si}, ${h.yardage ? h.yardage + 'y' : 'yardage unknown'}`
    ).join('\n');

    const prompt = `You are an expert golf caddie and course knowledge researcher. Your job is to find accurate, specific, actionable playing tips for every hole at ${courseName}${location ? ` in ${location}` : ''}.

COURSE SCORECARD:
${holesSummary}

YOUR TASK:
Generate one playing tip per hole (18 total). Each tip must be honest, specific, and genuinely useful to a mid-handicap golfer (handicap 15-28) playing the hole for the first time.

SOURCE PRIORITY — search your knowledge in this exact order for each hole:
1. Golf Monthly forums (golfmonthly.com/forums) — HIGHEST PRIORITY. Real golfers sharing specific hole knowledge. Look for threads about this course.
2. The club's own website hole descriptions — official but sometimes vague.
3. Golfshake, GolfPass, Where2Golf, or similar review sites with hole-specific detail.
4. General inference from par, SI, and yardage — LAST RESORT only if nothing specific is known. Always flag this clearly.

TIP QUALITY RULES:
- Be specific to THIS hole. "Hit fairway, approach green" is not acceptable.
- Mention actual hazards, doglegs, elevation changes, bunker positions, water if you know them.
- For danger holes (high SI = harder), give a clear strategy: where to aim off the tee, what to avoid, what score to accept.
- For easier holes (low SI number = harder, high SI number = easier), give attacking advice.
- Keep each tip to 1-2 sentences max. Punchy and useful, not an essay.
- Never make up specific details you aren't confident about. If you only know general character, say so honestly.

CONFIDENCE LEVELS:
- "high" — tip sourced from Golf Monthly forums or club website with specific hole detail
- "medium" — sourced from general golf review sites with some hole-specific mentions  
- "low" — inferred from par/SI/yardage only, no specific source found

Respond ONLY with a valid JSON object. No preamble, no markdown fences, no explanation. Exactly this structure:

{
  "courseName": "${courseName}",
  "tips": [
    {
      "hole": 1,
      "tip": "...",
      "confidence": "high|medium|low",
      "source": "golf_monthly|club_website|general_review|inferred"
    }
  ]
}

All 18 holes must be present in the tips array, ordered hole 1 to 18.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 4000, // tips for 18 holes needs more room than a debrief
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data?.error?.message || `Anthropic API error ${response.status}`
            });
        }

        // Extract text from response
        const rawText = data.content?.map(b => b.text || '').join('') || '';

        // Strip any accidental markdown fences
        const clean = rawText.replace(/```json|```/g, '').trim();

        // Parse and validate
        let parsed;
        try {
            parsed = JSON.parse(clean);
        } catch (parseErr) {
            // Try regex extraction as fallback
            const match = clean.match(/\{[\s\S]*\}/);
            if (match) {
                try { parsed = JSON.parse(match[0]); }
                catch { /* fall through to error */ }
            }
            if (!parsed) {
                return res.status(500).json({
                    error: 'Failed to parse AI response as JSON',
                    raw: rawText.slice(0, 500) // first 500 chars for debugging
                });
            }
        }

        // Validate we got 18 tips
        if (!parsed.tips || parsed.tips.length !== 18) {
            return res.status(500).json({
                error: `Expected 18 tips, got ${parsed.tips?.length ?? 0}`,
                raw: rawText.slice(0, 500)
            });
        }

        return res.status(200).json(parsed);

    } catch (e) {
        return res.status(500).json({ error: e.message || 'Unknown server error' });
    }
}
