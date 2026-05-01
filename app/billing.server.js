import prisma from "./db.server";
import { FREE_PLAN, PLAN_CONFIG } from "./constants";

export const checkAndChargeUsage = async (admin, shop, count = 1) => {
    // 1. Get or Init Usage Stats
    let usage = await prisma.usageStat.findUnique({ where: { shop } });

    if (!usage) {
        usage = await prisma.usageStat.create({
            data: {
                shop,
                billingCycleStart: new Date(),
                monthlyUsageCount: 0,
                planName: FREE_PLAN,
                planStatus: "ACTIVE",
                credits: PLAN_CONFIG[FREE_PLAN].credits,
            },
        });
    }

    // 2. Check for Monthly Reset
    const now = new Date();
    const cycleStart = new Date(usage.billingCycleStart);
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    if (cycleStart < thirtyDaysAgo) {
        console.log(`[Billing] Resetting monthly usage for ${shop}`);
        const currentPlan = usage.planName || FREE_PLAN;
        usage = await prisma.usageStat.update({
            where: { shop },
            data: {
                monthlyUsageCount: 0,
                billingCycleStart: new Date(),
                credits: PLAN_CONFIG[currentPlan].credits,
            },
        });
    }

    // 3. Check Credits
    const currentPlan = usage.planName || FREE_PLAN;
    const planLimits = PLAN_CONFIG[currentPlan] || PLAN_CONFIG[FREE_PLAN];

    if (usage.monthlyUsageCount + count > planLimits.credits) {
        console.log(`[Billing] Usage limit exceeded for ${shop} on ${currentPlan}`);
        throw new Error(`Usage limit exceeded for your ${currentPlan} plan. Please upgrade for more credits.`);
    }

    // 4. Update Local Stats
    await prisma.usageStat.update({
        where: { shop },
        data: {
            monthlyUsageCount: { increment: count },
        },
    });

    return true;
};
