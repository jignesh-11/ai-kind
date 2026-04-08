import { GoogleGenerativeAI } from "@google/generative-ai";

const getApiKeys = () => {
    const keys = [];

    const cleanKey = (k) => {
        if (!k) return null;
        let trimmed = k.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            trimmed = trimmed.slice(1, -1);
        }
        if (trimmed.length < 10) return null;
        return trimmed;
    };

    // 1. Primary key (supports comma-separated list in single var)
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

    // 2. Comma-separated list variable
    if (process.env.GEMINI_API_KEYS) {
        process.env.GEMINI_API_KEYS.split(',').forEach(raw => {
            const k = cleanKey(raw);
            if (k && !keys.includes(k)) keys.push(k);
        });
    }

    // 3. Indexed keys GEMINI_API_KEY_1 ... GEMINI_API_KEY_20
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

/**
 * Generate text content with automatic key rotation and retry.
 * Returns a plain text string.
 */
export const generateContentSafe = async (prompt, modelName = "gemini-2.5-flash") => {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error("No valid GEMINI_API_KEY found.");

    const shuffledKeys = [...keys].sort(() => 0.5 - Math.random());
    let lastError = null;

    for (const key of shuffledKeys) {
        try {
            console.log(`[Gemini] Trying key ...${key.slice(-4)}`);
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.warn(`[Gemini] Key ...${key.slice(-4)} failed: ${error.message}`);
            lastError = error;
        }
    }

    throw new Error(`All ${keys.length} Gemini keys failed. Last error: ${lastError?.message}`);
};

/**
 * Generate structured JSON using Gemini's native JSON mode.
 * Returns a parsed JS object — no regex cleanup needed.
 *
 * @param {string} prompt
 * @param {object} schema  - Gemini responseSchema object
 * @param {string} modelName
 */
export const generateJsonSafe = async (prompt, schema, modelName = "gemini-2.5-flash") => {
    const keys = getApiKeys();
    if (keys.length === 0) throw new Error("No valid GEMINI_API_KEY found.");

    const shuffledKeys = [...keys].sort(() => 0.5 - Math.random());
    let lastError = null;

    for (const key of shuffledKeys) {
        try {
            console.log(`[Gemini JSON] Trying key ...${key.slice(-4)}`);
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                },
            });
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return JSON.parse(text);
        } catch (error) {
            console.warn(`[Gemini JSON] Key ...${key.slice(-4)} failed: ${error.message}`);
            lastError = error;
        }
    }

    throw new Error(`All ${keys.length} Gemini keys failed. Last error: ${lastError?.message}`);
};
