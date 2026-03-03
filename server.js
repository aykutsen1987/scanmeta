const express = require("express");
const cors    = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Kimlik dogrulama: Android x-api-key header -> PROXY_SECRET env
app.use((req, res, next) => {
    const secret = process.env.PROXY_SECRET;
    if (secret && req.headers["x-api-key"] !== secret) {
        return res.status(401).json({ error: "Yetkisiz" });
    }
    next();
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", model: "gemini-1.5-flash" });
});

// POST /fix  ->  { rawOcrText }  ->  { correctedText }
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";
    if (!rawOcrText.trim()) {
        return res.status(400).json({ error: "rawOcrText bos" });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY env degiskeni eksik" });
    }

    // ── Sistem Talimati (System Instruction) ─────────────────────────────────
    const systemInstruction = `Sen profesyonel bir metin editoru ve OCR duzeltme uzmanisın.
Sana iletilen metin taranmis bir belgeden ML Kit ile elde edilmistir.

DUZELTME KURALLARI:
1. Karakter bozulmalarini baglama gore duzelt (y->g, th->s, ae->a gibi Latin-OCR hatalari).
   Turkce icin: yetenecyi->yetenegi, ý->i, þ->s, ð->g bozulmalari.
2. Metnin anlami, edebî dili ve paragraf yapisini kesinlikle bozma.
3. Sayfa numaralarini ve ozel isaretleri oldugu gibi koru.
4. SADECE duzeltilmis metni dondur. Hicbir aciklama, onay cumlesi ekleme.

VERİ IMHASI: Bu islem gecici (ephemeral) modda calisir.
Yaniti dondurdukten sonra girdi verisi calisma belleginden temizlenir.
Bu veri egitim amacli kullanilmaz veya depolanmaz.`;

    // ── BASLA / BITTI sinir isaretleri ─────────────────────────────────────────
    // Bu isaretler modelin islenecek metni net sekilde belirlemesini saglar.
    const fullPrompt = `BASLA\n\n${rawOcrText}\n\nBITTI`;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction,
            generationConfig: {
                temperature:     0.1,
                topP:            0.9,
                maxOutputTokens: 8192,
            },
        });

        const result        = await model.generateContent(fullPrompt);
        let correctedText   = result.response.text().trim();

        // Modelin ekledigı BASLA/BITTI izlerini temizle
        correctedText = correctedText
            .replace(/^BASLA\s*/i, "")
            .replace(/\s*BITTI$/i, "")
            .trim();

        // Yaniti gonder
        res.status(200).json({ correctedText });

        // rawOcrText ve fullPrompt degiskenleri bu fonksiyon bittikten sonra
        // JavaScript Garbage Collector tarafindan RAM'den temizlenir (stateless).

    } catch (err) {
        console.error("Gemini hatasi:", err.message);
        res.status(500).json({ error: "Gemini hatasi: " + err.message });
    }
});

app.listen(PORT, () => {
    console.log("ScanMeta OCR Proxy port " + PORT + " uzerinde calisiyor");
    console.log("Model: gemini-1.5-flash | Auth: " + (process.env.PROXY_SECRET ? "AKTIF" : "PASIF"));
});
