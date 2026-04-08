import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Box, Grid, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SearchIcon, MagicIcon, CheckCircleIcon } from "@shopify/polaris-icons";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { initializeFreeCredits } from "../init-credits.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await initializeFreeCredits(session.shop);

  if (!prisma || !prisma.usageStat) {
    return json({ descriptionsGenerated: 0, seoGenerated: 0 });
  }

  const stats = await prisma.usageStat.findUnique({ where: { shop: session.shop } });

  return json({
    descriptionsGenerated: stats?.descriptionsGenerated || 0,
    seoGenerated:          stats?.seoGenerated          || 0,
  });
};

export default function Dashboard() {
  const { descriptionsGenerated, seoGenerated } = useLoaderData() || {};
  const navigate = useNavigate();

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
          <BlockStack gap="200">
            <Text as="h1" variant="headingLg">Welcome to CopySpark</Text>
            <Text as="p" variant="bodyMd">
              Supercharge your store with AI-powered product descriptions and SEO optimization.
            </Text>
          </BlockStack>
        </Box>

        <Layout>
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="400" align="start" blockAlign="center">
                      <Box background="bg-surface-success" padding="200" borderRadius="200">
                        <MagicIcon width={30} />
                      </Box>
                      <Text as="h2" variant="headingMd">Product Descriptions</Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Generate and rewrite product descriptions in bulk. Supports multiple tones and 9 languages.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/descriptions")} variant="primary">Open Tool</Button>
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
                      <Text as="h2" variant="headingMd">SEO Generator</Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Generate SEO titles and meta descriptions. Live SERP preview and version history included.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/seo")} variant="primary">Open Tool</Button>
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
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Scan all products for SEO issues. Get a store-wide health score and per-product breakdown.
                    </Text>
                    <InlineStack align="end">
                      <Button onClick={() => navigate("/app/audit")} variant="primary">Run Audit</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Key Features</Text>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <List>
                      <List.Item>Generate descriptions from scratch or rewrite existing ones</List.Item>
                      <List.Item>Bulk generation for efficient catalog updates</List.Item>
                      <List.Item>Version history with one-click restore</List.Item>
                      <List.Item>Support for 9 languages</List.Item>
                    </List>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <List>
                      <List.Item>Live Google SERP preview for SEO tags</List.Item>
                      <List.Item>Character count validation with visual indicators</List.Item>
                      <List.Item>Store-wide SEO health audit with scores</List.Item>
                      <List.Item>Brand voice and product context aware generation</List.Item>
                    </List>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Stats</Text>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <BlockStack gap="200">
                      <Text variant="headingxl" as="p">{descriptionsGenerated || 0}</Text>
                      <Text variant="bodySm" tone="subdued">Descriptions Generated</Text>
                    </BlockStack>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <BlockStack gap="200">
                      <Text variant="headingxl" as="p">{seoGenerated || 0}</Text>
                      <Text variant="bodySm" tone="subdued">SEO Tags Optimized</Text>
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
