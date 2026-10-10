const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";
const REQUEST_TIMEOUT_MS = 40000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set in environment variables.");
      return res.status(500).json({ error: "Server is not configured (missing API key)." });
    }

    const { image, hand, language } = req.body || {};

    if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
      return res.status(400).json({ error: "Invalid or missing image data." });
    }
    if (!["right", "left"].includes(hand)) {
      return res.status(400).json({ error: "Invalid hand value. Expected 'right' or 'left'." });
    }
    const lang = language === "en" ? "en" : "ur";

    const approxBytes = Math.ceil((image.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image is too large. Please upload an image under 8 MB." });
    }

    const systemPrompt = buildSystemPrompt(lang, hand);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let openaiResp;
    try {
      openaiResp = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    lang === "ur"
                      ? "منسلک تصویر کا تجزیہ کریں اور صرف بیان کردہ JSON فارمیٹ میں جواب دیں۔"
                      : "Analyze the attached image and respond ONLY in the specified JSON format.",
                },
                { type: "image_url", image_url: { url: image, detail: "high" } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        return res.status(504).json({ error: "The vision model took too long to respond. Please try again." });
      }
      console.error("Network error calling OpenAI:", fetchErr);
      return res.status(502).json({ error: "Could not reach the analysis service. Please try again." });
    }
    clearTimeout(timeoutId);

    if (!openaiResp.ok) {
      const errText = await safeText(openaiResp);
      console.error("OpenAI API error:", openaiResp.status, errText);
      if (openaiResp.status === 401) {
        return res.status(500).json({ error: "Server authentication with the analysis service failed." });
      }
      if (openaiResp.status === 429) {
        return res.status(429).json({ error: "The service is busy right now. Please try again shortly." });
      }
      return res.status(502).json({ error: "The analysis service returned an error. Please try again." });
    }

    const data = await openaiResp.json();
    const rawContent = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!rawContent) {
      return res.status(502).json({ error: "The analysis service returned an empty response." });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      console.error("Failed to parse model JSON:", parseErr, rawContent);
      return res.status(502).json({ error: "Could not parse the analysis result. Please try again." });
    }

    if (!parsed.annotation_confidence || ["none", "low"].includes(String(parsed.annotation_confidence).toLowerCase())) {
      parsed.annotation_confidence = parsed.annotation_confidence || "none";
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Unhandled error in /api/analyze:", err);
    return res.status(500).json({ error: "An unexpected server error occurred." });
  }
};

async function safeText(resp) {
  try {
    return await resp.text();
  } catch (e) {
    return "";
  }
}

function buildSystemPrompt(lang, hand) {
  const langInstruction =
    lang === "ur"
      ? "Write every human-readable text field (descriptions, meanings, interpretations, messages) in clear, natural Urdu. Keep JSON keys in English exactly as specified."
      : "Write every human-readable text field (descriptions, meanings, interpretations, messages) in clear, natural English. Keep JSON keys in English exactly as specified.";

  return `You are a careful, traditional palmistry (hand-reading) analyst working from a single photo of a ${hand} hand.

CRITICAL FRAMING:
- Palmistry is a traditional / cultural / entertainment practice. It is NOT medical diagnosis and NOT scientifically validated prediction of the future.
- Never state or imply a guaranteed future event, a medical diagnosis, a death age, fertility status, the number or gender of future children, or guaranteed financial outcomes. Where the user's traditional framework asks about these (marriage lines, children lines, wealth), give only general traditional-interpretation language and explicitly note in the relevant field that palmistry cannot scientifically determine these things.
- ${langInstruction}

IMAGE QUALITY CHECK (do this first):
Assess whether the palm is fully visible, in focus, reasonably lit, not cropped at the fingers, and whether the major lines are visible at all. If the image is blurry, too far away, poorly lit, cropped, or the palm is not clearly the subject, set "image_quality.status" to "poor", explain the specific issue(s) in "image_quality.message" (in the target language, friendly and actionable), and you may leave other fields minimal/empty. Otherwise set "image_quality.status" to "good".

NO HALLUCINATION — CONFIDENCE IS MANDATORY:
For every observation, include a "confidence" value: one of "High", "Medium", "Low", or "Not visible". If a feature is not clearly visible in the photo, do NOT invent it — say so explicitly with confidence "Not visible".

ANNOTATION COORDINATES:
For the four major lines (heart_line, head_line, life_line, fate_line), if you can trace them with real confidence, provide a "points" array of 4-8 normalized coordinate objects {"x":0-1,"y":0-1}. Do the same "point":{"x":..,"y":..} for each mount and special mark. If not confident, omit points/point fields entirely.
Set "annotation_confidence" to "high" only if genuinely confident; otherwise "low" or "none". When low/none, omit points/point fields throughout.

OUTPUT FORMAT:
Respond with ONLY a single JSON object (no markdown fences, no commentary) matching this exact shape:

{
  "image_quality": { "status": "good|poor", "message": "" },
  "hand_type": { "type": "Earth Hand|Fire Hand|Air Hand|Water Hand|Mixed Type", "description": "", "confidence": "" },
  "fingers": {
    "thumb": { "length":"", "thickness":"", "shape":"", "spacing":"", "meaning":"", "confidence":"" },
    "index": { "length":"", "thickness":"", "shape":"", "spacing":"", "meaning":"", "confidence":"" },
    "middle": { "length":"", "thickness":"", "shape":"", "spacing":"", "meaning":"", "confidence":"" },
    "ring": { "length":"", "thickness":"", "shape":"", "spacing":"", "meaning":"", "confidence":"" },
    "little": { "length":"", "thickness":"", "shape":"", "spacing":"", "meaning":"", "confidence":"" }
  },
  "thumb": { "length":"", "width":"", "flexibility":"", "upper_phalanx":"", "lower_phalanx":"", "meaning":"", "confidence":"" },
  "heart_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "points":[{"x":0.0,"y":0.0}] },
  "head_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "points":[{"x":0.0,"y":0.0}] },
  "life_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "points":[{"x":0.0,"y":0.0}] },
  "fate_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "points":[{"x":0.0,"y":0.0}] },
  "secondary_lines": {
    "sun_line": { "description":"", "confidence":"" },
    "health_line": { "description":"", "confidence":"" },
    "marriage_lines": { "description":"", "confidence":"" },
    "travel_lines": { "description":"", "confidence":"" },
    "influence_lines": { "description":"", "confidence":"" },
    "bracelets": { "description":"", "confidence":"" }
  },
  "mounts": {
    "jupiter": { "level":"low|normal|developed|prominent", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "saturn": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "apollo": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "mercury": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "venus": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "moon": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "upper_mars": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "lower_mars": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} },
    "plain_of_mars": { "level":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} }
  },
  "special_marks": [ { "type":"Star|Cross|Triangle|Square|Island|Circle|Trident|Fork|Grille|Vertical line|Horizontal line", "location":"", "meaning":"", "confidence":"", "point":{"x":0.0,"y":0.0} } ],
  "marriage": { "lines_count":"", "description":"", "shape":"", "forks_breaks":"", "confidence":"" },
  "children": { "interpretation":"", "disclaimer":"" },
  "personality": { "confidence_trait":"", "communication":"", "emotional_style":"", "decision_making":"", "creativity":"", "leadership":"" },
  "career": { "tendencies":"", "leadership":"", "business_tendency":"", "communication_work":"", "creative_work":"", "stability_vs_change":"" },
  "relationships": { "emotional_nature":"", "attachment_style":"", "communication":"", "tendencies":"" },
  "wealth": { "financial_tendencies":"", "stability":"", "risk_taking":"", "business_inclination":"" },
  "annotation_confidence": "high|low|none",
  "disclaimer": ""
}

The "disclaimer" field must always be filled with a clear statement (in the target language) that this reading is a traditional/entertainment interpretation only, is not scientific, and cannot guarantee predictions about death, fertility, number/gender of children, disease diagnosis, or financial outcomes.

Never wrap the JSON in markdown code fences. Return raw JSON only.`;
        }
