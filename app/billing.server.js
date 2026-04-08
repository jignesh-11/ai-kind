import prisma from "./db.server";
console.log("Creating Usage Record... (Version: Managed Pricing Fix 2)");

export const checkAndChargeUsage = async (admin, shop, count = 1) => {
    // BILLING DISABLED: This function now only tracks usage stats without charging or checking credits.
    console.log(`[Billing] checkAndChargeUsage called for ${shop}. Billing is DISABLED.`);

    // 1. Get or Init Usage Stats
    let usage = await prisma.usageStat.findUnique({ where: { shop } });

    if (!usage) {
        console.log(`[Billing] Creating new usage record for ${shop} (fallback)`);
        usage = await prisma.usageStat.create({
            data: {
                shop,
                billingCycleStart: new Date(),
                monthlyUsageCount: 0,
                descriptionsGenerated: 0,
                seoGenerated: 0,
                credits: 999999, // Give virtually infinite credits just in case
            },
        });
    }

    // 5. Update Local Stats (Only increment usage, do not decrement credits)
    await prisma.usageStat.update({
        where: { shop },
        data: {
            monthlyUsageCount: { increment: count },
            // credits: { decrement: creditsUsed } // Do not decrement credits
        },
    });

    return true; // Always allow usage
};
