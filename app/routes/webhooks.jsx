
import { json } from "@remix-run/node";
import crypto from "crypto";

export const loader = () => new Response("Method Not Allowed", { status: 405 });

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

    // Verify HMAC
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

    console.log(`Received Valid Webhook [${topic}] for shop [${shop}]`);

    // Handle Topics
    switch (topic) {
      case "customers/data_request":
        return new Response("we do not save customer data", { status: 200 });
      case "customers/redact":
        return new Response("we do not save customer data", { status: 200 });
      case "shop/redact":
        return new Response("Shop Data has been erased", { status: 200 });
      default:
        // Since this is a shared endpoint, we might receive other topics too.
        // Just return 200 OK.
        console.log("Unhandled via shared route:", topic);
        return new Response(null, { status: 200 });
    }

  } catch (error) {
    console.error("Webhook Error:", error);
    return new Response(null, { status: 500 });
  }
};
