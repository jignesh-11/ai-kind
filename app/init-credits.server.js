import prisma from "./db.server";
import { sendInstallNotification } from "./notify-install.server";
import { FREE_PLAN, PLAN_CONFIG } from "./constants";

/**
 * Initialize free credits for a new shop installation.
 * This ensures that every new merchant gets the starter credits immediately upon first access.
 *
 * @param {string} shop - The shop domain
 * @returns {Promise<boolean>} true if this is a new install
 */
export async function initializeFreeCredits(shop) {
    try {
        // Check if usage stats already exist for this shop
        const existingUsage = await prisma.usageStat.findUnique({
            where: { shop }
        });

        // If no record exists, create one with launch credits
        if (!existingUsage) {
            const startCredits = PLAN_CONFIG[FREE_PLAN].credits;
            console.log(`[Init Credits] Creating new UsageStat with ${startCredits} credits for shop: ${shop}`);
            await prisma.usageStat.create({
                data: {
                    shop,
                    billingCycleStart: new Date(),
                    monthlyUsageCount: 0,
                    planName: FREE_PLAN,
                    planStatus: "ACTIVE",
                    descriptionsGenerated: 0,
                    seoGenerated: 0,
                    credits: startCredits,
                },
            });
            console.log(`[Init Credits] Successfully initialized ${startCredits} credits for: ${shop}`);

            // Fire-and-forget email notification — never blocks app loading
            sendInstallNotification(shop).catch(() => { });
            return true;
        } else {
            console.log(`[Init Credits] Shop ${shop} already has usage stats. Plan: ${existingUsage.planName}, Credits: ${existingUsage.credits}`);
            return false;
        }
    } catch (error) {
        console.error(`[Init Credits] Error initializing credits for ${shop}:`, error);
        // Don't throw - we don't want to block the app from loading
    }
}
