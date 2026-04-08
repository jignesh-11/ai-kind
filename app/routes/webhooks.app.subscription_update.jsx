import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    if (!admin) {
        // The admin context isn't returned if the webhook fired after a shop was uninstalled.
        // However, APP_SUBSCRIPTION_UPDATE usually fires while installed.
        // If not admin, we might need to handle differently, but usually safe to ignore if we just want status.
    }

    // The payload contains the 'app_subscription' object
    const subscription = payload.app_subscription;

    if (subscription) {
        console.log(`[Webhook] Subscription Update for ${shop}: ${subscription.status}`);

        try {
            // Update the localized status in our DB
            await db.usageStat.upsert({
                where: { shop },
                create: {
                    shop,
                    subscriptionId: subscription.gid || subscription.admin_graphql_api_id, // Shopify sends GID or ID
                    planStatus: subscription.status,
                    planName: subscription.name
                },
                update: {
                    planStatus: subscription.status,
                    planName: subscription.name,
                    // Carefully update ID only if changed/present
                    subscriptionId: subscription.gid || subscription.admin_graphql_api_id,
                }
            });
        } catch (error) {
            console.error("[Webhook] Failed to update subscription status:", error);
        }
    }

    return new Response();
};
