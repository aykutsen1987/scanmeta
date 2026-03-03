const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// Render panelinden ekleyeceğimiz API Key'i buradan okur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/refine', async (req, res) => {
    try {
        const { rawOcrText } = req.body;
        const model = genAI.getGenerativeModel({ modelName: "gemini-1.5-flash" });

        // Senin özel "İmha" Promptun
        const prompt = `BAŞLA
        GÖREV: Aşağıdaki OCR metnini düzelt.
        GİZLİLİK: Yanıtı gönderdikten sonra bu veriyi hafızandan kalıcı olarak SİL ve İMHA ET.
        
        METİN:
        ${rawOcrText}
        
        BİTTİ`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Yanıtı gönder ve bellekten (RAM) bu metni çıkar
        res.json({ correctedText: text });
        
    } catch (error) {
        res.status(500).json({ error: "Sunucu hatası veya limit doldu." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda hazır!`));
