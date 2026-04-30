import {
  Page, Layout, Text, Card, Button, BlockStack, Box,
  TextField, InlineStack, IndexTable, Thumbnail, Banner, Badge, ProgressBar
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ArrowLeftIcon, ClockIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import { generateJsonSafe } from "../gemini.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";
import { Modal } from "@shopify/polaris";

const SEO_SCHEMA = {
  type: "object",
  properties: {
    title:       { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "description"],
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const perPage = 20;

  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 250, sortKey: TITLE) {
        nodes {
          id title productType vendor
          featuredImage { url altText }
          seo { title description }
        }
      }
    }`
  );
  const responseJson = await response.json();
  const allProducts = responseJson.data.products.nodes;

  // Paginate products
  const totalPages = Math.ceil(allProducts.length / perPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * perPage;
  const paginatedProducts = allProducts.slice(startIdx, startIdx + perPage);

  const usage = await prisma.usageStat.findUnique({ where: { shop: session.shop } });

  return json({
    apiKey:   process.env.SHOPIFY_API_KEY || "",
    allProducts, // Return all products for searching
    products: paginatedProducts,
    credits:  usage?.credits || 0,
    pagination: {
      currentPage,
      totalPages,
      totalProducts: allProducts.length,
      perPage,
    },
  });
};

export const action = async ({ request }) => {
  // Single authenticate call — session reused for all intents
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // ── fetch product details ────────────────────────────────────────────────
  if (intent === "fetch") {
    const productId = formData.get("productId");
    const response = await admin.graphql(
      `#graphql
      query getProductSEO($id: ID!) {
        product(id: $id) {
          title description productType vendor tags
          seo { title description }
        }
      }`,
      { variables: { id: productId } }
    );
    const responseJson = await response.json();
    const p = responseJson.data.product;
    return json({
      productTitle:       p.title,
      productDescription: p.description || "",
      productType:        p.productType || "",
      vendor:             p.vendor || "",
      tags:               (p.tags || []).join(", "),
      currentSeoTitle:    p.seo?.title || "",
      currentSeoDescription: p.seo?.description || "",
    });
  }

  // ── fetch SEO history ────────────────────────────────────────────────────
  if (intent === "fetch_history") {
    const productId = formData.get("productId");
    try {
      const history = await prisma.seoHistory.findMany({
        where: { shop: session.shop, productId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return json({ history });
    } catch (_) {
      return json({ history: [] });
    }
  }

  // ── generate SEO ─────────────────────────────────────────────────────────
  if (intent === "generate_seo") {
    const productTitle       = formData.get("productTitle");
    const productDescription = formData.get("productDescription");
    const keywords           = formData.get("keywords");
    const productType        = formData.get("productType") || "";
    const vendor             = formData.get("vendor") || "";
    const tags               = formData.get("tags") || "";

    const prompt = `You are an SEO expert for e-commerce stores.
Generate an optimized SEO Title and Meta Description for this Shopify product.

Product Title: ${productTitle}
${productType ? `Product Type: ${productType}` : ""}
${vendor ? `Brand/Vendor: ${vendor}` : ""}
${tags ? `Tags: ${tags}` : ""}
${productDescription ? `Product Description: ${productDescription.substring(0, 300)}` : ""}
Target Keywords: ${keywords}

CRITICAL RULES - MUST FOLLOW:
1. SEO Title: EXACTLY max 60 characters. No longer. Include main keyword at the start. Compelling.
2. Meta Description: Max 160 characters. It MUST be a complete, coherent description that ends with a period. Do NOT cut off mid-sentence. Ensure it is compelling and fits naturally within the limit. Count carefully.
3. Do NOT use the word "ultimate" or generic filler phrases like "shop now", "discover", "explore".
4. Respond ONLY with the JSON object — no explanation, no markdown.`;

    try {
      await checkAndChargeUsage(admin, session.shop, 1);
      await prisma.usageStat.upsert({
        where: { shop: session.shop },
        update: { seoGenerated: { increment: 1 } },
        create: { shop: session.shop, seoGenerated: 1 }
      });

      // Use native JSON mode — no regex cleanup needed
      const seoData = await generateJsonSafe(prompt, SEO_SCHEMA);

      // Safety net: enforce character limits if AI exceeds them
      if (seoData.title && seoData.title.length > 60) {
        const truncated = seoData.title.substring(0, 60);
        seoData.title = truncated.includes(" ") ? truncated.substring(0, truncated.lastIndexOf(" ")).trim() : truncated;
      }
      if (seoData.description && seoData.description.length > 160) {
        const truncated = seoData.description.substring(0, 160);
        // Try to truncate at last period or space
        const lastPeriod = truncated.lastIndexOf(".");
        if (lastPeriod > 100) {
           seoData.description = truncated.substring(0, lastPeriod + 1).trim();
        } else if (truncated.includes(" ")) {
           seoData.description = truncated.substring(0, truncated.lastIndexOf(" ")).trim() + "...";
        } else {
           seoData.description = truncated;
        }
      }

      return json({ generatedSeo: seoData });
    } catch (error) {
      console.error("Gemini API Error:", error);
      if (error.message?.includes("No active billing")) return json({ error: error.message }, { status: 402 });
      return json({ error: `Failed to generate SEO. Error: ${error.message}` }, { status: 500 });
    }
  }

  // ── save SEO ─────────────────────────────────────────────────────────────
  if (intent === "save_seo") {
    const productId      = formData.get("productId");
    const seoTitle       = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");
    const productTitle   = formData.get("productTitle");
    const keywords       = formData.get("keywords");

    const response = await admin.graphql(
      `#graphql
      mutation updateProductSEO($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id seo { title description } }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: productId, seo: { title: seoTitle, description: seoDescription } } } }
    );
    const responseJson = await response.json();
    if (responseJson.data.productUpdate.userErrors.length > 0) {
      return json({ error: responseJson.data.productUpdate.userErrors[0].message }, { status: 400 });
    }

    // Save to history
    try {
      await prisma.seoHistory.create({
        data: { shop: session.shop, productId, productTitle: productTitle || "", seoTitle, seoDescription, keywords: keywords || "" }
      });
      const all = await prisma.seoHistory.findMany({
        where: { shop: session.shop, productId }, orderBy: { createdAt: "desc" }, select: { id: true }
      });
      if (all.length > 10) {
        await prisma.seoHistory.deleteMany({ where: { id: { in: all.slice(10).map(r => r.id) } } });
      }
    } catch (err) { console.error("SEO history save failed:", err); }

    return json({ success: true });
  }

  return null;
};

// ── Google SERP preview component ────────────────────────────────────────────
function SerpPreview({ title, description, shopDomain }) {
  const displayTitle = title || "Product Title";
  const displayDesc  = description || "Product meta description will appear here…";
  const displayUrl   = shopDomain ? `${shopDomain}/products/example` : "yourstore.myshopify.com/products/example";

  const titleColor   = title?.length > 60 ? "#cc0000" : "#1a0dab";
  const titleDisplay = title ? title.slice(0, 60) + (title.length > 60 ? "…" : "") : displayTitle;
  const descDisplay  = description ? description.slice(0, 160) + (description.length > 160 ? "…" : "") : displayDesc;

  return (
    <Box padding="400" background="bg-surface" borderRadius="200" borderWidth="025" borderColor="border">
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued" as="p" style={{ fontFamily: "arial,sans-serif" }}>
          {displayUrl}
        </Text>
        <div style={{ fontSize: 18, color: titleColor, fontFamily: "arial,sans-serif", lineHeight: "1.3", cursor: "pointer" }}>
          {titleDisplay}
        </div>
        <Text variant="bodySm" as="p" style={{ fontFamily: "arial,sans-serif", color: "#4d5156", lineHeight: "1.58" }}>
          {descDisplay}
        </Text>
      </BlockStack>
    </Box>
  );
}

// ── Character count bar ───────────────────────────────────────────────────────
function CharBar({ value, max, label }) {
  const len  = (value || "").length;
  const pct  = Math.min(100, Math.round((len / max) * 100));
  const over = len > max;
  const tone = over ? "critical" : len > max * 0.85 ? "warning" : "success";
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text variant="bodySm" tone="subdued">{label}</Text>
        <Text variant="bodySm" tone={over ? "critical" : "subdued"}>{len}/{max}</Text>
      </InlineStack>
      <ProgressBar progress={pct} tone={tone} size="small" />
    </BlockStack>
  );
}

export default function SeoGenerator() {
  const actionData  = useActionData();
  const loaderData  = useLoaderData();
  const navigation  = useNavigation();
  const navigate    = useNavigate();
  const submit      = useSubmit();
  const shopify     = useAppBridge();

  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productType, setProductType] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");

  const [currentSeoTitle, setCurrentSeoTitle]       = useState("");
  const [currentSeoDescription, setCurrentSeoDescription] = useState("");

  const [generatedSeoTitle, setGeneratedSeoTitle]       = useState("");
  const [generatedSeoDescription, setGeneratedSeoDescription] = useState("");

  const [keywords, setKeywords] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // History
  const [history, setHistory] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  const isLoading = navigation.state === "submitting";

  // Auto-load product from URL param (from audit page "Fix SEO" button)
  useEffect(() => {
    const url = new URL(window.location);
    const urlProductId = url.searchParams.get("productId");
    if (urlProductId && loaderData?.products) {
      const product = loaderData.products.find(p => p.id === urlProductId);
      if (product) {
        selectProduct(product.id);
        // Clear the param from URL
        window.history.replaceState({}, "", "/app/seo");
      }
    }
  }, []);

  useEffect(() => {
    if (!actionData) return;

    if (actionData.productTitle) {
      setProductTitle(actionData.productTitle);
      setProductDescription(actionData.productDescription || "");
      setProductType(actionData.productType || "");
      setVendor(actionData.vendor || "");
      setTags(actionData.tags || "");
      setCurrentSeoTitle(actionData.currentSeoTitle || "");
      setCurrentSeoDescription(actionData.currentSeoDescription || "");
      setGeneratedSeoTitle("");
      setGeneratedSeoDescription("");
      shopify.toast.show("Product loaded");
    }
    if (actionData.generatedSeo) {
      setGeneratedSeoTitle(actionData.generatedSeo.title || "");
      setGeneratedSeoDescription(actionData.generatedSeo.description || "");
      shopify.toast.show("SEO generated");
    }
    if (actionData.success) {
      shopify.toast.show("SEO updated successfully");
      setCurrentSeoTitle(generatedSeoTitle);
      setCurrentSeoDescription(generatedSeoDescription);
      setGeneratedSeoTitle("");
      setGeneratedSeoDescription("");
    }
    if (actionData.history) {
      setHistory(actionData.history);
      setHistoryModalOpen(true);
    }
    if (actionData.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify, generatedSeoTitle, generatedSeoDescription]);

  const selectProduct = (id) => {
    setProductId(id);
    const formData = new FormData();
    formData.append("intent", "fetch");
    formData.append("productId", id);
    submit(formData, { method: "post" });
  };

  const handleGenerate = () => {
    const formData = new FormData();
    formData.append("intent", "generate_seo");
    formData.append("productTitle", productTitle);
    formData.append("productDescription", productDescription);
    formData.append("productType", productType);
    formData.append("vendor", vendor);
    formData.append("tags", tags);
    formData.append("keywords", keywords);
    submit(formData, { method: "post" });
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_seo");
    formData.append("productId", productId);
    formData.append("seoTitle", generatedSeoTitle || currentSeoTitle);
    formData.append("seoDescription", generatedSeoDescription || currentSeoDescription);
    formData.append("productTitle", productTitle);
    formData.append("keywords", keywords);
    submit(formData, { method: "post" });
  };

  const handleFetchHistory = () => {
    const formData = new FormData();
    formData.append("intent", "fetch_history");
    formData.append("productId", productId);
    submit(formData, { method: "post" });
  };

  const handleRestoreHistory = (entry) => {
    setGeneratedSeoTitle(entry.seoTitle);
    setGeneratedSeoDescription(entry.seoDescription);
    setHistoryModalOpen(false);
    shopify.toast.show("Version restored — save when ready");
  };

  const shopDomain = loaderData?.apiKey ? undefined : "yourstore.myshopify.com";

  return (
    <Page>
      <TitleBar title="AI SEO Generator" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            {productId ? (
              <Card>
                <BlockStack gap="500">
                  {/* Header */}
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Button
                        icon={ArrowLeftIcon}
                        onClick={() => {
                          setProductId(""); setProductTitle(""); setProductDescription("");
                          setCurrentSeoTitle(""); setCurrentSeoDescription("");
                          setGeneratedSeoTitle(""); setGeneratedSeoDescription("");
                          setKeywords(""); setProductType(""); setVendor(""); setTags("");
                        }}
                        accessibilityLabel="Back"
                      />
                      <Text as="h2" variant="headingMd">Editing SEO: {productTitle}</Text>
                    </InlineStack>
                    <Button icon={ClockIcon} onClick={handleFetchHistory} loading={isLoading}>History</Button>
                  </InlineStack>

                  {/* Product context */}
                  {(productType || vendor) && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <InlineStack gap="400" wrap>
                        {productType && <Text variant="bodySm" tone="subdued">Type: <strong>{productType}</strong></Text>}
                        {vendor && <Text variant="bodySm" tone="subdued">Brand: <strong>{vendor}</strong></Text>}
                        {tags && <Text variant="bodySm" tone="subdued">Tags: <strong>{tags}</strong></Text>}
                      </InlineStack>
                    </Box>
                  )}

                  <TextField
                    label="Target Keywords"
                    value={keywords}
                    onChange={setKeywords}
                    placeholder="e.g. organic cotton, summer t-shirt, eco-friendly"
                    autoComplete="off"
                    helpText="Separate keywords with commas"
                  />

                  {/* Current SEO */}
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Current SEO</Text>
                    <TextField label="SEO Title" value={currentSeoTitle} disabled autoComplete="off" />
                    <CharBar value={currentSeoTitle} max={60} label="Title length" />
                    <TextField label="Meta Description" value={currentSeoDescription} multiline={3} disabled autoComplete="off" />
                    <CharBar value={currentSeoDescription} max={160} label="Description length" />
                  </BlockStack>

                  {/* SERP preview of current */}
                  {(currentSeoTitle || currentSeoDescription) && (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3">Current SERP Preview</Text>
                      <SerpPreview title={currentSeoTitle} description={currentSeoDescription} shopDomain={shopDomain} />
                    </BlockStack>
                  )}

                  <Button variant="primary" onClick={handleGenerate} loading={isLoading}>
                    Generate Optimized SEO
                  </Button>

                  {/* AI suggestion */}
                  {generatedSeoTitle && (
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="400">
                        <Text variant="headingSm" as="h3">AI Suggestion</Text>

                        <BlockStack gap="100">
                          <TextField
                            label="SEO Title (Max 60)"
                            value={generatedSeoTitle}
                            onChange={setGeneratedSeoTitle}
                            autoComplete="off"
                            error={generatedSeoTitle.length > 60 ? `${generatedSeoTitle.length - 60} characters over limit` : undefined}
                          />
                          <CharBar value={generatedSeoTitle} max={60} label="Title length" />
                        </BlockStack>

                        <BlockStack gap="100">
                          <TextField
                            label="Meta Description (Max 160)"
                            value={generatedSeoDescription}
                            onChange={setGeneratedSeoDescription}
                            multiline={3}
                            autoComplete="off"
                            error={generatedSeoDescription.length > 160 ? `${generatedSeoDescription.length - 160} characters over limit` : undefined}
                          />
                          <CharBar value={generatedSeoDescription} max={160} label="Description length" />
                        </BlockStack>

                        {/* Live SERP preview */}
                        <BlockStack gap="200">
                          <Text variant="headingSm" as="h3">Live SERP Preview</Text>
                          <SerpPreview title={generatedSeoTitle} description={generatedSeoDescription} shopDomain={shopDomain} />
                        </BlockStack>

                        <InlineStack align="end" gap="300">
                          <Button disabled={isLoading} onClick={() => { setGeneratedSeoTitle(""); setGeneratedSeoDescription(""); }}>
                            Discard
                          </Button>
                          <Button
                            variant="primary"
                            onClick={handleSave}
                            loading={isLoading}
                            disabled={generatedSeoTitle.length > 60 || generatedSeoDescription.length > 160}
                          >
                            Save to Product
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            ) : (
              /* ── Product list ── */
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="300">
                    <InlineStack blockAlign="center" gap="300">
                      <Text variant="headingMd" as="h2">Select a Product to Optimize</Text>
                    </InlineStack>
                    <TextField
                      label="Search products"
                      value={searchTerm}
                      onChange={setSearchTerm}
                      placeholder="Search by product name, type, or brand..."
                      clearButton
                      onClearButtonClick={() => setSearchTerm("")}
                    />
                  </BlockStack>
                  {(() => {
                    const paginatedProducts = loaderData?.products || [];
                    const allProducts = loaderData?.allProducts || paginatedProducts;
                    const filtered = searchTerm
                      ? allProducts.filter(p =>
                          p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (p.productType?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (p.vendor?.toLowerCase().includes(searchTerm.toLowerCase()))
                        )
                      : paginatedProducts;
                    return (
                    <IndexTable
                      resourceName={{ singular: "product", plural: "products" }}
                      itemCount={filtered.length}
                    headings={[
                      { title: "Image" },
                      { title: "Product" },
                      { title: "Type" },
                      { title: "SEO Status" },
                      { title: "Action" },
                    ]}
                    selectable={false}
                  >
                    {filtered?.map((product, index) => (
                      <IndexTable.Row id={product.id} key={product.id} position={index}>
                        <IndexTable.Cell>
                          {product.featuredImage?.url ? (
                            <Thumbnail
                              source={product.featuredImage.url}
                              alt={product.featuredImage?.altText || product.title}
                              size="small"
                            />
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
                          {product.vendor && <Text as="span" variant="bodySm" tone="subdued"> · {product.vendor}</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm" tone="subdued">{product.productType || "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="100">
                            {product.seo?.title
                              ? <Badge tone="success">Title ✓</Badge>
                              : <Badge tone="critical">No title</Badge>}
                            {product.seo?.description
                              ? <Badge tone="success">Desc ✓</Badge>
                              : <Badge tone="critical">No desc</Badge>}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button size="slim" onClick={() => selectProduct(product.id)}>Optimize</Button>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                    </IndexTable>
                    );
                  })()}

                  {/* Pagination */}
                  {loaderData?.pagination && (
                    <InlineStack gap="400" align="center" blockAlign="center">
                      <Button
                        onClick={() => navigate(`?page=${loaderData.pagination.currentPage - 1}`)}
                        disabled={loaderData.pagination.currentPage <= 1}
                      >
                        ← Previous
                      </Button>
                      <Text variant="bodySm" tone="subdued">
                        Page {loaderData.pagination.currentPage} of {loaderData.pagination.totalPages} ({loaderData.pagination.totalProducts} products)
                      </Text>
                      <Button
                        onClick={() => navigate(`?page=${loaderData.pagination.currentPage + 1}`)}
                        disabled={loaderData.pagination.currentPage >= loaderData.pagination.totalPages}
                      >
                        Next →
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* ── SEO History modal ── */}
      <Modal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title={`SEO History: ${productTitle}`}
      >
        <Modal.Section>
          {history.length === 0 ? (
            <Text tone="subdued">No previous SEO versions for this product.</Text>
          ) : (
            <BlockStack gap="300">
              {history.map((entry) => (
                <Box key={entry.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="bodySm" tone="subdued">{new Date(entry.createdAt).toLocaleString()}</Text>
                      <Button size="slim" onClick={() => handleRestoreHistory(entry)}>Restore</Button>
                    </InlineStack>
                    <Text variant="bodySm"><strong>Title:</strong> {entry.seoTitle}</Text>
                    <Text variant="bodySm" tone="subdued"><strong>Desc:</strong> {entry.seoDescription}</Text>
                    {entry.keywords && <Text variant="bodySm" tone="subdued"><strong>Keywords:</strong> {entry.keywords}</Text>}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
