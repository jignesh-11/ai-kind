import { useEffect } from "react";
import { 
  Page, 
  Layout, 
  Card, 
  Text, 
  BlockStack, 
  InlineStack, 
  Button, 
  Box, 
  Grid, 
  Badge, 
  ProgressBar, 
  Icon, 
  Divider,
  Banner
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { 
  SearchIcon, 
  MagicIcon, 
  CheckCircleIcon, 
  StarIcon, 
  ImageIcon 
} from "@shopify/polaris-icons";
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

function ToolCard({ title, description, icon, onAction, isPro }) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300">
            <Icon source={icon} tone="base" />
            <Text variant="headingMd" as="h3">{title}</Text>
          </InlineStack>
          {isPro && <Badge tone="warning">PRO</Badge>}
        </InlineStack>
        <div style={{ minHeight: '40px' }}>
          <Text variant="bodyMd" tone="subdued">{description}</Text>
        </div>
        <InlineStack align="end">
          <Button onClick={onAction} variant="primary" size="slim">Get Started</Button>
        </InlineStack>
      </BlockStack>
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
    <Page title="Dashboard">
      <TitleBar title="CopySpark AI" />
      <BlockStack gap="600">
        
        {isFree && (
          <Banner
            title="Early Bird Offer: 50% Off Pro Plan"
            tone="info"
            action={{
              content: 'View Plans',
              onAction: () => navigate("/app/plans"),
            }}
          >
            <p>Upgrade now to unlock Image Alt Text generation and SEO Health Audit reports.</p>
          </Banner>
        )}

        <Layout>
          {/* Optimization Tools */}
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h2">Optimization Tools</Text>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <ToolCard 
                    title="Descriptions"
                    description="Rewrite product descriptions with high-converting AI prompts."
                    icon={MagicIcon}
                    onAction={() => navigate("/app/descriptions")}
                  />
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <ToolCard 
                    title="SEO Tags"
                    description="Generate optimized titles and meta tags for search rankings."
                    icon={SearchIcon}
                    onAction={() => navigate("/app/seo")}
                  />
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <ToolCard 
                    title="SEO Audit"
                    description="Scan your entire store for missing SEO tags and health issues."
                    icon={CheckCircleIcon}
                    onAction={() => navigate("/app/audit")}
                    isPro={isFree}
                  />
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                  <ToolCard 
                    title="Alt Text"
                    description="Auto-generate SEO alt text for your product images."
                    icon={ImageIcon}
                    onAction={() => navigate("/app/products")}
                    isPro={isFree}
                  />
                </Grid.Cell>
              </Grid>
            </BlockStack>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">Account Status</Text>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Current Plan</Text>
                      <Badge tone="info">{planName}</Badge>
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Usage (Monthly)</Text>
                        <Text variant="bodySm" fontWeight="bold">
                          {usageCount} / {totalCredits === 999999 ? "∞" : totalCredits}
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={progress} tone={progress > 90 ? "critical" : "primary"} size="small" />
                    </BlockStack>
                  </BlockStack>
                  <Button fullWidth onClick={() => navigate("/app/plans")}>Manage Subscription</Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">Lifetime Impact</Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" tone="subdued">AI Descriptions</Text>
                      <Text variant="bodyMd" fontWeight="bold">{descriptionsGenerated}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" tone="subdued">SEO Tags</Text>
                      <Text variant="bodyMd" fontWeight="bold">{seoGenerated}</Text>
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
