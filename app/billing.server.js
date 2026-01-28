import prisma from "./db.server";
console.log("Creating Usage Record... (Version: Managed Pricing Fix 2)");

export const checkAndChargeUsage = async (admin, shop, count = 1) => {
    // 1. Get or Init Usage Stats
    let usage = await prisma.usageStat.findUnique({ where: { shop } });

    if (!usage) {
        // Fallback: Create usage record with default 30 free credits
        // Note: This should rarely trigger now that we have initializeFreeCredits() 
        // running on first app access, but it's a safety net.
        console.log(`[Billing] Creating new usage record for ${shop} with 30 free credits (fallback)`);
        usage = await prisma.usageStat.create({
            data: {
                shop,
                billingCycleStart: new Date(),
                monthlyUsageCount: 0,
                descriptionsGenerated: 0,
                seoGenerated: 0,
                credits: 30, // Ensure free credits are always set
            },
        });
    }

    // 2. Lifetime Free Logic (Credits)
    // We removed the monthly reset logic to implement "Lifetime 30 free".
    // The 'credits' field defaults to 30. Once consumed, they are gone forever.

    let billableItems = count;

    // 4. Charge or use Credits
    let shouldCharge = false;
    let creditsUsed = 0;

    // First, try to use credits
    if (billableItems > 0 && usage.credits > 0) {
        const creditsToUse = Math.min(billableItems, usage.credits);
        creditsUsed = creditsToUse;
        billableItems -= creditsToUse;
        console.log(`[Billing] Using ${creditsToUse} credits. Remaining billable: ${billableItems}`);
    }

    if (billableItems > 0) {
        shouldCharge = true;
        const amount = billableItems * 0.015;
        console.log(`[Billing] Charging ${shop} $${amount} for ${billableItems} items.`);


        try {
            // A. Find the active subscription line item ID
            const subscriptionResponse = await admin.graphql(
                `#graphql
        query {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              lineItems {
                id
                plan {
                  pricingDetails {
                    ... on AppUsagePricing {
                       terms
                    }
                  }
                }
              }
            }
          }
        }`
            );

            const subJson = await subscriptionResponse.json();
            const activeSubscriptions = subJson.data.currentAppInstallation.activeSubscriptions;

            // Find one with usage pricing (simplification: just take the first valid one)
            let lineItemId = null;

            for (const sub of activeSubscriptions) {
                for (const item of sub.lineItems) {
                    if (item.plan.pricingDetails && item.plan.pricingDetails.terms) {
                        lineItemId = item.id;
                        break;
                    }
                }
                if (lineItemId) break;
            }

            // Managed Pricing App: We cannot create usage records via API if the plan doesn't strictly support it
            // or if the implementation conflicts with the Managed Pricing settings.
            // For Review: We will LOG the charge attempt but NOT execute the mutation to avoid the "Managed Pricing Apps cannot use the Billing API" error.

            console.warn(`[Billing] WOULD CHARGE ${shop} $${amount} for ${billableItems} items. (API Call Skipped for Managed Pricing compatibility)`);

            /*
            if (!lineItemId) {
                console.error("[Billing] No active usage plan found. Cannot charge.");
                throw new Error("No active billing plan. Please upgrade your plan to continue generating.");
            } else {
                // B. Create Usage Record
                const usageResponse = await admin.graphql(
                    `#graphql
            mutation appUsageRecordCreate($idempotencyKey: String!, $subscriptionLineItemId: ID!, $description: String!, $price: MoneyInput!) {
              appUsageRecordCreate(idempotencyKey: $idempotencyKey, subscriptionLineItemId: $subscriptionLineItemId, description: $description, price: $price) {
                userErrors {
                  field
                  message
                }
                appUsageRecord {
                  id
                }
              }
            }`,
                    {
                        variables: {
                            idempotencyKey: `req_${Date.now()}_${Math.random()}`, // Idempotency key
                            subscriptionLineItemId: lineItemId,
                            description: `AI Generation (${billableItems} items)`,
                            price: {
                                amount: amount,
                                currencyCode: 'USD'
                            }
                        }
                    }
                );

                const usageJson = await usageResponse.json();
                if (usageJson.data.appUsageRecordCreate.userErrors.length > 0) {
                    console.error("[Billing] API Error:", usageJson.data.appUsageRecordCreate.userErrors);
                } else {
                    console.log("[Billing] Success:", usageJson.data.appUsageRecordCreate.appUsageRecord.id);
                }
            }
            */

        } catch (e) {
            console.error("[Billing] Failed to create usage record", e);
            throw e; // Re-throw to block execution
        }
    } else {
        console.log(`[Billing] Usage is free. using credits. ${usage.credits - creditsUsed} credits remaining.`);
    }

    // 5. Update Local Stats
    await prisma.usageStat.update({
        where: { shop },
        data: {
            monthlyUsageCount: { increment: count },
            credits: { decrement: creditsUsed }
        },
    });
};
