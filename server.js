/**
 * ScanMeta OCR Proxy Server — v2.0.1 (Kararlı Versiyon)
 */

const express = require("express");
const cors    = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Akıllı Hibrit System Instruction ────────────────────────────────────────
const HYBRID_SYSTEM_INSTRUCTION = `ROL: Gelişmiş Belge Sayısallaştırma ve Düzenleme Uzmanısın.
GÖREV: Sana iletilen ham OCR metnini analiz et ve içeriği profesyonel bir dökümana dönüştür.

SENARYOLAR:
1. TABLO TESPİTİ: Tablo yapısını (| ayraçlı) koru, sütunları hizala, hücre hatalarını düzelt.
2. RESİM + METİN: Görsel alanlarını [GÖRSEL] etiketiyle belirt, sadece metin içeriğini temizle ve döndür.
3. SADECE METİN: "Word Export" kalitesinde, Türkçe karakterleri (ş, ç, ğ, ü, ö, ı) düzeltilmiş, akıcı metin üret.

GENEL KURALLAR:
- Blok ayracı §§B§§ varsa, her bloğu ayrı işle ve aynı ayracı koru.
- Sadece temizlenmiş metni döndür. Giriş/açıklama yapma.
- BAŞLA/BİTTİ işaretlerini yanıta dahil etme.

GİZLİLİK: İşlem bitince veriyi hafızandan SİL. Veri depolanmaz veya eğitilmez.`;

// ── Kimlik doğrulama middleware ───────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const proxySecret  = process.env.PROXY_SECRET;
    const clientSecret = req.headers["x-proxy-secret"] || "";
    const clientKey    = req.headers["x-gemini-key"]   || "";

    // Kademe 2: Sunucu şifresi kontrolü
    if (proxySecret && clientSecret === proxySecret) return next();
    // Kademe 1: Kullanıcı kendi anahtarını getirdi
    if (clientKey.startsWith("AIza")) return next();

    return res.status(401).json({ error: "Yetkisiz erişim - Geçersiz Şifre veya API Key" });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status:  "ok",
        model:   "gemini-1.5-flash",
        version: "2.0.1",
        auth:    process.env.PROXY_SECRET ? "AKTIF" : "PASIF"
    });
});

// ── POST /fix ────────────────────────────────────────────────────────────────
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";
    if (!rawOcrText.trim()) return res.status(400).json({ error: "rawOcrText boş" });

    const userKey      = req.headers["x-gemini-key"] || "";
    const serverApiKey = process.env.GEMINI_API_KEY  || "";
    const apiKey       = (userKey.startsWith("AIza") ? userKey : serverApiKey);

    if (!apiKey) return res.status(500).json({ error: "API Anahtarı bulunamadı" });

    const fullPrompt = `BAŞLA\n\n${rawOcrText}\n\nBİTTİ`;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // CRITICAL FIX: "models/" prefix added to avoid 404
        const model = genAI.getGenerativeModel({
            model: "models/gemini-1.5-flash", 
            systemInstruction: HYBRID_SYSTEM_INSTRUCTION
        });

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        let correctedText = response.text().trim();

        // Temizlik: Gereksiz etiketleri kaldır
        correctedText = correctedText
            .replace(/^BA[SŞ]LA\s*/i, "")
            .replace(/\s*B[İI]TT[İI]$/i, "")
            .trim();

        res.status(200).json({ correctedText });

    } catch (err) {
        console.error("[Gemini Hata]", err.message);
        res.status(500).json({ error: "Gemini API Hatası: " + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`ScanMeta Proxy v2.0.1 ayağa kalktı. Port: ${PORT}`);
});
