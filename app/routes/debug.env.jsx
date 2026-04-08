
import { json } from "@remix-run/node";

export const loader = async () => {
    const secret = process.env.SHOPIFY_API_SECRET;
    return json({
        isInEnv: !!secret,
        length: secret ? secret.length : 0,
        prefix: secret ? secret.substring(0, 4) + "..." : "N/A"
    });
};
