import { GoogleGenerativeAI } from "@google/generative-ai";

const getApiKeys = () => {
    const keys = [];

    const cleanKey = (k) => {
        if (!k) return null;
        let trimmed = k.trim();
        // Remove quotes if user added them
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            trimmed = trimmed.slice(1, -1);
        }
        // Basic validation: must be reasonably long
        if (trimmed.length < 10) return null;
        return trimmed;
    };

    // 1. Primary legacy key (or list accidentally put in single var)
    if (process.env.GEMINI_API_KEY) {
        if (process.env.GEMINI_API_KEY.includes(',')) {
            process.env.GEMINI_API_KEY.split(',').forEach(raw => {
                const k = cleanKey(raw);
                if (k && !keys.includes(k)) keys.push(k);
            });
        } else {
            const k = cleanKey(process.env.GEMINI_API_KEY);
            if (k) keys.push(k);
        }
    }

    // 2. Comma-separated list
    if (process.env.GEMINI_API_KEYS) {
        process.env.GEMINI_API_KEYS.split(',').forEach(raw => {
            const k = cleanKey(raw);
            if (k && !keys.includes(k)) keys.push(k);
        });
    }

    // 3. Indexed keys (GEMINI_API_KEY_1, ..._20)
    for (let i = 1; i <= 20; i++) {
        const raw = process.env[`GEMINI_API_KEY_${i}`];
        const k = cleanKey(raw);
        if (k && !keys.includes(k)) keys.push(k);
    }

    return keys;
};

// Basic getter for the raw model if needed (legacy)
export const getGeminiModel = (modelName = "gemini-1.5-flash") => {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error("No Gemini keys found");
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    const genAI = new GoogleGenerativeAI(randomKey);
    return genAI.getGenerativeModel({ model: modelName });
};

// Robust generator with auto-retry
export const generateContentSafe = async (prompt, modelName = "gemini-2.5-flash") => {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error("No valid GEMINI_API_KEY found.");

    // Shuffle keys to distribute load, but ensure we try ALL of them if needed
    const shuffledKeys = [...keys].sort(() => 0.5 - Math.random());

    let lastError = null;

    for (const key of shuffledKeys) {
        try {
            console.log(`[Gemini Server] Trying key ...${key.slice(-4)}`);
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text(); // Return pure text string

        } catch (error) {
            console.warn(`[Gemini Server] Key ...${key.slice(-4)} failed: ${error.message}`);
            lastError = error;
            // Continue to next key...
        }
    }

    console.error(`[Gemini Server] All ${keys.length} keys failed.`);
    throw new Error(`Failed to generate content after trying ${keys.length} keys. Last error: ${lastError?.message}`);
};
