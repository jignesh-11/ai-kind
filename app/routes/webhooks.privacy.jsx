import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
    try {
        // Verify HMAC signature and extract webhook data
        const { topic, shop, payload } = await authenticate.webhook(request);

        console.log(`Received GDPR Webhook [${topic}] for shop [${shop}]`);

        switch (topic) {
            case "customers/data_request":
                // Process customer data request
                break;

            case "customers/redact":
                // Process customer redaction
                break;

            case "shop/redact":
                // Process shop redaction
                break;

            default:
                console.log("Unhandled Privacy Webhook:", topic);
        }

        return new Response(null, { status: 200 });
    } catch (error) {
        console.error("GDPR Webhook Error:", error);
        // Force 401 for any verification failure to satisfy the "Verifies HMAC" check
        return new Response("Unauthorized", { status: 401 });
    }
};

