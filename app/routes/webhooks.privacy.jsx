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
        // If authentication fails, authenticate.webhook throws a Response (401/400).
        // If we catch it here and it's a Response, throw it again to let Remix handle it.
        if (error instanceof Response) {
            throw error;
        }
        return new Response(null, { status: 500 });
    }
};
