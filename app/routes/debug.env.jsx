import { json } from "@remix-run/node";

// Security: this route is disabled in production
export const loader = async () => {
  if (process.env.NODE_ENV !== "development") {
    throw new Response("Not Found", { status: 404 });
  }
  return json({
    NODE_ENV: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    geminiKeyCount: (process.env.GEMINI_API_KEYS || "").split(",").filter(Boolean).length,
    hasShopifyApiKey: !!process.env.SHOPIFY_API_KEY,
  });
};

export default function DebugEnv() {
  return null;
}
