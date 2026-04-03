import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Button, BlockStack, InlineStack, Text, Badge, Box, Grid, TextField, Select, Modal, TextContainer } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProductsWithImages {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          productType
          handle
          featuredImage { url altText }
          images(first: 25) {
            nodes {
              id
              url
              altText
            }
          }
        }
      }
    }`
  );

  const responseJson = await response.json();
  const products = responseJson.data.products.nodes.map(p => ({
    ...p,
    totalImages: p.images?.nodes?.length || 0,
    imagesWithoutAlt: p.images?.nodes?.filter(img => !img.altText || img.altText.trim() === "").length || 0,
    hasImages: (p.images?.nodes?.length || 0) > 0,
  }));

  return json({ products });
};

export default function ProductsPage() {
  const { products } = useLoaderData();
  const shopify = useAppBridge();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [detailedProduct, setDetailedProduct] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Filter products based on search and filter type
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.title.toLowerCase().includes(searchTerm.toLowerCase());

    if (filterType === "no-images") {
      return matchesSearch && !product.hasImages;
    } else if (filterType === "missing-alt") {
      return matchesSearch && product.hasImages && product.imagesWithoutAlt > 0;
    } else if (filterType === "complete") {
      return matchesSearch && product.hasImages && product.imagesWithoutAlt === 0;
    }
    return matchesSearch;
  });

  const handleGenerateAltText = async (productId) => {
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append("intent", "generate");
      formData.append("productId", productId);

      const response = await fetch("/app/api/alttext", { method: "POST", body: formData });
      const data = await response.json();

      if (data.generated !== undefined) {
        shopify.toast.show(`Generated alt text for ${data.generated} image${data.generated !== 1 ? "s" : ""}`);
        setSelectedProduct(null);
        // Refresh page to show updates
        window.location.reload();
      } else {
        shopify.toast.show(data.error || "Unknown error", { isError: true });
      }
    } catch (error) {
      shopify.toast.show(error.message, { isError: true });
    } finally {
      setIsGenerating(false);
    }
  };

  const stats = {
    total: products.length,
    noImages: products.filter(p => !p.hasImages).length,
    missingAlt: products.filter(p => p.hasImages && p.imagesWithoutAlt > 0).length,
    complete: products.filter(p => p.hasImages && p.imagesWithoutAlt === 0).length,
  };

  return (
    <Page>
      <BlockStack gap="600">
        {/* ── Header Stats ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h1" variant="headingLg">Product Image Management</Text>
            <Grid>
              {[
                { label: "Total Products", value: stats.total, tone: "subdued" },
                { label: "No Images", value: stats.noImages, tone: "critical" },
                { label: "Missing Alt Text", value: stats.missingAlt, tone: "caution" },
                { label: "Complete", value: stats.complete, tone: "success" },
              ].map(stat => (
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }} key={stat.label}>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="p" tone={stat.tone}>{stat.value}</Text>
                      <Text variant="bodySm" tone="subdued">{stat.label}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        {/* ── Filters ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="400" wrap>
              <TextField
                label="Search products"
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search by product name..."
                style={{ minWidth: "250px" }}
              />
              <Select
                label="Filter by status"
                options={[
                  { label: "All Products", value: "all" },
                  { label: "No Images", value: "no-images" },
                  { label: "Missing Alt Text", value: "missing-alt" },
                  { label: "Complete", value: "complete" },
                ]}
                value={filterType}
                onChange={setFilterType}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Products Grid ── */}
        <BlockStack gap="400">
          {filteredProducts.length === 0 ? (
            <Card>
              <Box padding="600" textAlign="center">
                <Text tone="subdued">No products found matching your criteria</Text>
              </Box>
            </Card>
          ) : (
            <Grid>
              {filteredProducts.map(product => {
                const statusBadge = !product.hasImages
                  ? { tone: "critical", label: "No Images" }
                  : product.imagesWithoutAlt > 0
                  ? { tone: "caution", label: `${product.imagesWithoutAlt} Missing Alt Text` }
                  : { tone: "success", label: "Complete" };

                return (
                  <Grid.Cell columnSpan={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 3 }} key={product.id}>
                    <Card>
                      <BlockStack gap="300">
                        {/* Product Image Thumbnail */}
                        <Box
                          style={{
                            width: "100%",
                            height: "150px",
                            overflow: "hidden",
                            borderRadius: "4px",
                            backgroundColor: "#e8eaed",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {product.featuredImage?.url ? (
                            <img
                              src={product.featuredImage.url}
                              alt={product.title}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <svg
                              width="80"
                              height="80"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#999"
                              strokeWidth="1.5"
                            >
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <path d="M21 15l-5-5L5 21" />
                            </svg>
                          )}
                        </Box>

                        {/* Product Info */}
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingMd" truncate>
                            {product.title}
                          </Text>

                          {product.productType && (
                            <Text variant="bodySm" tone="subdued">
                              {product.productType}
                            </Text>
                          )}

                          <Badge tone={statusBadge.tone}>
                            {statusBadge.label}
                          </Badge>

                          {product.hasImages && product.imagesWithoutAlt > 0 && (
                            <Text variant="bodySm" tone="subdued">
                              {product.imagesWithoutAlt} of {product.totalImages} image{product.totalImages !== 1 ? "s" : ""} need{product.imagesWithoutAlt === 1 ? "s" : ""} alt text
                            </Text>
                          )}
                        </BlockStack>

                        {/* Actions */}
                        <InlineStack gap="200">
                          {product.hasImages && product.imagesWithoutAlt > 0 && (
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => setSelectedProduct(product)}
                            >
                              Generate Alt Text
                            </Button>
                          )}
                          <Button
                            size="slim"
                            onClick={() => setDetailedProduct(product)}
                          >
                            View Details
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                );
              })}
            </Grid>
          )}
        </BlockStack>
      </BlockStack>

      {/* ── Generate Alt Text Modal ── */}
      {selectedProduct && (
        <Modal
          open={!!selectedProduct}
          onClose={() => setSelectedProduct(null)}
          title={`Generate Alt Text for ${selectedProduct.title}`}
          primaryAction={{
            content: "Generate",
            onAction: () => handleGenerateAltText(selectedProduct.id),
            loading: isGenerating,
            disabled: isGenerating,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setSelectedProduct(null),
            },
          ]}
        >
          <Modal.Section>
            <TextContainer>
              <Text>
                This will generate SEO-friendly alt text for {selectedProduct.imagesWithoutAlt} image{selectedProduct.imagesWithoutAlt !== 1 ? "s" : ""} in this product.
              </Text>
              <Text tone="subdued" variant="bodySm">
                Alt text will be generated using AI and limited to 125 characters per image.
              </Text>
            </TextContainer>
          </Modal.Section>
        </Modal>
      )}

      {/* ── Product Detail Modal ── */}
      {detailedProduct && (
        <Modal
          open={!!detailedProduct}
          onClose={() => setDetailedProduct(null)}
          title={detailedProduct.title}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack gap="300" wrap>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="100">
                    <Text variant="headingMd">{detailedProduct.totalImages}</Text>
                    <Text variant="bodySm" tone="subdued">Total Images</Text>
                  </BlockStack>
                </Box>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="100">
                    <Text variant="headingMd" tone={detailedProduct.imagesWithoutAlt > 0 ? "caution" : "success"}>
                      {detailedProduct.imagesWithoutAlt}
                    </Text>
                    <Text variant="bodySm" tone="subdued">Missing Alt Text</Text>
                  </BlockStack>
                </Box>
              </InlineStack>

              {detailedProduct.hasImages && detailedProduct.imagesWithoutAlt > 0 && (
                <Button
                  variant="primary"
                  fullWidth
                  onClick={async () => {
                    setIsGenerating(true);
                    try {
                      const formData = new FormData();
                      formData.append("intent", "generate");
                      formData.append("productId", detailedProduct.id);
                      formData.append("productTitle", detailedProduct.title);
                      formData.append("productType", detailedProduct.productType || "");

                      const response = await fetch("/app/api/alttext", { method: "POST", body: formData });
                      const data = await response.json();

                      if (data.generated !== undefined) {
                        shopify.toast.show(`Generated alt text for ${data.generated} image${data.generated !== 1 ? "s" : ""}`);
                        setDetailedProduct(null);
                        window.location.reload();
                      } else {
                        shopify.toast.show(data.error || "Unknown error", { isError: true });
                      }
                    } catch (error) {
                      shopify.toast.show(error.message, { isError: true });
                    } finally {
                      setIsGenerating(false);
                    }
                  }}
                  loading={isGenerating}
                  disabled={isGenerating}
                >
                  Generate Alt Text for All Images
                </Button>
              )}

              <BlockStack gap="200">
                <Text variant="headingMd">Images:</Text>
                {detailedProduct.images?.nodes?.map((image, index) => {
                  const hasAlt = image.altText && image.altText.trim() !== "";
                  return (
                    <Box key={image.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <InlineStack gap="200" blockAlign="start">
                        <Box
                          style={{
                            width: "60px",
                            height: "60px",
                            minWidth: "60px",
                            overflow: "hidden",
                            borderRadius: "4px",
                            backgroundColor: "#f0f0f0",
                          }}
                        >
                          <img
                            src={image.url}
                            alt={image.altText || `Image ${index + 1}`}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        </Box>
                        <BlockStack gap="100" style={{ flex: 1 }}>
                          <InlineStack blockAlign="center" gap="200">
                            <Text variant="bodySm" fontWeight="bold">Image {index + 1}</Text>
                            <Badge tone={hasAlt ? "success" : "critical"}>
                              {hasAlt ? "✓" : "✗"}
                            </Badge>
                          </InlineStack>
                          {hasAlt && (
                            <Text variant="bodySm" tone="subdued">{image.altText}</Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
