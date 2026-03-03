# ScanMeta OCR Proxy

Render.com Node.js proxy - Gemini 1.5 Flash ile OCR duzeltme.

## Deploy (Render.com)

1. Bu klasoru GitHub reposuna push edin
2. render.com -> New Web Service -> GitHub repo secin
3. Environment Variables:
   - GEMINI_API_KEY = Google AI Studio API key
   - PROXY_SECRET   = Istediginiz guvenlik sifresi
4. Start Command: node server.js
5. Deploy sonrasi URL: https://your-app.onrender.com

## Android Ayarlar

ScanMeta -> Ayarlar -> Gemini AI OCR:
- Proxy URL: https://your-app.onrender.com
- Gemini Key: PROXY_SECRET degeri

## Nasil Calisir

Android ML Kit OCR -> POST /fix -> Render Proxy -> Gemini 1.5 Flash

Her istek BASLA...BITTI sinirlariyla gonderilir.
Yanit dondukten sonra JS GC yerel degiskenleri RAM den temizler (stateless).
