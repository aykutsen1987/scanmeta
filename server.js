/**
 * ScanMeta OCR Proxy Server — v2.2.0
 * ====================================
 * Ücretsiz model fallback zinciri (Google AI Studio limitlerine göre):
 *
 *  1. gemini-2.5-flash-lite   RPM:10  RPD:20  → En hızlı, en çok istek
 *  2. gemini-2.5-flash        RPM:5   RPD:20  → Lite dolunca
 *  3. gemini-3-flash          RPM:5   RPD:20  → İkisi de dolunca
 *  4. ham metin               —       —       → Hepsi başarısız, uygulama çökmez
 *
 * Render'da çalışır. Ortam değişkenleri:
 *   GEMINI_API_KEY  — zorunlu
 *   PROXY_SECRET    — zorunlu
 */

const express = require("express");
const cors    = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Ücretsiz model fallback sırası ───────────────────────────────────────────
// Sıralama: en yüksek RPM önce, aynı RPM'de en yeni model önce
const MODEL_FALLBACK_ORDER = [
    "models/gemini-1.5-flash",       // RPM:15 RPD:sınırsız — önce dene, eski key'lerle çalışır
    "gemini-2.5-flash-lite",  // RPM:10 RPD:20 — 1.5 yoksa
    "gemini-2.5-flash",       // RPM:5  RPD:20 — Lite dolunca
    "gemini-3-flash",         // RPM:5  RPD:20 — hepsi dolunca
];

// ── Akıllı Hibrit System Instruction ─────────────────────────────────────────
const HYBRID_SYSTEM_INSTRUCTION = `ROL: Gelişmiş Belge Sayısallaştırma ve Düzenleme Uzmanısın.

GÖREV: Sana iletilen ham OCR metnini analiz et ve aşağıdaki 3 senaryodan uygun olanına göre yapılandırılmış bir çıktı üret.

SENARYOLAR VE KURALLAR:

1. TABLO TESPİTİ:
   - Metin tablo verisi içeriyorsa tabloyu düzenle, sütun hizalamasını koru.
   - Her satırı ayrı tut, sütun ayraçlarını (|) kullan, yapıyı bozma.

2. RESİM + METİN TESPİTİ:
   - Yalnızca metin içeriğini döndür, görsel konumunu [GÖRSEL] etiketiyle belirt.
   - Metin akıcı, imla hataları düzeltilmiş, karakter bozulmalarından arındırılmış olsun.

3. SADECE METİN TESPİTİ:
   - Word Export kalitesinde temiz metin üret.
   - Karakter hatalarını düzelt: "yetenecýi" → "yeteneği", "þirket" → "şirket" vb.
   - Paragraf yapısını koru, gereksiz satır sonlarını birleştir.

GENEL KURALLAR:
   - Blok ayracı §§B§§ görürsen her bloğu ayrı işle, aynı ayraçla geri döndür.
   - Yanıt dışında açıklama ekleme, sadece işlenmiş metni döndür.
   - Türkçe karakter kurallarına uyu: ş, ç, ğ, ü, ö, ı, İ, Ş, Ç, Ğ, Ü, Ö.

FORMAT: Yalnızca işlenmiş metni döndür.`;

// ── Kimlik doğrulama ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const proxySecret  = process.env.PROXY_SECRET;
    const clientSecret = req.headers["x-proxy-secret"] || "";
    const clientKey    = req.headers["x-gemini-key"]   || "";
    if (proxySecret && clientSecret === proxySecret) return next();
    if (clientKey.startsWith("AIza")) return next();
    return res.status(401).json({ error: "Yetkisiz erişim" });
});

// ── Tek model ile istek ───────────────────────────────────────────────────────
async function tryModel(apiKey, modelName, fullPrompt) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: HYBRID_SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.1, topP: 0.9, maxOutputTokens: 8192 },
    });
    const result = await model.generateContent(fullPrompt);
    return result.response.text().trim();
}

// ── Fallback zinciri ──────────────────────────────────────────────────────────
async function generateWithFallback(apiKey, fullPrompt) {
    let lastError = null;

    for (const modelName of MODEL_FALLBACK_ORDER) {
        try {
            console.log(`[Model] ${modelName} deneniyor...`);
            const text = await tryModel(apiKey, modelName, fullPrompt);
            console.log(`[Model] ${modelName} başarılı ✓`);
            return { text, model: modelName };
        } catch (err) {
            lastError = err;
            const msg = (err.message || "").toLowerCase();
            // Bu hatalar geçici/model sorunu → sonraki modele geç
            const isRetryable =
                msg.includes("404") ||          // model bulunamadı
                msg.includes("429") ||          // rate limit aşıldı
                msg.includes("not found") ||
                msg.includes("not supported") ||
                msg.includes("deprecated") ||
                msg.includes("quota");          // günlük kota doldu
            if (!isRetryable) throw err;        // 401, 500 → zincirine devam etme
            console.warn(`[Model] ${modelName} → sonraki: ${msg.slice(0, 60)}`);
        }
    }
    throw lastError;
}

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status:      "ok",
        version:     "2.3.0",
        models:      MODEL_FALLBACK_ORDER,
        note:        "1.5-flash → 2.5-flash-lite → 2.5-flash → 3-flash",
    });
});

// ── POST /fix ────────────────────────────────────────────────────────────────
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";
    if (!rawOcrText.trim()) {
        return res.status(400).json({ error: "rawOcrText boş gönderilemez" });
    }

    const userKey = req.headers["x-gemini-key"] || "";
    const apiKey  = userKey.startsWith("AIza")
        ? userKey
        : (process.env.GEMINI_API_KEY || "");
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY eksik" });

    const fullPrompt = `BAŞLA\n\n${rawOcrText}\n\nBİTTİ`;

    try {
        const { text, model } = await generateWithFallback(apiKey, fullPrompt);

        const correctedText = text
            .replace(/^BA[SŞ]LA\s*/i, "")
            .replace(/\s*B[İI]TT[İI]$/i, "")
            .trim();

        return res.status(200).json({ correctedText, _model: model });

    } catch (err) {
        console.error("[Gemini Hata] Tüm modeller başarısız:", err.message);
        // Uygulama çökmez — ham OCR metni döner
        return res.status(200).json({
            correctedText: rawOcrText,
            _error: "Tüm modeller kullanılamıyor, ham metin döndürüldü"
        });
    }
});

// ── Sunucu başlat ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`ScanMeta OCR Proxy v2.3.0 — port ${PORT}`);
    console.log(`Fallback : ${MODEL_FALLBACK_ORDER.join(" → ")}`);
    console.log(`Auth     : ${process.env.PROXY_SECRET ? "AKTIF" : "PASİF — eksik!"}`);
    console.log(`Gemini   : ${process.env.GEMINI_API_KEY ? "AKTIF" : "PASİF — eksik!"}`);
});
