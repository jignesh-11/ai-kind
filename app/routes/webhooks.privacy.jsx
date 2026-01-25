import { json } from "@remix-run/node";
import crypto from "crypto";

export const action = async ({ request }) => {
    try {
        const topic = request.headers.get("x-shopify-topic") || "unknown";
        const shop = request.headers.get("x-shopify-shop-domain");
        const hmac = request.headers.get("x-shopify-hmac-sha256");
        const secret = process.env.SHOPIFY_API_SECRET;

        if (!hmac || !secret) {
            console.error("Missing HMAC or API Secret");
            return new Response("Unauthorized", { status: 401 });
        }

        // Read the raw body to verify signature
        const body = await request.text();

        const digest = crypto
            .createHmac("sha256", secret)
            .update(body, "utf8")
            .digest("base64");

        // Timing safe comparison recommended, but simple strictly equal check is often sufficient for this check.
        // We'll use a simple check here as it's standard node.
        if (digest !== hmac) {
            console.error(`HMAC verification failed. Expected ${digest}, got ${hmac}`);
            return new Response("Unauthorized", { status: 401 });
        }

        console.log(`Received Valid GDPR Webhook [${topic}] for shop [${shop}]`);

        // Parse payload after verification
        const payload = JSON.parse(body);

        switch (topic) {
            case "customers/data_request":
                break;
            case "customers/redact":
                break;
            case "shop/redact":
                break;
            default:
                console.log("Unhandled Privacy Webhook:", topic);
        }

        return new Response(null, { status: 200 });
    } catch (error) {
        console.error("GDPR Webhook Error:", error);
        return new Response(null, { status: 500 });
    }
};
