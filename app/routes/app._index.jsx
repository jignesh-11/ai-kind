import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Box, InlineGrid, Badge, ProgressBar, Icon, Divider } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SearchIcon, MagicIcon, CheckCircleIcon, StarIcon, ImageIcon, ArrowRightIcon } from "@shopify/polaris-icons";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { initializeFreeCredits } from "../init-credits.server";
import { FREE_PLAN, PLAN_CONFIG } from "../constants";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await initializeFreeCredits(session.shop);

  const stats = await prisma.usageStat.findUnique({ where: { shop: session.shop } });

  return json({
    descriptionsGenerated: stats?.descriptionsGenerated || 0,
    seoGenerated:          stats?.seoGenerated          || 0,
    planName:              stats?.planName              || FREE_PLAN,
    usageCount:            stats?.monthlyUsageCount     || 0,
  });
};

function StatBox({ label, value, icon: IconSource, tone }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300" style={{ flex: 1 }}>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="bodySm" tone="subdued">{label}</Text>
          <Icon source={IconSource} tone={tone} />
        </InlineStack>
        <Text variant="headingLg" as="p">{value}</Text>
      </BlockStack>
    </Box>
  );
}

function FeatureCard({ title, description, icon: IconSource, iconBg, onAction, isPro }) {
  return (
    <Box 
        as="div" 
        onClick={onAction}
        style={{ cursor: 'pointer', height: '100%' }}
    >
        <Card height="100%">
            <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                    <Box 
                        background={iconBg} 
                        padding="200" 
                        borderRadius="300"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Icon source={IconSource} width="24" />
                    </Box>
                    {isPro && <Badge tone="warning">PRO</Badge>}
                </InlineStack>
                
                <BlockStack gap="100">
                    <Text variant="headingMd" as="h3">{title}</Text>
                    <Text variant="bodySm" tone="subdued">{description}</Text>
                </BlockStack>

                <InlineStack align="end">
                    <Button variant="tertiary" icon={ArrowRightIcon} onClick={onAction}>
                        Explore
                    </Button>
                </InlineStack>
            </BlockStack>
        </Card>
    </Box>
  );
}

export default function Dashboard() {
  const { descriptionsGenerated, seoGenerated, planName, usageCount } = useLoaderData() || {};
  const navigate = useNavigate();

  const isFree = planName === FREE_PLAN;
  const currentPlanConfig = PLAN_CONFIG[planName] || PLAN_CONFIG[FREE_PLAN];
  const totalCredits = currentPlanConfig.credits;
  const progress = totalCredits === 999999 ? 100 : Math.min(100, (usageCount / (totalCredits || 1)) * 100);

  useEffect(() => {
    const pingBackend = async () => {
      try {
        if (window.shopify?.idToken) {
          const token = await window.shopify.idToken();
          await fetch("/app/api/ping", { headers: { Authorization: `Bearer ${token}` } });
        }
      } catch (err) {
        console.warn("[Auth Check] Failed:", err);
      }
    };
    pingBackend();
  }, []);

  return (
    <Page>
      <TitleBar title="CopySpark Dashboard" />
      <BlockStack gap="600">
        
        {/* Modern Hero / Welcome */}
        <Box 
            padding="600" 
            background="bg-surface-active" 
            borderRadius="400" 
            style={{ 
                border: '1px solid var(--p-color-border-subdued)',
                backgroundImage: 'linear-gradient(to right, var(--p-color-bg-surface-active), var(--p-color-bg-surface-info-subdued))'
            }}
        >
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl">Supercharge your SEO</Text>
              <Text as="p" variant="bodyLg" tone="subdued">
                Generate high-converting content and optimize your store visibility with Gemini AI.
              </Text>
            </BlockStack>
            <Button size="large" onClick={() => navigate("/app/plans")} variant="primary" icon={StarIcon}>
              Upgrade to Pro
            </Button>
          </InlineStack>
        </Box>

        <Layout>
          {/* Main Controls */}
          <Layout.Section>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">AI Command Center</Text>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 2 }} gap="400">
                    <FeatureCard 
                        title="Descriptions"
                        description="Craft compelling product stories that sell."
                        icon={MagicIcon}
                        iconBg="bg-surface-success-subdued"
                        onAction={() => navigate("/app/descriptions")}
                    />
                    <FeatureCard 
                        title="SEO Meta Tags"
                        description="Auto-generate titles and meta for search."
                        icon={SearchIcon}
                        iconBg="bg-surface-info-subdued"
                        onAction={() => navigate("/app/seo")}
                    />
                    <FeatureCard 
                        title="SEO Audit"
                        description="Scan your entire store for health issues."
                        icon={CheckCircleIcon}
                        iconBg="bg-surface-caution-subdued"
                        onAction={() => navigate("/app/audit")}
                        isPro={isFree}
                    />
                    <FeatureCard 
                        title="Image Alt Text"
                        description="Improve accessibility and image ranking."
                        icon={ImageIcon}
                        iconBg="bg-surface-critical-subdued"
                        onAction={() => navigate("/app/products")}
                        isPro={isFree}
                    />
                </InlineGrid>
            </BlockStack>
          </Layout.Section>

          {/* Account & Progress Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
                <Card>
                    <BlockStack gap="400">
                        <Text variant="headingMd" as="h2">Usage & Plan</Text>
                        <BlockStack gap="300">
                            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                <InlineStack align="space-between">
                                    <Text variant="bodySm" fontWeight="medium">Active Plan</Text>
                                    <Badge tone="info">{planName}</Badge>
                                </InlineStack>
                            </Box>
                            
                            <BlockStack gap="200">
                                <InlineStack align="space-between">
                                    <Text variant="bodySm" tone="subdued">Monthly Credits</Text>
                                    <Text variant="bodySm" fontWeight="bold">
                                        {usageCount} / {totalCredits === 999999 ? "∞" : totalCredits}
                                    </Text>
                                </InlineStack>
                                <ProgressBar progress={progress} tone={progress > 90 ? "critical" : "primary"} size="small" />
                                {isFree && (
                                    <Text variant="bodyXs" tone="subdued">Credits reset in your next billing cycle.</Text>
                                )}
                            </BlockStack>
                        </BlockStack>
                        <Divider />
                        <Button fullWidth onClick={() => navigate("/app/plans")}>Manage Subscriptions</Button>
                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="400">
                        <Text variant="headingMd" as="h2">Lifetime Stats</Text>
                        <BlockStack gap="300">
                            <InlineStack gap="300" wrap={false}>
                                <StatBox label="Descriptions" value={descriptionsGenerated} icon={MagicIcon} tone="success" />
                                <StatBox label="SEO Tags" value={seoGenerated} icon={SearchIcon} tone="info" />
                            </InlineStack>
                        </BlockStack>
                    </BlockStack>
                </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <Box paddingBlockEnd="800" />
    </Page>
  );
}
