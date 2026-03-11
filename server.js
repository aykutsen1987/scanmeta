/**
 * ScanMeta OCR Proxy Server — v3.0.0
 * Gemini başarısız olursa → Groq Vision fallback
 */

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Gemini Model Listesi ─────────────────────────────────────────────────────
const GEMINI_MODELS = [
    "models/gemini-1.5-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-2.0-flash",
    "models/gemini-1.5-pro"
];

// ── Groq Vision Model Listesi (yedek) ───────────────────────────────────────
const GROQ_VISION_MODELS = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "llama-3.2-90b-vision-preview",
    "llama-3.2-11b-vision-preview"
];

// ── Sistem Talimatları ───────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `ROL: Gelişmiş Belge Sayısallaştırma Uzmanısın.
GÖREV: OCR metnini analiz et. Tablo varsa yapılandır, metin varsa temizle.
KURALLAR: 
1. Karakter hatalarını (þ, ð, ý) Türkçe karşılıklarıyla düzelt.
2. §§B§§ ayraçlarını koru.
3. Giriş/açıklama yapma, sadece temiz metni döndür.
GİZLİLİK: İşlem sonrası veriyi imha et.`;

// ── Auth Middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const proxySecret  = process.env.PROXY_SECRET;
    const clientSecret = req.headers["x-proxy-secret"] || "";
    const clientKey    = req.headers["x-gemini-key"]   || "";

    if (proxySecret && clientSecret === proxySecret) return next();
    if (clientKey.startsWith("AIza")) return next();

    return res.status(401).json({ error: "Yetkisiz erişim!" });
});

// ── Gemini ile dene ──────────────────────────────────────────────────────────
async function tryGemini(apiKey, prompt) {
    const genAI = new GoogleGenerativeAI(apiKey);

    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`[Gemini] ${modelName} deneniyor...`);
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: SYSTEM_INSTRUCTION,
                generationConfig: { temperature: 0.1, topP: 0.95, maxOutputTokens: 8192 },
            });
            const result = await model.generateContent(prompt);
            const text = (await result.response).text().trim();
            if (!text) throw new Error("Boş yanıt");
            console.log(`[Gemini] ${modelName} ✓`);
            return { text, model: modelName };
        } catch (err) {
            const msg = (err.message || "").toLowerCase();
            if (msg.includes("401") || msg.includes("key")) throw new Error("Geçersiz API Anahtarı");
            console.warn(`[Gemini] ${modelName} → ${msg.slice(0, 60)}`);
        }
    }
    throw new Error("Tüm Gemini modelleri başarısız");
}

// ── Groq Vision ile dene (yedek) ─────────────────────────────────────────────
async function tryGroqVision(groqKey, prompt) {
    for (const model of GROQ_VISION_MODELS) {
        try {
            console.log(`[Groq Vision] ${model} deneniyor...`);
            const response = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model,
                    messages: [{
                        role: "user",
                        content: [{ type: "text", text: prompt }]
                    }],
                    temperature: 0.1,
                    max_tokens: 8192,
                },
                {
                    headers: {
                        "Authorization": `Bearer ${groqKey}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 60000
                }
            );
            const text = response.data?.choices?.[0]?.message?.content || "";
            if (!text.trim()) throw new Error("Boş yanıt");
            console.log(`[Groq Vision] ${model} ✓`);
            return { text: text.trim(), model: `groq:${model}` };
        } catch (err) {
            const status = err.response?.status;
            const msg = err.response?.data?.error?.message || err.message;
            console.warn(`[Groq Vision] ${model} (${status}): ${msg.slice(0, 60)}`);
            if (status !== 429 && status !== 503) break;
        }
    }
    throw new Error("Tüm Groq Vision modelleri başarısız");
}

// ── POST /fix ────────────────────────────────────────────────────────────────
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";
    if (!rawOcrText.trim()) return res.status(400).json({ error: "Metin boş" });

    const userKey    = req.headers["x-gemini-key"] || "";
    const geminiKey  = userKey.startsWith("AIza") ? userKey : (process.env.GEMINI_API_KEY || "");
    const groqKey    = process.env.GROQ_API_KEY || "";

    const fullPrompt = `BAŞLA\n\n${rawOcrText}\n\nBİTTİ`;

    try {
        // 1. Gemini dene
        if (geminiKey) {
            try {
                const { text, model } = await tryGemini(geminiKey, fullPrompt);
                const correctedText = text
                    .replace(/^BA[SŞ]LA\s*/i, "")
                    .replace(/\s*B[İI]TT[İI]$/i, "")
                    .trim();
                return res.status(200).json({ correctedText, _model: model });
            } catch (err) {
                console.warn(`[Gemini tamamen başarısız]: ${err.message}`);
            }
        }

        // 2. Groq Vision yedek
        if (groqKey) {
            try {
                const { text, model } = await tryGroqVision(groqKey, fullPrompt);
                const correctedText = text
                    .replace(/^BA[SŞ]LA\s*/i, "")
                    .replace(/\s*B[İI]TT[İI]$/i, "")
                    .trim();
                return res.status(200).json({ correctedText, _model: model });
            } catch (err) {
                console.warn(`[Groq Vision tamamen başarısız]: ${err.message}`);
            }
        }

        // 3. Her ikisi de başarısız — ham metni geri döndür (uygulama çökmez)
        console.error("[KRİTİK]: Gemini ve Groq başarısız, ham metin döndürülüyor");
        res.status(200).json({
            correctedText: rawOcrText,
            _error: "AI servisine ulaşılamadı, orijinal metin korundu."
        });

    } catch (err) {
        console.error("[HATA]:", err.message);
        res.status(200).json({
            correctedText: rawOcrText,
            _error: err.message
        });
    }
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        version: "3.0.0",
        gemini: !!process.env.GEMINI_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
        geminiModels: GEMINI_MODELS,
        groqModels: GROQ_VISION_MODELS
    });
});

app.listen(PORT, () => {
    console.log(`ScanMeta OCR Proxy v3.0.0 ayağa kalktı. Port: ${PORT}`);
    console.log(`Gemini: ${process.env.GEMINI_API_KEY ? "✅" : "⚠️ yok"} | Groq: ${process.env.GROQ_API_KEY ? "✅" : "⚠️ yok"}`);
});
