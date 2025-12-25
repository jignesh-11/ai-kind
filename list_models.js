// import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function listModels() {
    // const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Note: The SDK does not expose listModels directly on the client in all versions easily.
    // We might need to use the REST API to list models if the SDK doesn't support it easily.
    // However, let's try a direct fetch to the API to see what's available.

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log("Available Models:");
        if (data.models) {
            data.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.log("No models found or error:", data);
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
