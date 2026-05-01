import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Box, Grid, List, Badge, ProgressBar } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SearchIcon, MagicIcon, CheckCircleIcon, StarIcon } from "@shopify/polaris-icons";
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

export default function Dashboard() {
  const { descriptionsGenerated, seoGenerated, planName, usageCount } = useLoaderData() || {};
  const navigate = useNavigate();

  const currentPlanConfig = PLAN_CONFIG[planName] || PLAN_CONFIG[FREE_PLAN];
  const totalCredits = currentPlanConfig.credits;
  const progress = totalCredits === 999999 ? 100 : Math.min(100, (usageCount / totalCredits) * 100);

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
      <BlockStack gap="800">

        {/* Welcome Section */}
        <Box padding="400" background="bg-surface-active" borderRadius="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="200">
              <Text as="h1" variant="headingLg">Welcome to CopySpark AI</Text>
              <Text as="p" variant="bodyMd">
                Supercharge your store with AI-powered product descriptions and SEO optimization.
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
                    <ProgressBar progress={progress} tone={progress > 90 ? "critical" : "primary"} />
                  </BlockStack>
                </BlockStack>
                <Button size="slim" onClick={() => navigate("/app/plans")}>Upgrade for more</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="400" align="start" blockAlign="center">
                      <Box background="bg-surface-success" padding="200" borderRadius="200">
                        <MagicIcon width={30} />
                      </Box>
                      <Text as="h2" variant="headingMd">Descriptions</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Generate high-converting product descriptions in bulk.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/descriptions")} variant="primary" size="slim">Open</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="400" align="start" blockAlign="center">
                      <Box background="bg-surface-info" padding="200" borderRadius="200">
                        <SearchIcon width={30} />
                      </Box>
                      <Text as="h2" variant="headingMd">SEO tags</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Optimized titles and meta descriptions for search.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/seo")} variant="primary" size="slim">Open</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="400" align="start" blockAlign="center">
                      <Box background="bg-surface-warning" padding="200" borderRadius="200">
                        <CheckCircleIcon width={30} />
                      </Box>
                      <Text as="h2" variant="headingMd">SEO Audit</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Scan your store and generate PDF health reports.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/audit")} variant="primary" size="slim">Run</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Total Lifetime Impact</Text>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="p">{descriptionsGenerated || 0}</Text>
                      <Text variant="bodySm" tone="subdued">AI Descriptions</Text>
                    </BlockStack>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="p">{seoGenerated || 0}</Text>
                      <Text variant="bodySm" tone="subdued">SEO Optimizations</Text>
                    </BlockStack>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
