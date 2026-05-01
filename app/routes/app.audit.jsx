import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Badge,
  Button, Box, IndexTable, Thumbnail, ProgressBar, Grid, Icon, ButtonGroup, Modal
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { generateAuditPDF, logAuditExport } from "../pdf.server";
import { checkAndChargeUsage, PLAN_CONFIG } from "../billing.server";
import prisma from "../db.server";

/**
 * Compute recommended fixes from audit data
 * Groups issues by type and severity
 */
function computeRecommendedFixes(products) {
  const fixes = new Map();
  const severityOrder = { high: 0, medium: 1, low: 2 };

  products.forEach((product) => {
    product.audit?.issues?.forEach((issue) => {
      let fixType = "Other";
      if (issue.msg.includes("SEO") || issue.msg.includes("title") || issue.msg.includes("description")) {
        fixType = "Missing or Incomplete SEO Tags";
      } else if (issue.msg.includes("alt text") || issue.msg.includes("image")) {
        fixType = "Missing Image Alt Text";
      } else if (issue.msg.includes("description") || issue.msg.includes("brief")) {
        fixType = "Short Product Descriptions";
      }

      if (!fixes.has(fixType)) {
        fixes.set(fixType, { products: [], severity: issue.severity, count: 0 });
      }

      const fix = fixes.get(fixType);
      fix.count++;
      if (!fix.products.find((p) => p.productId === product.id)) {
        fix.products.push({
          productId: product.id,
          productTitle: product.title,
          issue: issue.msg,
        });
      }
    });
  });

  return Array.from(fixes.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      severity: data.severity,
      products: data.products.slice(0, 5),
    }))
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

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

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // ── Download audit as PDF ──────────────────────────────────────
  if (intent === "download_pdf") {
    try {
      // 1. Check Usage & Plan
      const usage = await prisma.usageStat.findUnique({ where: { shop: session.shop } });
      const currentPlan = usage?.planName || "Free Forever";

      if (!PLAN_CONFIG[currentPlan]?.features.includes("audit")) {
        return json({ error: "The SEO PDF Audit is only available on Pro and Elite plans. Please upgrade to download." }, { status: 403 });
      }

      await checkAndChargeUsage(admin, session.shop, 1);

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

      const auditData = {
        products: audited,
        totalScore,
        perfect,
        hasIssues,
        missingDesc,
        missingSeo,
      };

      const pdfBuffer = await generateAuditPDF(auditData, session.shop);

      // Log the export
      await logAuditExport(prisma, session.shop, totalScore, audited.length, audited.reduce((sum, p) => sum + p.audit.issues.length, 0));

      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().split("T")[0]}.pdf"`,
        },
      });
    } catch (error) {
      console.error("PDF generation error:", error);
      return json({ error: `Failed to generate PDF. Error: ${error.message}` }, { status: 500 });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const perPage = 20;

  const response = await admin.graphql(
    `#graphql
    query getProductsForAudit {
      products(first: 250, sortKey: TITLE) {
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
  const allProducts = responseJson.data.products.nodes;

  const audited = allProducts.map(p => ({
    ...p,
    audit: auditProduct(p),
  }));

  // Paginate products
  const totalPages = Math.ceil(audited.length / perPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * perPage;
  const paginatedAudited = audited.slice(startIdx, startIdx + perPage);

  const totalScore  = audited.length > 0 ? Math.round(audited.reduce((s, p) => s + p.audit.score, 0) / audited.length) : 0;
  const perfect     = audited.filter(p => p.audit.issues.length === 0).length;
  const hasIssues   = audited.filter(p => p.audit.issues.length > 0).length;
  const missingDesc = audited.filter(p => !(p.descriptionHtml || "").replace(/<[^>]*>/g, "").trim()).length;
  const missingSeo  = audited.filter(p => !p.seo?.title || !p.seo?.description).length;

  const recommendedFixes = computeRecommendedFixes(audited);

  return json({
    products: paginatedAudited,
    totalScore,
    perfect,
    hasIssues,
    missingDesc,
    missingSeo,
    recommendedFixes,
    pagination: {
      currentPage,
      totalPages,
      totalProducts: audited.length,
      perPage,
    },
  });
};

export default function SeoAudit() {
  const { products, totalScore, perfect, hasIssues, missingDesc, missingSeo, recommendedFixes, pagination } = useLoaderData();
  const navigate = useNavigate();

  const scoreColor = totalScore >= 80 ? "success" : totalScore >= 50 ? "warning" : "critical";
  const scoreTone  = totalScore >= 80 ? "success" : totalScore >= 50 ? "caution" : "critical";

  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedProductIssues, setSelectedProductIssues] = useState(null);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const formData = new FormData();
      formData.append("intent", "download_pdf");
      const response = await fetch(window.location.href, {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `audit-${new Date().toISOString().split("T")[0]}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        console.error("PDF download failed:", response.status);
      }
    } catch (error) {
      console.error("PDF download error:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleGenerateAltText = () => {
    navigate("/app/products");
  };

  return (
    <Page>
      <TitleBar title="SEO Health Audit">
        <Button onClick={handleDownloadPDF} loading={isDownloading} disabled={isDownloading}>
          Download PDF
        </Button>
      </TitleBar>
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

        {/* ── Recommended Fixes ── */}
        {recommendedFixes.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Recommended Fixes</Text>
              <BlockStack gap="300">
                {recommendedFixes.map((fix, index) => (
                  <Box key={index} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <InlineStack blockAlign="center" gap="200">
                        <Badge tone={fix.severity === "high" ? "critical" : fix.severity === "medium" ? "warning" : "info"}>
                          {fix.severity.toUpperCase()}
                        </Badge>
                        <Text fontWeight="bold">{fix.type}</Text>
                        <Text tone="subdued">({fix.count} issue{fix.count !== 1 ? "s" : ""})</Text>
                      </InlineStack>
                      {fix.products.length > 0 && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">
                            Affected products:
                          </Text>
                          <BlockStack gap="100">
                            {fix.products.slice(0, 3).map((product, i) => (
                              <Text key={i} variant="bodySm">
                                • {product.productTitle}
                              </Text>
                            ))}
                            {fix.products.length > 3 && (
                              <Text variant="bodySm" tone="subdued">
                                ... and {fix.products.length - 3} more
                              </Text>
                            )}
                          </BlockStack>
                        </BlockStack>
                      )}
                      <InlineStack gap="200">
                        {fix.type.includes("SEO") && (
                          <Button size="slim" onClick={() => navigate("/app/seo")}>
                            Fix SEO
                          </Button>
                        )}
                        {fix.type.includes("Description") && (
                          <Button size="slim" onClick={() => navigate("/app/descriptions")}>
                            Fix Descriptions
                          </Button>
                        )}
                        {fix.type.includes("Alt Text") && (
                          <Button size="slim" onClick={handleGenerateAltText} variant="primary">
                            Manage Products
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

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
                      {product.featuredImage?.url ? (
                        <Thumbnail source={product.featuredImage.url} alt={product.featuredImage?.altText || product.title} size="small" />
                      ) : (
                        <Box style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#e8eaed", borderRadius: "4px" }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                          </svg>
                        </Box>
                      )}
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
                        <button
                          onClick={() => setSelectedProductIssues(product)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #e5e7eb",
                            backgroundColor: "#f9fafb",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: "500",
                          }}
                        >
                          <span style={{ color: "#dc2626" }}>●</span>
                          <span>{product.audit.issues.length} issue{product.audit.issues.length !== 1 ? "s" : ""}</span>
                        </button>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200">
                        <Button size="slim" onClick={() => navigate(`/app/seo?productId=${product.id}`)}>Fix SEO</Button>
                        <Button size="slim" onClick={() => navigate(`/app/descriptions?productId=${product.id}`)}>Fix Desc</Button>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
            </IndexTable>

            {/* Pagination */}
            {pagination && (
              <InlineStack gap="400" align="center" blockAlign="center">
                <Button
                  onClick={() => navigate(`?page=${pagination.currentPage - 1}`)}
                  disabled={pagination.currentPage <= 1}
                >
                  ← Previous
                </Button>
                <Text variant="bodySm" tone="subdued">
                  Page {pagination.currentPage} of {pagination.totalPages} ({pagination.totalProducts} products)
                </Text>
                <Button
                  onClick={() => navigate(`?page=${pagination.currentPage + 1}`)}
                  disabled={pagination.currentPage >= pagination.totalPages}
                >
                  Next →
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Issues Modal */}
      {selectedProductIssues && (
        <Modal
          open={!!selectedProductIssues}
          onClose={() => setSelectedProductIssues(null)}
          title={`Issues - ${selectedProductIssues.title}`}
          primaryAction={{
            content: "Close",
            onAction: () => setSelectedProductIssues(null),
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {selectedProductIssues.audit.issues.length === 0 ? (
                <Text>No issues found!</Text>
              ) : (
                <BlockStack gap="300">
                  {selectedProductIssues.audit.issues.map((issue, i) => (
                    <Box
                      key={i}
                      padding="300"
                      borderRadius="200"
                      background={
                        issue.severity === "high"
                          ? "bg-surface-critical-subdued"
                          : issue.severity === "medium"
                          ? "bg-surface-caution-subdued"
                          : "bg-surface-info-subdued"
                      }
                    >
                      <BlockStack gap="100">
                        <InlineStack blockAlign="center" gap="200">
                          <Badge
                            tone={
                              issue.severity === "high"
                                ? "critical"
                                : issue.severity === "medium"
                                ? "warning"
                                : "info"
                            }
                          >
                            {issue.severity.toUpperCase()}
                          </Badge>
                          <Text fontWeight="bold">{issue.msg}</Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}

              {/* Quick Actions */}
              <Box paddingBlockStart="300" borderBlockStart="1px solid #e5e7eb">
                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">Quick actions:</Text>
                  <InlineStack gap="200">
                    {selectedProductIssues.audit.issues.some((i) => i.msg.includes("SEO") || i.msg.includes("title") || i.msg.includes("description")) && (
                      <Button
                        size="slim"
                        onClick={() => {
                          navigate(`/app/seo?productId=${selectedProductIssues.id}`);
                          setSelectedProductIssues(null);
                        }}
                      >
                        Fix SEO
                      </Button>
                    )}
                    {selectedProductIssues.audit.issues.some((i) => i.msg.includes("description") && i.msg.includes("brief")) && (
                      <Button
                        size="slim"
                        onClick={() => {
                          navigate(`/app/descriptions?productId=${selectedProductIssues.id}`);
                          setSelectedProductIssues(null);
                        }}
                      >
                        Fix Description
                      </Button>
                    )}
                    {selectedProductIssues.audit.issues.some((i) => i.msg.includes("alt text") || i.msg.includes("image")) && (
                      <Button
                        size="slim"
                        onClick={() => {
                          navigate(`/app/products?productId=${selectedProductIssues.id}`);
                          setSelectedProductIssues(null);
                        }}
                      >
                        Fix Images
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
