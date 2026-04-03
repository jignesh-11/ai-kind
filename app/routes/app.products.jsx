import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Card, Button, BlockStack, InlineStack, Text, Badge, Box, Grid, TextField, Select, Modal, TextContainer } from "@shopify/polaris";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const navigate = useNavigate();

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
        alert(`Generated alt text for ${data.generated} images`);
        setSelectedProduct(null);
        // Refresh page to show updates
        window.location.reload();
      } else {
        alert(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
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
                            onClick={() => {
                              const productKey = product.id.split("/").pop(); // Extract numeric ID
                              navigate(`/app/products/${encodeURIComponent(productKey)}`);
                            }}
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
    </Page>
  );
}
