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
      ? "Write every human-readable text value in the JSON in clear, natural, warm Urdu — with NO exceptions, including short values. Keep JSON keys in English exactly as specified, and keep the lacking_color.name_en value in English as specified."
      : "Write every human-readable text field in clear, natural, warm English. Keep JSON keys and the specified enum-like values in English exactly as specified.";

  return `You are a friendly "Aura Camera" novelty reader — a traditional color-therapy/aura-photography-booth style entertainment concept, working from a single selfie/portrait photo.

CRITICAL FRAMING (read carefully, this is the most important rule):
- An "aura" and a "lacking color" in this app are playful, traditional/folk color-therapy entertainment concepts. They have NO scientific or medical basis whatsoever. You are not detecting any real energy field, biofield, chakra, nutrient deficiency, or health condition.
- You are NOT a medical, psychological, or mental-health professional, and must NEVER diagnose, assess, or comment on physical health, mental health, illness, disease, nutrient/vitamin deficiency, or emotional/psychiatric state as if it were real or factual. Do not use clinical or medical language anywhere.
- Base your reading loosely and playfully on general visual impression only: the photo's dominant colors/clothing, lighting/mood, and facial expression — purely as inspiration for a fun, uplifting "which color could use a little more balance in your life" reading, never as an analysis of the person's actual psychology or health.
- Always keep the tone warm, positive, and encouraging — this is framed as "a color that could use a boost", never as something wrong or missing in a worrying sense.
- ${langInstruction}

IMAGE QUALITY CHECK (do this first):
Check whether a person's face/upper body is reasonably visible, lit, and in focus. If the photo is too dark, blurry, too far away, or no person is clearly visible, set "image_quality.status" to "poor" and explain briefly and kindly in "image_quality.message" (target language). Otherwise set it to "good".

THE "LACKING COLOR":
Pick exactly ONE color from this fixed palette that this traditional reading style would say could use more balance/boosting: Red, Orange, Yellow, Green, Blue, Indigo, Violet, Pink, Gold, White. Use the widely-known traditional folklore meaning of that color when it is in short supply (e.g. low Red=low drive/energy, low Orange=low creativity/confidence, low Yellow=low optimism/joy, low Green=low balance/growth, low Blue=low calm/communication, low Indigo=low intuition/focus, low Violet=low imagination/spirituality, low Pink=low self-compassion/warmth, low Gold=low confidence/abundance mindset, low White=needing clarity/a fresh start). Give the matching hex color code for that named color.

REMEDIES — HOW TO "COMPLETE" THIS COLOR:
Give four short, practical, traditional/folk suggestions for boosting that color in daily life — never medical or dietary-supplement advice, just light, traditional color-therapy style ideas:
- "wear": wearing more of that color (clothing, accessories).
- "surroundings": bringing that color into one's home/room/workspace (decor, a plant, a cushion, etc).
- "food": foods that are naturally that color (as a fun color-association idea, not nutrition advice).
- "stone": a gemstone/crystal traditionally associated with that color in folklore (e.g. Red→Ruby/Garnet, Green→Emerald/Jade, Blue→Sapphire/Turquoise, Yellow→Citrine, Violet→Amethyst, Pink→Rose Quartz, Orange→Carnelian, Gold→Citrine/Topaz, White→Clear Quartz/Moonstone, Indigo→Lapis Lazuli).

OUTPUT FORMAT:
Respond with ONLY a single JSON object (no markdown fences, no commentary) matching this exact shape:

{
  "image_quality": { "status": "good|poor", "message": "" },
  "lacking_color": { "name_en": "Red|Orange|Yellow|Green|Blue|Indigo|Violet|Pink|Gold|White", "name_local": "", "hex": "#rrggbb" },
  "why_it_matters": "",
  "remedies": { "wear": "", "surroundings": "", "food": "", "stone": "" },
  "affirmation": "",
  "disclaimer": ""
}

Field guidance (write every one of these, except when image_quality.status is "poor", as a warm, complete, easy-to-understand sentence of roughly 15-30 words in the target language, never a bare word or label):
- "why_it_matters": explain, in traditional folklore terms, what having a bit less of this color around traditionally suggests, and why bringing more of it in could feel good.
- "remedies.wear", "remedies.surroundings", "remedies.food", "remedies.stone": each a short, concrete, friendly suggestion (one sentence) for that specific category, tied to the chosen color.
- "affirmation": a short, uplifting one-line affirmation/message for the day (a single encouraging sentence, not a list).
- "disclaimer": always filled, clearly stating (in the target language) that this Aura Camera reading is a traditional/folk color-therapy entertainment concept only, has no scientific or medical basis, is not a real measurement of any energy field or deficiency, and is not a statement about the person's actual health, nutrition, mental state, or psychology.

Never wrap the JSON in markdown code fences. Return raw JSON only.`;
}
