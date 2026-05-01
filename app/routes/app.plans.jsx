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
    Badge,
} from "@shopify/polaris";
import { CheckIcon, StarIcon, StarFilledIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { FREE_PLAN, PRO_PLAN, ELITE_PLAN, PLAN_CONFIG } from "../constants";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { session, billing, admin } = await authenticate.admin(request);

    const shopResponse = await admin.graphql(
        `#graphql
        query {
          shop {
            email
          }
        }`
    );
    const shopData = await shopResponse.json();
    const shopEmail = shopData.data?.shop?.email;

    const isTest = process.env.NODE_ENV !== 'production' || shopEmail === 'jigneshdhandhukiya63@gmail.com';

    const billingCheck = await billing.check({
        plans: [PRO_PLAN, ELITE_PLAN],
        isTest: isTest,
    });

    let usage = await prisma.usageStat.findUnique({
        where: { shop: session.shop }
    });

    // Proactive Sync: If Shopify has an active payment but our DB doesn't match, update DB
    if (billingCheck.hasActivePayment) {
        const activeSubscription = billingCheck.appSubscriptions[0];
        if (usage && usage.planName !== activeSubscription.name) {
            console.log(`[Billing Sync] Updating ${session.shop} to ${activeSubscription.name}`);
            usage = await prisma.usageStat.update({
                where: { shop: session.shop },
                data: { 
                    planName: activeSubscription.name,
                    planStatus: 'ACTIVE',
                    credits: Math.max(usage.credits, PLAN_CONFIG[activeSubscription.name].credits)
                }
            });
        }
    }

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

    const shopResponse = await admin.graphql(
        `#graphql
        query {
          shop {
            email
          }
        }`
    );
    const shopData = await shopResponse.json();
    const shopEmail = shopData.data?.shop?.email;

    const isTest = process.env.NODE_ENV !== 'production' || shopEmail === 'jigneshdhandhukiya63@gmail.com';

    if (planName === FREE_PLAN) {
        const billingCheck = await billing.check({
            plans: [PRO_PLAN, ELITE_PLAN],
            isTest: isTest,
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
        const shopName = session.shop.replace(".myshopify.com", "");
        const appHandle = "copyspark-ai-seo-description";
        const returnUrl = `https://admin.shopify.com/store/${shopName}/apps/${appHandle}/app/plans`;

        return await billing.request({
            plan: planName,
            isTest: isTest,
            returnUrl: returnUrl,
        });
    }

    return json({ error: "Invalid plan" }, { status: 400 });
};

function PlanCard({ name, price, credits, features, isCurrent, onSelect, loading, isPopular }) {
    return (
        <Box 
            style={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column' 
            }}
        >
            <Card background={isPopular ? "bg-surface-info-subdued" : "bg-surface"}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '420px' }}>
                    <BlockStack gap="400">
                        <BlockStack gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text variant="headingMd" as="h3">{name}</Text>
                                {isPopular && (
                                    <Badge tone="info" icon={StarFilledIcon}>Best Value</Badge>
                                )}
                                {!isPopular && name !== FREE_PLAN && (
                                    <Badge tone="warning" icon={StarIcon}>Special</Badge>
                                )}
                            </InlineStack>
                            <Text variant="heading2xl" as="p">
                                ${price}
                                <Text variant="bodySm" as="span" tone="subdued">/month</Text>
                            </Text>
                        </BlockStack>
                        
                        <Divider />
                        
                        <BlockStack gap="300">
                            <Text variant="bodyMd" fontWeight="bold">
                                {credits === 999999 ? 'Unlimited' : credits} AI Credits
                            </Text>
                            <BlockStack gap="200">
                                {features.map((feature, index) => (
                                    <InlineStack gap="200" key={index} align="start" blockAlign="start">
                                        <div style={{ marginTop: '2px' }}>
                                            <Icon source={CheckIcon} tone="success" />
                                        </div>
                                        <Text variant="bodySm" as="span">{feature}</Text>
                                    </InlineStack>
                                ))}
                            </BlockStack>
                        </BlockStack>
                    </BlockStack>

                    <div style={{ flex: 1 }} />
                    
                    <Box paddingBlockStart="600">
                        <Button
                            variant={isCurrent ? "secondary" : (isPopular ? "primary" : "secondary")}
                            disabled={isCurrent}
                            loading={loading}
                            onClick={() => onSelect(name)}
                            fullWidth
                        >
                            {isCurrent ? "Current Plan" : (name === FREE_PLAN ? "Stay on Free" : "Upgrade Now")}
                        </Button>
                    </Box>
                </div>
            </Card>
        </Box>
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

    const isSubmitting = navigation.state === "submitting";
    const submittingPlan = navigation.formData?.get("planName");

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
                                <Text as="p">You have used <strong>{usageCount}</strong> credits in your current billing cycle.</Text>
                            </BlockStack>
                        </Card>

                        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                            <PlanCard
                                name={FREE_PLAN}
                                price="0"
                                credits={PLAN_CONFIG[FREE_PLAN].credits}
                                features={["20 AI Generations", "Product Descriptions", "SEO Meta Tags", "Basic Support"]}
                                isCurrent={currentPlan === FREE_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isSubmitting && submittingPlan === FREE_PLAN}
                            />
                            <PlanCard
                                name={PRO_PLAN}
                                price="9.99"
                                credits={PLAN_CONFIG[PRO_PLAN].credits}
                                features={["500 AI Generations", "Image Alt Text Generation", "SEO Health Audit PDFs", "Brand Voice Profiles"]}
                                isCurrent={currentPlan === PRO_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isSubmitting && submittingPlan === PRO_PLAN}
                            />
                            <PlanCard
                                name={ELITE_PLAN}
                                price="24.99"
                                credits={PLAN_CONFIG[ELITE_PLAN].credits}
                                features={["Unlimited AI Generations", "Bulk Optimization Mode", "Priority 24/7 Support", "Early Feature Access"]}
                                isCurrent={currentPlan === ELITE_PLAN}
                                onSelect={handleSelectPlan}
                                loading={isSubmitting && submittingPlan === ELITE_PLAN}
                                isPopular
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
