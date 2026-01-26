
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

        // Use ArrayBuffer -> Buffer to ensure we process raw bytes exactly as received
        const buffer = await request.arrayBuffer();
        const rawBody = Buffer.from(buffer);

        const digest = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("base64");

        if (digest !== hmac) {
            console.error(`HMAC Fail: Recv [${hmac}] vs Calc [${digest}]`);
            return new Response("Unauthorized", { status: 401 });
        }

        console.log(`Received Valid GDPR Webhook [${topic}] for shop [${shop}]`);
        return new Response("Shop Data has been erased", { status: 200 });

    } catch (error) {
        console.error("GDPR Webhook Error:", error);
        return new Response(null, { status: 500 });
    }
};
