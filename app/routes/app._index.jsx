import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Box, Grid, Badge, ProgressBar, Icon } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SearchIcon, MagicIcon, CheckCircleIcon, StarIcon, ImageIcon } from "@shopify/polaris-icons";
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

function FeatureCard({ title, description, icon: IconSource, iconTone, onAction, isPro, badgeText }) {
  return (
    <Card height="100%">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '180px' }}>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="400" align="start" blockAlign="center">
              <Box background={iconTone} padding="200" borderRadius="200">
                <IconSource width={24} />
              </Box>
              <Text as="h2" variant="headingMd">{title}</Text>
            </InlineStack>
            {isPro && <Badge tone="warning">PRO</Badge>}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        </BlockStack>
        <div style={{ flex: 1 }} />
        <Box paddingBlockStart="400">
          <InlineStack align="end">
            <Button onClick={onAction} variant="primary" size="slim">Open</Button>
          </InlineStack>
        </Box>
      </div>
    </Card>
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
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">

        {/* Welcome Section */}
        <Box padding="400" background="bg-surface-active" borderRadius="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="200">
              <Text as="h1" variant="headingLg">Welcome to CopySpark AI</Text>
              <Text as="p" variant="bodyMd">
                Optimizing your store's SEO and content with Gemini AI.
              </Text>
            </BlockStack>
            <Button onClick={() => navigate("/app/plans")} variant="secondary" icon={StarIcon}>
              Manage Plan
            </Button>
          </InlineStack>
        </Box>

        <Layout>
          {/* Account Summary */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Account Summary</Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Current Plan</Text>
                      <Badge tone="info">{planName}</Badge>
                    </InlineStack>
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Monthly Credits</Text>
                        <Text variant="bodySm" fontWeight="bold">
                          {usageCount} / {totalCredits === 999999 ? "Unlimited" : totalCredits}
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={progress} tone={progress > 90 ? "critical" : "primary"} size="small" />
                    </BlockStack>
                  </BlockStack>
                  <Button size="slim" onClick={() => navigate("/app/plans")} fullWidth>Upgrade for more</Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Lifetime Impact</Text>
                  <InlineStack gap="400" align="space-between">
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="p">{descriptionsGenerated}</Text>
                      <Text variant="bodySm" tone="subdued">AI Descriptions</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="p">{seoGenerated}</Text>
                      <Text variant="bodySm" tone="subdued">SEO Optimizations</Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* Feature Grid */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <FeatureCard 
                  title="Descriptions"
                  description="Generate high-converting product descriptions in bulk."
                  icon={MagicIcon}
                  iconTone="bg-surface-success"
                  onAction={() => navigate("/app/descriptions")}
                />
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <FeatureCard 
                  title="SEO tags"
                  description="Optimized titles and meta descriptions for search engines."
                  icon={SearchIcon}
                  iconTone="bg-surface-info"
                  onAction={() => navigate("/app/seo")}
                />
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <FeatureCard 
                  title="SEO Audit"
                  description="Scan your store and generate PDF health reports."
                  icon={CheckCircleIcon}
                  iconTone="bg-surface-warning"
                  onAction={() => navigate("/app/audit")}
                  isPro={isFree}
                />
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                <FeatureCard 
                  title="Alt Text"
                  description="Improve accessibility and ranking with AI image alt text."
                  icon={ImageIcon}
                  iconTone="bg-surface-critical"
                  onAction={() => navigate("/app/products")}
                  isPro={isFree}
                />
              </Grid.Cell>
            </Grid>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
