/**
 * /api/aura.js
 *
 * Vercel Serverless Function (Node.js runtime).
 * Receives a selfie/portrait photo from the frontend, sends it to OpenAI's
 * Vision-capable model, and returns a structured JSON "aura" reading — a
 * traditional/spiritual novelty concept, not a scientific measurement.
 *
 * The OpenAI API key is read ONLY from the environment variable OPENAI_API_KEY.
 * It is never sent to, or hard-coded in, the frontend.
 */

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

    const { image, language } = req.body || {};

    if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
      return res.status(400).json({ error: "Invalid or missing image data." });
    }
    const lang = language === "en" ? "en" : "ur";

    const approxBytes = Math.ceil((image.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image is too large. Please upload an image under 8 MB." });
    }

    const systemPrompt = buildSystemPrompt(lang);

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
          max_tokens: 1200,
          temperature: 0.7,
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
                      ? "منسلک تصویر کا جائزہ لیں اور صرف بیان کردہ JSON فارمیٹ میں جواب دیں۔"
                      : "Review the attached image and respond ONLY in the specified JSON format.",
                },
                { type: "image_url", image_url: { url: image, detail: "low" } },
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

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Unhandled error in /api/aura:", err);
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

/**
 * Builds the system prompt for the "Aura Camera" novelty reading. Framed
 * explicitly and repeatedly as a traditional/spiritual entertainment
 * concept with zero scientific or medical basis — aura color folklore is
 * being read onto general visual impression (lighting, expression, colors
 * worn), never presented as a measurement of any real energy field, mood,
 * or health condition.
 */
function buildSystemPrompt(lang) {
  const langInstruction =
    lang === "ur"
      ? "Write every human-readable text value in the JSON in clear, natural, warm Urdu — with NO exceptions, including short values. Keep JSON keys in English exactly as specified, and keep the aura_color.name_en and element values in English as specified."
      : "Write every human-readable text field in clear, natural, warm English. Keep JSON keys and the specified enum-like values in English exactly as specified.";

  return `You are a friendly "Aura Camera" novelty reader — a traditional/spiritual entertainment concept inspired by old aura-photography booths, working from a single selfie/portrait photo.

CRITICAL FRAMING (read carefully, this is the most important rule):
- An "aura" in this app is a playful, traditional/spiritual entertainment concept. It has NO scientific or medical basis whatsoever. You are not detecting any real energy field, biofield, chakra, or aura.
- You are NOT a medical, psychological, or mental-health professional, and must NEVER diagnose, assess, or comment on physical health, mental health, illness, disease, or emotional/psychiatric state as if it were real or factual. Do not use clinical language.
- Base your reading loosely and playfully on general visual impression only: the photo's dominant colors/clothing, lighting/mood, and facial expression (e.g. smiling, calm, thoughtful) — purely as inspiration for a fun, uplifting color reading, never as an analysis of the person's actual psychology or health.
- Always keep the tone warm, positive, and encouraging. Never produce a negative, alarming, or discouraging reading.
- ${langInstruction}

IMAGE QUALITY CHECK (do this first):
Check whether a person's face/upper body is reasonably visible, lit, and in focus. If the photo is too dark, blurry, too far away, or no person is clearly visible, set "image_quality.status" to "poor" and explain briefly and kindly in "image_quality.message" (target language). Otherwise set it to "good".

AURA COLOR:
Pick exactly ONE dominant aura color from this fixed palette only: Red, Orange, Yellow, Green, Blue, Indigo, Violet, Pink, Gold, White. Use the widely-known traditional folklore meaning of that color (e.g. Red=passion/energy, Orange=creativity/confidence, Yellow=joy/optimism, Green=growth/balance/healing, Blue=calm/communication, Indigo=intuition/insight, Violet=spirituality/imagination, Pink=love/compassion, Gold=wisdom/abundance, White=clarity/new beginnings). Give the matching hex color code for that named color.

OUTPUT FORMAT:
Respond with ONLY a single JSON object (no markdown fences, no commentary) matching this exact shape:

{
  "image_quality": { "status": "good|poor", "message": "" },
  "aura_color": { "name_en": "Red|Orange|Yellow|Green|Blue|Indigo|Violet|Pink|Gold|White", "name_local": "", "hex": "#rrggbb", "meaning": "" },
  "element": "Fire|Water|Air|Earth|Spirit",
  "energy_level": "",
  "emotional_tone": "",
  "personality_glimpse": "",
  "affirmation": "",
  "disclaimer": ""
}

Field guidance (write every one of these, except when image_quality.status is "poor", as a warm, complete, easy-to-understand sentence of roughly 15-30 words in the target language, never a bare word or label):
- "energy_level": a playful comment on their general energy/vibe today.
- "emotional_tone": a gentle, positive comment on the mood the photo conveys.
- "personality_glimpse": one warm, general personality-style observation tied to the aura color.
- "affirmation": a short, uplifting one-line affirmation/message for the day (a single encouraging sentence, not a list).
- "disclaimer": always filled, clearly stating (in the target language) that this Aura Camera reading is a traditional/spiritual entertainment concept only, has no scientific or medical basis, is not a real measurement of any energy field, and is not a statement about the person's actual health, mental state, or psychology.

Never wrap the JSON in markdown code fences. Return raw JSON only.`;
}
