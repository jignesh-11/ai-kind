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
  Badge, 
  ProgressBar, 
  Icon, 
  Divider,
  InlineGrid,
  Banner
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { 
  SearchIcon, 
  MagicIcon, 
  CheckCircleIcon, 
  StarIcon, 
  ImageIcon,
  ChevronRightIcon
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

function FeatureItem({ title, description, icon, onAction, isPro }) {
  return (
    <Box 
      as="div" 
      padding="400" 
      onClick={onAction}
      style={{ cursor: 'pointer', borderBottom: '1px solid var(--p-color-border-subdued)' }}
    >
      <InlineStack gap="400" align="space-between" blockAlign="center">
        <InlineStack gap="400" blockAlign="center">
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <Icon source={icon} tone="base" />
          </Box>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text variant="headingMd" as="h3">{title}</Text>
              {isPro && <Badge tone="warning">PRO</Badge>}
            </InlineStack>
            <Text variant="bodyMd" tone="subdued">{description}</Text>
          </BlockStack>
        </InlineStack>
        <Icon source={ChevronRightIcon} tone="subdued" />
      </InlineStack>
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
      <TitleBar title="CopySpark AI Home" />
      <BlockStack gap="600">
        
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text variant="heading2xl" as="h1">Dashboard</Text>
            <Text variant="bodyLg" tone="subdued">Optimize your store's SEO and content with AI.</Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/plans")} icon={StarIcon} variant="primary">
            {isFree ? "Upgrade Plan" : "Manage Plan"}
          </Button>
        </InlineStack>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodyMd" tone="subdued">AI Descriptions</Text>
              <Text variant="headingXl" as="p">{descriptionsGenerated}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodyMd" tone="subdued">SEO Optimizations</Text>
              <Text variant="headingXl" as="p">{seoGenerated}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="bodyMd" tone="subdued">Usage Limit</Text>
                <Badge tone="info">{planName}</Badge>
              </InlineStack>
              <BlockStack gap="200">
                <Text variant="headingLg" as="p">
                  {usageCount} <Text variant="bodyMd" as="span" tone="subdued">/ {totalCredits === 999999 ? "∞" : totalCredits}</Text>
                </Text>
                <ProgressBar progress={progress} tone={progress > 85 ? "critical" : "primary"} size="small" />
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack>
                <FeatureItem 
                  title="Product Descriptions"
                  description="Rewrite descriptions with high-converting AI prompts."
                  icon={MagicIcon}
                  onAction={() => navigate("/app/descriptions")}
                />
                <FeatureItem 
                  title="SEO Meta Tags"
                  description="Generate optimized titles and descriptions for search."
                  icon={SearchIcon}
                  onAction={() => navigate("/app/seo")}
                />
                <FeatureItem 
                  title="Site-Wide SEO Audit"
                  description="Scan your store and download health reports."
                  icon={CheckCircleIcon}
                  isPro={isFree}
                  onAction={() => navigate("/app/audit")}
                />
                <FeatureItem 
                  title="Image Alt Text"
                  description="Improve rankings with AI image alt text."
                  icon={ImageIcon}
                  isPro={isFree}
                  onAction={() => navigate("/app/products")}
                  style={{ borderBottom: 'none' }}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {isFree && (
                <Banner title="Early Bird Special" tone="info" action={{content: 'Upgrade', onAction: () => navigate("/app/plans")}}>
                  <p>Unlock all features with 50% off Pro!</p>
                </Banner>
              )}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h3">Support</Text>
                  <Text variant="bodyMd" tone="subdued">Need help? Our AI experts are available 24/7.</Text>
                  <Button variant="secondary" onClick={() => window.open('mailto:support@copyspark.ai')}>Email Us</Button>
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
