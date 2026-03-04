# ScanMeta OCR Proxy — Node.js (v2.0.0)

Render / Railway / Fly.io üzerinde çalışan Gemini 1.5 Flash proxy sunucusu.

## Kurulum

```bash
npm install
npm start
```

## Render Deploy Adımları

1. GitHub'a push et
2. Render → **New Web Service** → repo seç
3. **Environment** sekmesine ekle:

| Değişken         | Değer                          |
|------------------|-------------------------------|
| `GEMINI_API_KEY` | |
| `PROXY_SECRET`   | |

4. Build Command: `npm install`  
   Start Command:  `node server.js`

## Endpoint'ler

| Yöntem | URL      | Açıklama                  |
|--------|----------|---------------------------|
| GET    | /health  | Sunucu sağlık kontrolü    |
| POST   | /fix     | OCR metni düzelt (Gemini) |

### POST /fix

**İstek:**
```json
{ "rawOcrText": "ham OCR metni buraya..." }
```

**Başlıklar:**
- `x-proxy-secret: <PROXY_SECRET>` → Gömülü anahtar (Kademe 2)
- `x-gemini-key: <AIza...>`        → Kullanıcı anahtarı (Kademe 1)

**Yanıt:**
```json
{ "correctedText": "Gemini tarafından düzeltilmiş metin" }
```

## Akıllı Hibrit Prompt

Gemini 3 senaryodan birini otomatik seçer:

1. **TABLO** — Sütun hizalaması korunur, | ayraçları kullanılır
2. **RESİM + METİN** — Görsel konumları [GÖRSEL] etiketiyle işaretlenir, metin düzeltilir
3. **SADECE METİN** — Word kalitesinde karakter düzeltmeli temiz metin

## Android Bağlantısı

`AiOcrCorrectionEngine.kt` içindeki sabitler:
```kotlin
private const val BUILT_IN_PROXY_URL    = "https://<render-url>.onrender.com"
private const val BUILT_IN_PROXY_SECRET = "04699028burcu"
```
