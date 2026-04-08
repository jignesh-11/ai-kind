
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const getApiKeys = () => {
    const keys = [];
    // 1. Primary legacy key
    if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
    // 2. Comma-separated
    if (process.env.GEMINI_API_KEYS) {
        process.env.GEMINI_API_KEYS.split(',').forEach(k => keys.push(k.trim()));
    }
    // 3. Indexed
    for (let i = 1; i <= 10; i++) {
        const k = process.env[`GEMINI_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
};

async function testKeys() {
    const keys = getApiKeys();
    console.log(`Found ${keys.length} keys.`);

    if (keys.length === 0) {
        console.error("No keys found in .env");
        return;
    }

    const key = keys[0]; // Test first key
    console.log(`Testing key ending in ...${key.slice(-4)}`);

    const genAI = new GoogleGenerativeAI(key);

    const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash-exp", "gemini-1.5-flash", "gemini-pro"];

    for (const m of modelsToTry) {
        try {
            console.log(`\nTrying model: ${m}...`);
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("Hello!");
            console.log(`SUCCESS with ${m}!`);
            const response = await result.response;
            console.log(response.text());
            return; // Exit on first success
        } catch (e) {
            console.error(`FAILED ${m}: ${e.message}`);
        }
    }
}

testKeys();
