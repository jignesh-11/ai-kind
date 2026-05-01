import { json } from "@remix-run/node";
import { useEffect, useState } from "react";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    InlineGrid,
    Box,
    Divider,
    InlineStack,
    Icon,
    Banner,
    List,
    Badge,
} from "@shopify/polaris";
import { CheckIcon, StarIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, FREE_PLAN, PRO_PLAN, ELITE_PLAN } from "../shopify.server";
import { PLAN_CONFIG } from "../billing.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { session, billing } = await authenticate.admin(request);

    const usage = await prisma.usageStat.findUnique({
        where: { shop: session.shop }
    });

    const isDevelopmentStore = session.shop.includes('.myshopify.com');

    const billingCheck = await billing.check({
        plans: [PRO_PLAN, ELITE_PLAN],
        isTest: isDevelopmentStore,
    });

    return json({
        usageCount: usage?.monthlyUsageCount || 0,
        currentPlan: usage?.planName || FREE_PLAN,
        hasActivePayment: billingCheck.hasActivePayment,
        credits: usage?.credits || 0,
        activeSubscriptions: billingCheck.appSubscriptions
    });
};

export const action = async ({ request }) => {
    const { admin, billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const planName = formData.get("planName");
    const isDevelopmentStore = session.shop.includes('.myshopify.com');

    if (planName === FREE_PLAN) {
        // Cancel existing subscriptions if any
        const billingCheck = await billing.check({
            plans: [PRO_PLAN, ELITE_PLAN],
            isTest: isDevelopmentStore,
        });

        if (billingCheck.hasActivePayment) {
            for (const sub of billingCheck.appSubscriptions) {
                await admin.graphql(
                    `#graphql
                    mutation AppSubscriptionCancel($id: ID!) {
                        appSubscriptionCancel(id: $id) {
                            userErrors { field message }
                        }
                    }`,
                    { variables: { id: sub.id } }
                );
            }
        }

        await prisma.usageStat.update({
            where: { shop: session.shop },
            data: { planName: FREE_PLAN, planStatus: 'ACTIVE' }
        });

        return json({ status: 'success' });
    }

    if (planName === PRO_PLAN || planName === ELITE_PLAN) {
        return await billing.request({
            plan: planName,
            isTest: isDevelopmentStore,
            returnUrl: `https://${new URL(request.url).hostname}/app/plans?shop=${session.shop}`,
        });
    }

    return json({ error: "Invalid plan" }, { status: 400 });
};

function PlanCard({ name, price, credits, features, isCurrent, onSelect, loading, isSpecial }) {
    return (
        <Card background={isCurrent ? "bg-surface-secondary" : "bg-surface"}>
            <BlockStack gap="400">
                <BlockStack gap="100">
                    <InlineStack align="space-between">
                        <Text variant="headingMd" as="h3">{name}</Text>
                        {isSpecial && <Badge tone="warning" icon={StarIcon}>Launch Special</Badge>}
                    </InlineStack>
                    <Text variant="headingLg" as="p">${price}<Text variant="bodySm" as="span" tone="subdued">/mo</Text></Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="bold">{credits === 999999 ? 'Unlimited' : credits} Credits</Text>
                    <List>
                        {features.map((feature, index) => (
                            <List.Item key={index}>
                                <InlineStack gap="200">
                                    <Icon source={CheckIcon} tone="success" />
                                    <Text variant="bodySm">{feature}</Text>
                                </InlineStack>
                            </List.Item>
                        ))}
                    </List>
                </BlockStack>
                <Button
                    variant={isCurrent ? "secondary" : "primary"}
                    disabled={isCurrent}
                    loading={loading}
                    onClick={() => onSelect(name)}
                >
                    {isCurrent ? "Current Plan" : "Select Plan"}
                </Button>
            </BlockStack>
        </Card>
    );
}

export default function Plans() {
    const { usageCount, currentPlan } = useLoaderData();
    const submit = useSubmit();
    const actionData = useActionData();
    const navigation = useNavigation();

    const handleSelectPlan = (planName) => {
        submit({ planName }, { method: "post" });
    };

    const isLoading = navigation.state === "submitting";

    return (
        <Page>
            <TitleBar title="Plans & Billing" />
            <Layout>
                <Layout.Section>
                    <BlockStack gap="600">
                        <Banner tone="info" title="Launch Phase: Special Early Bird Pricing!">
                            <p>We are currently in our early launch phase. Enjoy discounted pricing and increased free credits while we gather feedback and improve the app!</p>
                        </Banner>

                        <Card>
                            <BlockStack gap="200">
                                <Text variant="headingMd" as="h2">Monthly Usage</Text>
                                <Text as="p">You have used {usageCount} credits in your current billing cycle.</Text>
                            </BlockStack>
                        </Card>

                        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                            <PlanCard
                                name={FREE_PLAN}
                                price="0"
                                credits={PLAN_CONFIG[FREE_PLAN].credits}
                                features={["Product Descriptions", "SEO Meta Tags"]}
                                isCurrent={currentPlan === FREE_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isLoading}
                            />
                            <PlanCard
                                name={PRO_PLAN}
                                price="9.99"
                                credits={PLAN_CONFIG[PRO_PLAN].credits}
                                features={["Everything in Free", "Image Alt Text", "SEO Audit PDFs", "Brand Voice"]}
                                isCurrent={currentPlan === PRO_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isLoading}
                                isSpecial
                            />
                            <PlanCard
                                name={ELITE_PLAN}
                                price="24.99"
                                credits={PLAN_CONFIG[ELITE_PLAN].credits}
                                features={["Everything in Pro", "Bulk Optimization", "Priority Support", "Unlimited AI"]}
                                isCurrent={currentPlan === ELITE_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isLoading}
                                isSpecial
                            />
                        </InlineGrid>

                        {actionData?.error && (
                            <Banner tone="critical">
                                <p>{actionData.error}</p>
                            </Banner>
                        )}
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
