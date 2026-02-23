import prisma from "./db.server";

/**
 * Initialize free credits for a new shop installation.
 * This ensures that every new merchant gets 30 free credits immediately upon first access.
 * 
 * @param {string} shop - The shop domain
 * @returns {Promise<void>}
 */
export async function initializeFreeCredits(shop) {
    try {
        // Check if usage stats already exist for this shop
        const existingUsage = await prisma.usageStat.findUnique({
            where: { shop }
        });

        // If no record exists, create one with 30 free credits
        if (!existingUsage) {
            console.log(`[Init Credits] Creating new UsageStat with 30 free credits for shop: ${shop}`);
            await prisma.usageStat.create({
                data: {
                    shop,
                    billingCycleStart: new Date(),
                    monthlyUsageCount: 0,
                    descriptionsGenerated: 0,
                    seoGenerated: 0,
                    credits: 30, // Free credits for new installations
                },
            });
            console.log(`[Init Credits] Successfully initialized 30 free credits for: ${shop}`);
        } else {
            console.log(`[Init Credits] Shop ${shop} already has usage stats. Credits: ${existingUsage.credits}`);
        }
    } catch (error) {
        console.error(`[Init Credits] Error initializing credits for ${shop}:`, error);
        // Don't throw - we don't want to block the app from loading
    }
}
