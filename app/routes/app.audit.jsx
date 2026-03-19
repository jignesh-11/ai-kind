import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge,
  Button, Box, IndexTable, Thumbnail, ProgressBar, Grid
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";

function auditProduct(product) {
  const issues = [];

  if (!product.seo?.title)
    issues.push({ msg: "Missing SEO title", severity: "high" });
  else if (product.seo.title.length > 60)
    issues.push({ msg: `SEO title too long (${product.seo.title.length}/60)`, severity: "medium" });

  if (!product.seo?.description)
    issues.push({ msg: "Missing meta description", severity: "high" });
  else if (product.seo.description.length > 160)
    issues.push({ msg: `Meta description too long (${product.seo.description.length}/160)`, severity: "medium" });

  if (!product.featuredImage?.altText)
    issues.push({ msg: "Featured image missing alt text", severity: "low" });

  const cleanDesc = (product.descriptionHtml || "").replace(/<[^>]*>/g, "").trim();
  if (cleanDesc.length < 20)
    issues.push({ msg: "Product description too short or missing", severity: "high" });
  else if (cleanDesc.length < 80)
    issues.push({ msg: "Product description is quite brief", severity: "medium" });

  const highCount   = issues.filter(i => i.severity === "high").length;
  const medCount    = issues.filter(i => i.severity === "medium").length;
  const score       = Math.max(0, 100 - highCount * 25 - medCount * 10 - issues.filter(i => i.severity === "low").length * 5);

  return { issues, score };
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProductsForAudit {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id title productType vendor
          descriptionHtml
          featuredImage { url altText }
          seo { title description }
        }
      }
    }`
  );
  const responseJson = await response.json();
  const products = responseJson.data.products.nodes;

  const audited = products.map(p => ({
    ...p,
    audit: auditProduct(p),
  }));

  const totalScore  = audited.length > 0 ? Math.round(audited.reduce((s, p) => s + p.audit.score, 0) / audited.length) : 0;
  const perfect     = audited.filter(p => p.audit.issues.length === 0).length;
  const hasIssues   = audited.filter(p => p.audit.issues.length > 0).length;
  const missingDesc = audited.filter(p => !(p.descriptionHtml || "").replace(/<[^>]*>/g, "").trim()).length;
  const missingSeo  = audited.filter(p => !p.seo?.title || !p.seo?.description).length;

  return json({ products: audited, totalScore, perfect, hasIssues, missingDesc, missingSeo });
};

export default function SeoAudit() {
  const { products, totalScore, perfect, hasIssues, missingDesc, missingSeo } = useLoaderData();
  const navigate = useNavigate();

  const scoreColor = totalScore >= 80 ? "success" : totalScore >= 50 ? "warning" : "critical";
  const scoreTone  = totalScore >= 80 ? "success" : totalScore >= 50 ? "caution" : "critical";

  return (
    <Page>
      <TitleBar title="SEO Health Audit" />
      <BlockStack gap="600">

        {/* ── Store Score ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Store SEO Health Score</Text>
            <InlineStack gap="600" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="heading2xl" as="p" tone={scoreTone}>{totalScore}</Text>
                <Text variant="bodySm" tone="subdued">out of 100</Text>
              </BlockStack>
              <Box style={{ flex: 1 }}>
                <ProgressBar progress={totalScore} tone={scoreColor} />
              </Box>
            </InlineStack>
            <Grid>
              {[
                { label: "Products audited", value: products.length, tone: "subdued" },
                { label: "Perfect score", value: perfect, tone: "success" },
                { label: "Need attention", value: hasIssues, tone: "caution" },
                { label: "Missing description", value: missingDesc, tone: "critical" },
                { label: "Missing SEO tags", value: missingSeo, tone: "critical" },
              ].map(stat => (
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 2, lg: 2, xl: 2 }} key={stat.label}>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="p" tone={stat.tone}>{stat.value}</Text>
                      <Text variant="bodySm" tone="subdued">{stat.label}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        {/* ── Products table ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Product Breakdown</Text>
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={products.length}
              headings={[
                { title: "Image" },
                { title: "Product" },
                { title: "Score" },
                { title: "Issues" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {products
                .sort((a, b) => a.audit.score - b.audit.score)
                .map((product, index) => (
                  <IndexTable.Row id={product.id} key={product.id} position={index}>
                    <IndexTable.Cell>
                      <Thumbnail source={product.featuredImage?.url || ""} alt={product.featuredImage?.altText || product.title} size="small" />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text fontWeight="bold" as="span">{product.title}</Text>
                      {product.productType && <Text as="p" variant="bodySm" tone="subdued">{product.productType}</Text>}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text fontWeight="bold" tone={product.audit.score >= 80 ? "success" : product.audit.score >= 50 ? "caution" : "critical"}>
                          {product.audit.score}
                        </Text>
                        <Text variant="bodySm" tone="subdued">/100</Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {product.audit.issues.length === 0 ? (
                        <Badge tone="success">All good</Badge>
                      ) : (
                        <BlockStack gap="100">
                          {product.audit.issues.map((issue, i) => (
                            <Badge key={i} tone={issue.severity === "high" ? "critical" : issue.severity === "medium" ? "warning" : "info"}>
                              {issue.msg}
                            </Badge>
                          ))}
                        </BlockStack>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200">
                        <Button size="slim" onClick={() => navigate("/app/seo")}>Fix SEO</Button>
                        <Button size="slim" onClick={() => navigate("/app/descriptions")}>Fix Desc</Button>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
