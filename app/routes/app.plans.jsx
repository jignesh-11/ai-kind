import { json } from "@remix-run/node";
import { useEffect, useState } from "react";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    ProgressBar,
    Banner,
    Button,
    InlineGrid,
    Box,

    Divider,
    InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const usage = await prisma.usageStat.findUnique({
        where: { shop: session.shop }
    });

    // Check subscription status
    const billingCheck = await authenticate.admin(request).then(({ billing }) => billing.check({
        plans: ["Growth"],
        isTest: true,
    })).catch(() => ({ hasActivePayment: false }));

    return json({
        usageCount: usage?.monthlyUsageCount || 0,
        cycleStart: usage?.billingCycleStart || new Date(),
        shop: session.shop,
        hasActivePayment: billingCheck.hasActivePayment,
        credits: usage?.credits || 0,
        subscriptionId: usage?.subscriptionId || ""
    });
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === 'cancel') {
        const subscriptions = await admin.graphql(
            `#graphql
            query {
                currentAppInstallation {
                    activeSubscriptions {
                        id
                    }
                }
            }`
        );
        const subJson = await subscriptions.json();
        const activeSubs = subJson.data.currentAppInstallation.activeSubscriptions;

        if (activeSubs.length > 0) {
            for (const sub of activeSubs) {
                await admin.graphql(
                    `#graphql
                    mutation AppSubscriptionCancel($id: ID!) {
                        appSubscriptionCancel(id: $id) {
                            userErrors {
                                field
                                message
                            }
                            appSubscription {
                                id
                                status
                            }
                        }
                    }`,
                    { variables: { id: sub.id } }
                );
            }
        }

        // Clear local DB too
        const { session } = await authenticate.admin(request);
        await prisma.usageStat.update({
            where: { shop: session.shop },
            data: { subscriptionId: null, planStatus: 'CANCELLED' }
        });

        return json({ status: 'cancelled' });
    }

    // Default intent: subscribe
    try {
        const response = await admin.graphql(
            `#graphql
            mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
              appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: true, lineItems: $lineItems) {
                userErrors {
                  field
                  message
                }
                confirmationUrl
                appSubscription {
                  id
                }
              }
            }`,
            {
                variables: {
                    name: "Growth",
                    returnUrl: `https://${new URL(request.url).hostname}/app/plans?shop=${new URL(request.url).searchParams.get("shop")}&host=${new URL(request.url).searchParams.get("host")}`,
                    lineItems: [
                        {
                            plan: {
                                appRecurringPricingDetails: {
                                    price: { amount: 0.0, currencyCode: "USD" }
                                }
                            }
                        },
                        {
                            plan: {
                                appUsagePricingDetails: {
                                    terms: "30 free credits included on first install (one-time), then $0.015 per generation.",
                                    cappedAmount: { amount: 20.0, currencyCode: "USD" }
                                }
                            }
                        }
                    ]
                }
            }
        );

        const responseJson = await response.json();
        const confirmationUrl = responseJson.data.appSubscriptionCreate.confirmationUrl;
        const userErrors = responseJson.data.appSubscriptionCreate.userErrors;

        if (responseJson.data.appSubscriptionCreate.appSubscription) {
            const subId = responseJson.data.appSubscriptionCreate.appSubscription.id;
            console.log("Saving Subscription ID:", subId);
            const { session: sessionForSave } = await authenticate.admin(request);
            const saved = await prisma.usageStat.upsert({
                where: { shop: sessionForSave.shop },
                create: { shop: sessionForSave.shop, subscriptionId: subId },
                update: { subscriptionId: subId }
            });
            console.log("Saved Subscription Record:", saved);
        }

        if (userErrors && userErrors.length > 0) {
            console.error("Billing User Errors:", userErrors);
            if (userErrors.some(e => e.message.includes("public distribution"))) {
                return json({ error: "Billing API blocked: App is not set to Public Distribution." });
            }
            return json({ error: userErrors.map(e => e.message).join(", ") });
        }

        return json({ confirmationUrl });

    } catch (error) {
        console.error("Billing Exception:", error);
        if (error.message && error.message.includes("public distribution")) {
            return json({ error: "Billing API unavailable: App must have Public Distribution in Partner Dashboard." });
        }
        return json({ error: error.message });
    }
};


export default function Plans() {
    const { usageCount, cycleStart, hasActivePayment, credits, subscriptionId } = useLoaderData();
    const actionData = useActionData();
    const submit = useSubmit();

    useEffect(() => {
        if (actionData?.confirmationUrl) {
            // Break out of the iframe
            window.top.location.href = actionData.confirmationUrl;
        }
    }, [actionData]);

    const freeLimit = 30;
    const isFreeTier = usageCount <= freeLimit;
    const percentUsed = Math.min((usageCount / freeLimit) * 100, 100);

    // Calculate potential cost
    const billableCount = Math.max(0, usageCount - freeLimit);
    const estimatedCost = (billableCount * 0.015).toFixed(3);

    const formattedDate = new Date(cycleStart).toLocaleDateString();

    const [showPaidBanner, setShowPaidBanner] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('hidePaidBanner') !== 'true';
        }
        return true;
    });

    const [showCreditsBanner, setShowCreditsBanner] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('hideCreditsBanner') !== 'true';
        }
        return true;
    });

    const handleDismissPaidBanner = () => {
        setShowPaidBanner(false);
        localStorage.setItem('hidePaidBanner', 'true');
    };

    const handleDismissCreditsBanner = () => {
        setShowCreditsBanner(false);
        localStorage.setItem('hideCreditsBanner', 'true');
    };

    return (
        <Page>
            <TitleBar title="Plans & Billing" />
            <Layout>
                <Layout.Section>
                    <BlockStack gap="500">

                        {credits > 0 ? (
                            showCreditsBanner && (
                                <Banner title="You have Free Credits" tone="success" onDismiss={handleDismissCreditsBanner}>
                                    <p>You have {credits} free generation credits remaining.</p>
                                </Banner>
                            )
                        ) : (
                            showPaidBanner && (
                                <Banner title="Pay-as-you-go Active" tone="info" onDismiss={handleDismissPaidBanner}>
                                    <p>You have used all your free credits. Additional usage is charged at $0.015 per generation.</p>
                                </Banner>
                            )
                        )}

                        <Card>
                            <BlockStack gap="500">
                                <Text variant="headingMd" as="h2">Usage Statistics</Text>

                                <InlineGrid columns={2} gap="400">
                                    <Box>
                                        <BlockStack gap="100">
                                            <Text variant="headingSm">Total Generated</Text>
                                            <Text variant="headingLg">{usageCount}</Text>
                                        </BlockStack>
                                    </Box>
                                    <Box>
                                        <BlockStack gap="100">
                                            <Text variant="headingSm">Billable Items</Text>
                                            <Text variant="headingLg">{billableCount}</Text>
                                        </BlockStack>
                                    </Box>
                                </InlineGrid>

                                <Divider />

                                <Box>
                                    <BlockStack gap="100">
                                        <Text variant="headingSm">Estimated Cost (Current Cycle)</Text>
                                        <Text variant="headingLg">${estimatedCost}</Text>
                                        <Text variant="bodySm" tone="subdued">Charges appy only after credits are exhausted.</Text>
                                    </BlockStack>
                                </Box>
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <Text variant="headingMd">Plan Details: Growth</Text>
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text>Credits Available:</Text>
                                    <Text variant="headingLg">{credits}</Text>
                                </InlineStack>
                                <Divider />
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text variant="headingMd">Subscription Status</Text>
                                    {hasActivePayment ? (
                                        <Banner tone="success">
                                            <p>Plan Active</p>
                                        </Banner>
                                    ) : (
                                        <Banner tone="warning">
                                            <p>Plan Not Active</p>
                                        </Banner>
                                    )}
                                </InlineStack>

                                <BlockStack gap="200">
                                    <Text as="p"><strong>Monthly Fee:</strong> $0.00</Text>
                                    <Text as="p"><strong>Included:</strong> 30 Free Credits (Lifetime One-time)</Text>
                                    <Text as="p"><strong>Usage Rate:</strong> $0.015 per generation after credits</Text>
                                </BlockStack>

                                <Divider />

                                <BlockStack gap="200">
                                    <Text variant="headingSm">Payment Method</Text>
                                    <Text as="p" tone="subdued">
                                        Charges are added to your monthly Shopify Invoice. You do not need to enter a credit card here.
                                    </Text>
                                </BlockStack>

                                <Button variant="primary" onClick={() => submit({}, { method: "post" })}>
                                    Activate / Update Plan
                                </Button>

                                {actionData?.error && (
                                    <Banner tone="critical">
                                        <p>{actionData.error}</p>
                                    </Banner>
                                )}
                            </BlockStack>
                        </Card>
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
