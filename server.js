/**
 * ScanMeta OCR Proxy Server — v2.0.0
 * ====================================
 * Render / Railway / Fly.io üzerinde çalışır.
 *
 * Ortam değişkenleri (Render → Environment):
 *   GEMINI_API_KEY   — zorunlu
 *   PROXY_SECRET     — zorunlu  (Android'daki BUILT_IN_PROXY_SECRET ile aynı olmalı)
 *   PORT             — opsiyonel (Render otomatik atar)
 *
 * Kimlik doğrulama:
 *   Android Kademe 2 → x-proxy-secret: <PROXY_SECRET>
 *   Android Kademe 1 → x-gemini-key:   <kullanıcının kendi anahtarı>
 *   İkisi de yoksa → 401 Yetkisiz
 *
 * Endpoint'ler:
 *   GET  /health  → { status, model, version }
 *   POST /fix     → { rawOcrText } → { correctedText }
 */

const express = require("express");
const cors    = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Akıllı Hibrit System Instruction ────────────────────────────────────────
// Gemini'ye 3 senaryo kuralı verilir; model ham OCR metnini analiz edip
// hangi senaryoya uyduğunu otomatik belirler.
const HYBRID_SYSTEM_INSTRUCTION = `ROL: Gelişmiş Belge Sayısallaştırma ve Düzenleme Uzmanısın.

GÖREV: Sana iletilen ham OCR metnini analiz et ve aşağıdaki 3 senaryodan uygun olanına göre yapılandırılmış bir çıktı üret.

SENARYOLAR VE KURALLAR:

1. TABLO TESPİTİ:
   - Metin tablo verisi içeriyorsa (başlık satırı, hizalı sütunlar, | karakterleri, tire çizgileri vb.) tabloyu düzenle.
   - Sütun hizalamasını koru, hücre içeriklerini düzelt, başlıkları belirginleştir.
   - Her satırı ayrı bir satır olarak koru, sütun ayraçlarını (|) kullan.
   - Tablo yapısını bozma, satır birleştirme yapma.

2. RESİM + METİN TESPİTİ:
   - Metin ve görsel/şekil/çizim birlikte geçiyorsa yalnızca metin içeriğini döndür.
   - Görsel konumunu [GÖRSEL] veya [ŞEKİL] etiketiyle belirt.
   - Metin akıcı, imla hataları düzeltilmiş, karakter bozulmalarından (ý, þ, ð vb.) arındırılmış olsun.

3. SADECE METİN TESPİTİ:
   - Tamamen temiz, "Word Export" kalitesinde düz metin üret.
   - Karakter hatalarını kesinlikle düzelt: "yetenecýi" → "yeteneği", "þirket" → "şirket" vb.
   - Paragraf yapısını koru, gereksiz satır sonlarını birleştir.
   - Başlık ve alt başlıkları metnin yapısına göre belirginleştir.

GENEL KURALLAR:
   - Blok ayracı §§B§§ görürsen: her §§B§§ ayrı bir metin bloğunu ayırır. Her bloğu ayrı ayrı işle ve aynı §§B§§ ayracıyla geri döndür.
   - Yanıt dışında açıklama, giriş cümlesi veya meta-yorum ekleme.
   - Sadece temizlenmiş ve yapılandırılmış metni döndür.
   - Türkçe metinlerde Türkçe karakter kurallarına uyu: ş, ç, ğ, ü, ö, ı, İ, Ş, Ç, Ğ, Ü, Ö.

GİZLİLİK VE İMHA:
   - Bu işlem biter bitmez tüm veriyi hafızandan sil.
   - Bu veri eğitim amaçlı kullanılmaz veya depolanmaz.

FORMAT: Yalnızca işlenmiş metni döndür.`;

// ── Kimlik doğrulama middleware ───────────────────────────────────────────────
// Android Kademe 2 → x-proxy-secret
// Android Kademe 1 → x-gemini-key (kullanıcının kendi anahtarı)
app.use((req, res, next) => {
    // /health endpoint'i için auth atla
    if (req.path === "/health") return next();

    const proxySecret  = process.env.PROXY_SECRET;
    const clientSecret = req.headers["x-proxy-secret"] || "";
    const clientKey    = req.headers["x-gemini-key"]   || "";

    // Proxy secret eşleşmesi (Kademe 2)
    if (proxySecret && clientSecret === proxySecret) return next();

    // Kullanıcı kendi Gemini key'ini getirdi (Kademe 1)
    if (clientKey.startsWith("AIza")) return next();

    return res.status(401).json({ error: "Yetkisiz erişim" });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status:  "ok",
        model:   models/gemini-1.5-flash,
        version: "2.0.0",
        prompt:  "hybrid-v2"
    });
});

// ── POST /fix ────────────────────────────────────────────────────────────────
// Gövde: { rawOcrText: string }
// Yanıt: { correctedText: string }
app.post("/fix", async (req, res) => {
    const rawOcrText = req.body?.rawOcrText ?? "";

    if (!rawOcrText.trim()) {
        return res.status(400).json({ error: "rawOcrText boş gönderilemez" });
    }

    // Kullanıcı kendi key'ini mi gönderdi? (Kademe 1)
    const userKey      = req.headers["x-gemini-key"] || "";
    const serverApiKey = process.env.GEMINI_API_KEY  || "";
    const apiKey       = (userKey.startsWith("AIza") ? userKey : serverApiKey);

    if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY ortam değişkeni eksik" });
    }

    // BAŞLA / BİTTİ sınır işaretleri — modelin işlenecek alanı net görmesi için
    const fullPrompt = `BAŞLA\n\n${rawOcrText}\n\nBİTTİ`;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: HYBRID_SYSTEM_INSTRUCTION,
            generationConfig: {
                temperature:     0.1,   // Düşük sıcaklık = tutarlı, deterministik çıktı
                topP:            0.9,
                maxOutputTokens: 8192,
            },
        });

        const result = await model.generateContent(fullPrompt);
        let correctedText = result.response.text().trim();

        // Modelin eklemiş olabileceği BAŞLA/BİTTİ izlerini temizle
        correctedText = correctedText
            .replace(/^BA[SŞ]LA\s*/i, "")
            .replace(/\s*B[İI]TT[İI]$/i, "")
            .trim();

        // rawOcrText ve fullPrompt bu fonksiyon sonrası GC tarafından temizlenir (stateless)
        return res.status(200).json({ correctedText });

    } catch (err) {
        console.error("[Gemini Hata]", err.message);
        return res.status(500).json({ error: "Gemini API hatası: " + err.message });
    }
});

// ── Sunucu başlat ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`ScanMeta OCR Proxy v2.0.0 — port ${PORT} üzerinde çalışıyor`);
    console.log(`Model   : gemini-1.5-flash | Prompt: hybrid-v2`);
    console.log(`Auth    : ${process.env.PROXY_SECRET ? "AKTIF (x-proxy-secret)" : "PASİF — PROXY_SECRET eksik!"}`);
    console.log(`Gemini  : ${process.env.GEMINI_API_KEY ? "AKTIF" : "PASİF — GEMINI_API_KEY eksik!"}`);
});
