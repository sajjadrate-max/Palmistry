/**
 * /api/analyze.js
 *
 * Vercel Serverless Function (Node.js runtime).
 * Receives a palm image from the frontend, sends it to OpenAI's Vision-capable
 * model (gpt-4o), and returns a structured JSON palmistry reading.
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

    const { image, hand, language, topic } = req.body || {};

    if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
      return res.status(400).json({ error: "Invalid or missing image data." });
    }
    if (!["right", "left"].includes(hand)) {
      return res.status(400).json({ error: "Invalid hand value. Expected 'right' or 'left'." });
    }
    const lang = language === "en" ? "en" : "ur";
    const VALID_TOPICS = ["full", "marriage", "health", "fate", "wealth", "personality", "travel", "children", "handFingers", "marks", "mounts"];
    const focusTopic = VALID_TOPICS.includes(topic) ? topic : "full";

    const approxBytes = Math.ceil((image.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "Image is too large. Please upload an image under 8 MB." });
    }

    const systemPrompt = buildSystemPrompt(lang, hand, focusTopic);

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
                      ? "منسلک تصویر کا تجزیہ کریں اور صرف بیان کردہ JSON فارمیٹ میں جواب دیں۔ یاد رہے: ہر value، چاہے وہ کتنی ہی مختصر ہو (جیسے 'موجود نہیں'، 'سیدھی'، 'درمیانہ')، اردو میں لکھیں — کوئی بھی انگریزی لفظ استعمال نہ کریں سوائے JSON کیز کے۔"
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

/**
 * Builds the system prompt sent to the vision model. Encodes the
 * traditional-only framing, mandatory disclaimers, confidence levels,
 * no-hallucination rule, and the structured JSON output contract
 * (including normalized 0-1 coordinates for the on-image annotation
 * overlay). The Urdu-language instruction is deliberately strict and
 * repeated so that short field values (e.g. "None", "Straight",
 * "Present") are translated too, not just the longer prose fields.
 */
function buildSystemPrompt(lang, hand, focusTopic) {
  const langInstruction =
    lang === "ur"
      ? `Write EVERY human-readable text value in the JSON in clear, natural Urdu — with NO exceptions. This includes not just long interpretation/description/meaning fields, but also every short value such as: start, end, length, depth, shape, breaks, branches, forks, islands, crosses, chains, relation_to_other_lines, level, thickness, spacing, location, type, status, message. For example, instead of "None" write "موجود نہیں", instead of "Straight" write "سیدھی", instead of "Curved" write "خم دار", instead of "Slightly Curved" write "قدرے خم دار", instead of "Present" write "موجود", instead of "Few" write "چند", instead of "Joined with Life Line" write "لائف لائن کے ساتھ ملی ہوئی", instead of "Between Thumb and Index Finger" write "انگوٹھے اور شہادت کی انگلی کے درمیان", instead of "Near Wrist" write "کلائی کے قریب", instead of "Long" write "لمبی", instead of "Deep" write "گہری", instead of "Under Ring Finger" write "انگوٹھی والی انگلی کے نیچے", instead of "Not clearly visible" write "تصویر میں واضح طور پر نظر نہیں آ رہی". The ONLY things that should remain in English/Latin script are: the JSON keys themselves (e.g. "heart_line", "confidence"), the confidence enum values which must stay exactly "High"/"Medium"/"Low"/"Not visible", the image_quality.status value ("good"/"poor"), the hand_type.type value (keep as "Earth Hand"/"Fire Hand"/"Air Hand"/"Water Hand"/"Mixed Type"), the mounts level value ("low"/"normal"/"developed"/"prominent"), and the special_marks.type value (keep as "Star"/"Cross"/"Triangle"/etc). Every other piece of text must be Urdu.

MANDATORY FINAL SELF-CHECK (do this before you output anything): once you have drafted the JSON in your head, re-scan every single value you are about to write. If any value — however short — contains an English word or phrase that is not one of the specific enum values listed above, rewrite that value in Urdu before including it in your response. Do not submit a value like "Not clearly visible", "Between Thumb and Index Finger", "Slightly Curved", or any similar English phrase; every one of those must be Urdu text instead.

CRITICAL — SIMPLE, EXPLAINED LANGUAGE FOR ALL INTERPRETATION/MEANING FIELDS: Every field that carries a traditional interpretation (interpretation, meaning, description on lines/fingers/mounts/secondary_lines/marriage/children, and every value inside personality/career/relationships/wealth) must be a full, easy-to-understand Urdu SENTENCE for an ordinary reader who has no background in palmistry — never a bare word or short technical label. Explain what the trait actually means in plain, everyday language, the way you'd explain it to a friend, in roughly 12-25 Urdu words. For example, instead of "متوازن" write "آپ محبت میں نہ بہت زیادہ جذباتی ہیں اور نہ بالکل سرد — دل اور دماغ دونوں سے کام لیتے ہیں، اور رشتوں کو سمجھداری سے نبھاتے ہیں۔"; instead of "مضبوط" (for leadership) write "آپ میں فطری قائدانہ صلاحیت ہے — لوگ آپ کی بات پر بھروسہ کرتے ہیں اور آپ ذمہ داری لینے سے نہیں گھبراتے۔"; instead of "اچھا" (for communication) write "آپ اپنی بات واضح اور مؤثر انداز میں پہنچا لیتے ہیں، اور دوسروں کی بات بھی توجہ سے سنتے ہیں۔". Apply this same rule to every personality/career/relationships/wealth value, every line's "interpretation" field, every finger/mount/secondary-line "meaning"/"description" field, and the marriage/children interpretation fields — none of them should ever be a single word or short label; each must be a short, warm, explained sentence.`
      : "Write every human-readable text field (descriptions, meanings, interpretations, messages, and all short field values) in clear, natural English. Keep JSON keys and the specified enum values in English exactly as specified. Every interpretation/meaning/description field (including every value inside personality/career/relationships/wealth) must be a full, easy-to-understand explained sentence for an ordinary reader — never a bare word or short label.";

  const TOPIC_LABELS_UR = {
    marriage: "شادی اور محبت (Heart Line، marriage_lines، relationships)",
    health: "صحت کا روایتی رجحان (Life Line، health_line)",
    fate: "قسمت اور کیریئر (Fate Line، Head Line، career)",
    wealth: "مالی معاملات (wealth)",
    personality: "مجموعی شخصیت (personality، hand_type)",
    travel: "سفر کا روایتی رجحان (secondary_lines.travel_lines)",
    children: "اولاد سے متعلق روایتی تشریح (children)",
    handFingers: "ہاتھ کی قسم اور انگلیوں/انگوٹھے کی ساخت (hand_type، fingers، thumb)",
    marks: "خاص نشانات (special_marks)",
    mounts: "Mounts/ابھار (mounts)",
  };
  const TOPIC_LABELS_EN = {
    marriage: "marriage and love (heart_line, marriage_lines, relationships)",
    health: "traditional health tendency (life_line, health_line)",
    fate: "fate and career (fate_line, head_line, career)",
    wealth: "money and wealth (wealth)",
    personality: "overall personality (personality, hand_type)",
    travel: "traditional travel tendency (secondary_lines.travel_lines)",
    children: "traditional interpretation about children (children)",
    handFingers: "hand shape and fingers/thumb structure (hand_type, fingers, thumb)",
    marks: "special marks (special_marks)",
    mounts: "mounts (mounts)",
  };
  const focusInstruction =
    focusTopic && focusTopic !== "full"
      ? lang === "ur"
        ? `\n\nFOCUS TOPIC: The user specifically wants to know about: ${TOPIC_LABELS_UR[focusTopic]}. Still fill in the complete JSON structure (the frontend needs it for the annotated image and consistency), but give exceptionally rich, detailed, warm, well-explained Urdu interpretation (aim for 40-70 Urdu words, several sentences) for the field(s) tied to this topic. Every other field can stay brief (a short accurate sentence is enough) since the user is not focused on those right now.`
        : `\n\nFOCUS TOPIC: The user specifically wants to know about: ${TOPIC_LABELS_EN[focusTopic]}. Still fill in the complete JSON structure (the frontend needs it for the annotated image and consistency), but give exceptionally rich, detailed, well-explained interpretation (aim for 40-70 words, several sentences) for the field(s) tied to this topic. Every other field can stay brief since the user is not focused on those right now.`
      : "";

  return `You are a careful, traditional palmistry (hand-reading) analyst working from a single photo of a ${hand} hand.${focusInstruction}

CRITICAL FRAMING:
- Palmistry is a traditional / cultural / entertainment practice. It is NOT medical diagnosis and NOT scientifically validated prediction of the future.
- Never state or imply a guaranteed future event, a medical diagnosis, a death age, fertility status, the number or gender of future children, or guaranteed financial outcomes. Where the user's traditional framework asks about these (marriage lines, children lines, wealth), give only general traditional-interpretation language and explicitly note in the relevant field that palmistry cannot scientifically determine these things.
- ${langInstruction}

CAREFUL, LITERAL VISUAL OBSERVATION — SCAN EACH LINE ONE AT A TIME, DO NOT GENERALIZE:
Before writing anything, go through this exact process for EACH of the four major lines (heart_line, head_line, life_line, fate_line) separately, one at a time:
1. Locate that specific line in the photo — trace it visually with your eyes from one end to the other.
2. Note where it genuinely starts and ends relative to the fingers, thumb, and wrist in THIS photo.
3. Look closely at its actual shape along its length — is it really straight, or does it curve, and where exactly does any curve happen?
4. Judge its actual depth/clarity as it appears in this image — deep and dark, faint, or somewhere between.
5. Look for actual breaks, branches, forks, islands, crosses, or chains ON THAT SPECIFIC LINE — do not report any of these unless you can actually see them on it.
6. Note how it actually sits relative to the other three lines you can see (crossing, parallel, joined, etc.) in this specific hand.
Only after completing this per-line scan should you write that line's fields — and every factual field (start, end, length, depth, shape, breaks, branches, forks, islands, crosses, chains, relation_to_other_lines, thickness, spacing, level) must describe what you scanned in THIS particular photo, never a generic textbook answer that could apply to any hand. If two different photos would plausibly get the same boilerplate answer for a field, you have not looked closely enough — go back and find what actually distinguishes this specific line in this specific hand. Where something is genuinely ambiguous or partially obscured after this scan, say so honestly and lower the confidence rather than defaulting to a common answer like "Straight" or "Medium".

IMAGE QUALITY CHECK (do this first):
Assess whether the palm is fully visible, in focus, reasonably lit, not cropped at the fingers, and whether the major lines are visible at all. If the image is blurry, too far away, poorly lit, cropped, or the palm is not clearly the subject, set "image_quality.status" to "poor", explain the specific issue(s) in "image_quality.message" (in the target language, friendly and actionable), and you may leave other fields minimal/empty. Otherwise set "image_quality.status" to "good".

NO HALLUCINATION — CONFIDENCE IS MANDATORY:
For every observation, include a "confidence" value: one of "High", "Medium", "Low", or "Not visible" (these four enum values stay in English exactly as written, even when the rest of the content is in Urdu). If a feature is not clearly visible in the photo, do NOT invent it — say so explicitly with confidence "Not visible".

START/END POINT MARKERS — TWO POINTS PER LINE, NOT A FULL TRACE:
For each of the four major lines (heart_line, head_line, life_line, fate_line), identify only its two endpoints in the photo — where it visibly starts and where it visibly ends — NOT the path in between. This is a much simpler, more reliable task than tracing the whole line, so take real care to be accurate here. For each line, if you can clearly see both endpoints, add a "start_point":{"x":0-1,"y":0-1} and "end_point":{"x":0-1,"y":0-1} (normalized to image width/height, x left-to-right, y top-to-bottom) placed exactly on the crease at that endpoint — not a rough guess nearby. Double-check: does this (x,y) genuinely sit on the visible crease at its start/end, not just in the general area? Only include start_point/end_point for a line if you are genuinely confident about BOTH locations; if you are not confident about either one, omit both fields for that line entirely rather than guessing — a missing marker is far better than a wrongly-placed one.

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
  "heart_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "start_point":{"x":0.0,"y":0.0}, "end_point":{"x":0.0,"y":0.0} },
  "head_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "start_point":{"x":0.0,"y":0.0}, "end_point":{"x":0.0,"y":0.0} },
  "life_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "start_point":{"x":0.0,"y":0.0}, "end_point":{"x":0.0,"y":0.0} },
  "fate_line": { "start":"", "end":"", "length":"", "depth":"", "shape":"", "breaks":"", "branches":"", "forks":"", "islands":"", "crosses":"", "chains":"", "relation_to_other_lines":"", "interpretation":"", "confidence":"", "start_point":{"x":0.0,"y":0.0}, "end_point":{"x":0.0,"y":0.0} },
  "secondary_lines": {
    "sun_line": { "description":"", "confidence":"" },
    "health_line": { "description":"", "confidence":"" },
    "marriage_lines": { "description":"", "confidence":"" },
    "travel_lines": { "description":"", "confidence":"" },
    "influence_lines": { "description":"", "confidence":"" },
    "bracelets": { "description":"", "confidence":"" }
  },
  "mounts": {
    "jupiter": { "level":"low|normal|developed|prominent", "meaning":"", "confidence":"" },
    "saturn": { "level":"", "meaning":"", "confidence":"" },
    "apollo": { "level":"", "meaning":"", "confidence":"" },
    "mercury": { "level":"", "meaning":"", "confidence":"" },
    "venus": { "level":"", "meaning":"", "confidence":"" },
    "moon": { "level":"", "meaning":"", "confidence":"" },
    "upper_mars": { "level":"", "meaning":"", "confidence":"" },
    "lower_mars": { "level":"", "meaning":"", "confidence":"" },
    "plain_of_mars": { "level":"", "meaning":"", "confidence":"" }
  },
  "special_marks": [ { "type":"Star|Cross|Triangle|Square|Island|Circle|Trident|Fork|Grille|Vertical line|Horizontal line", "location":"", "meaning":"", "confidence":"" } ],
  "marriage": { "lines_count":"", "description":"", "shape":"", "forks_breaks":"", "confidence":"" },
  "children": { "interpretation":"", "disclaimer":"" },
  "personality": { "confidence_trait":"", "communication":"", "emotional_style":"", "decision_making":"", "creativity":"", "leadership":"" },
  "career": { "tendencies":"", "leadership":"", "business_tendency":"", "communication_work":"", "creative_work":"", "stability_vs_change":"" },
  "relationships": { "emotional_nature":"", "attachment_style":"", "communication":"", "tendencies":"" },
  "wealth": { "financial_tendencies":"", "stability":"", "risk_taking":"", "business_inclination":"" },
  "disclaimer": ""
}

The "disclaimer" field must always be filled with a clear statement (in the target language) that this reading is a traditional/entertainment interpretation only, is not scientific, and cannot guarantee predictions about death, fertility, number/gender of children, disease diagnosis, or financial outcomes.

Never wrap the JSON in markdown code fences. Return raw JSON only.`;
}
