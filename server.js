/**
 * ScanMeta OCR Proxy Server — v2.4.0 (Güvenli & Hibrit Versiyon)
 */

const express = require("express");
const cors    = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Model Fallback Listesi (Limit ve Stabilite Odaklı) ───────────────────────
const MODEL_FALLBACK_ORDER = [
    "models/gemini-1.5-flash",        // Lider: 1500 RPD (En güvenilir)
    "models/gemini-2.5-flash-lite",   // Hızlı Yedek: (Loglarında en başarılı çıkan)
    "models/gemini-3.1-flash-lite",   // Dev Kapasite: 500 RPD
    "models/gemini-3-flash",          // Yeni Nesil: 20 RPD
    "models/gemini-1.5-pro"           // Güçlü Son Çare
];

// ── Sistem Talimatları ───────────────────────────────────────────────────────
const HYBRID_SYSTEM_INSTRUCTION = `ROL: Gelişmiş Belge Sayısallaştırma Uzmanısın.
GÖREV: OCR metnini analiz et. Tablo varsa yapılandır, metin varsa temizle.
KURALLAR: 
1. Karakter hatalarını (þ, ð, ý) Türkçe karşılıklarıyla düzelt.
2. §§B§§ ayraçlarını koru.
3. Giriş/açıklama yapma, sadece temiz metni döndür.
GİZLİLİK: İşlem sonrası veriyi imha et.`;

// ── Kimlik Doğrulama Middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const proxySecret  = process.env.PROXY_SECRET;
    const clientSecret = req.headers["x-proxy-secret"] || "";
    const clientKey    = req.headers["x-gemini-key"]   || "";

    if (proxySecret && clientSecret === proxySecret) return next();
    if (clientKey.startsWith("AIza")) return next();

    return res.status(401).json({ error: "Yetkisiz erişim!" });
});

// ── Akıllı İstek Fonksiyonu ──────────────────────────────────────────────────
async function tryModel(apiKey, modelName, fullPrompt) {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // SDK otomatik olarak en uygun endpoint'i (v1 veya v1beta) seçer
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: HYBRID_SYSTEM_INSTRUCTION,
        generationConfig: { 
            temperature: 0.1, 
            topP: 0.95, 
            maxOutputTokens: 8192 
        },
    });

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    return response.text().trim();
}

// ── Gelişmiş Hata Yönetimi & Fallback ────────────────────────────────────────
async function generateWithFallback(apiKey, fullPrompt) {
    let lastError = null;

    for (const modelName of MODEL_FALLBACK_ORDER) {
        try {
            console.log(`[Dene] ${modelName}...`);
            const text = await tryModel(apiKey, modelName, fullPrompt);
            console.log(`[Başarılı] ${modelName} ✓`);
            return { text, model: modelName };
        } catch (err) {
            lastError = err;
            const errorMsg = (err.message || "").toLowerCase();
            
            // Eğer hata API Key ile ilgiliyse (401), diğer modelleri deneme!
            if (errorMsg.includes("401") || errorMsg.includes("key")) {
                throw new Error("Geçersiz API Anahtarı");
            }

            console.warn(`[Pas geçildi] ${modelName} → Hata: ${errorMsg.slice(0, 50)}`);
        }
    }
    throw lastError;
}

// ── POST /fix ────────────────────────────────────────────────────────────────
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";
    if (!rawOcrText.trim()) return res.status(400).json({ error: "Metin boş" });

    const userKey = req.headers["x-gemini-key"] || "";
    const apiKey  = userKey.startsWith("AIza") ? userKey : (process.env.GEMINI_API_KEY || "");

    if (!apiKey) return res.status(500).json({ error: "API Anahtarı eksik" });

    const fullPrompt = `BAŞLA\n\n${rawOcrText}\n\nBİTTİ`;

    try {
        const { text, model } = await generateWithFallback(apiKey, fullPrompt);

        const correctedText = text
            .replace(/^BA[SŞ]LA\s*/i, "")
            .replace(/\s*B[İI]TT[İI]$/i, "")
            .trim();

        res.status(200).json({ correctedText, _model: model });

    } catch (err) {
        console.error("[KRİTİK HATA]:", err.message);
        // Güvenlik önlemi: Çökme yerine ham metni döndür
        res.status(200).json({ 
            correctedText: rawOcrText, 
            _error: "AI servisine ulaşılamadı, orijinal metin korundu." 
        });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", version: "2.4.0", models: MODEL_FALLBACK_ORDER });
});

app.listen(PORT, () => {
    console.log(`ScanMeta OCR Proxy v2.4.0 ayağa kalktı. Port: ${PORT}`);
});
