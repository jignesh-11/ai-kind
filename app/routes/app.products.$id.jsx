import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Card, Button, BlockStack, InlineStack, Text, Badge, Box, Modal, TextContainer } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  // Reconstruct the full Shopify product ID
  const productId = `gid://shopify/Product/${params.id}`;

  const response = await admin.graphql(
    `#graphql
    query getProductDetails($id: ID!) {
      product(id: $id) {
        id
        title
        productType
        vendor
        descriptionHtml
        images(first: 50) {
          nodes {
            id
            url
            altText
          }
        }
      }
    }`,
    { variables: { id: productId } }
  );

  const responseJson = await response.json();
  if (responseJson.errors) {
    throw new Error("Failed to fetch product");
  }

  const product = responseJson.data.product;
  return json({ product });
};

export default function ProductDetailsPage() {
  const { product } = useLoaderData();
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const images = product.images?.nodes || [];
  const imagesWithoutAlt = images.filter(img => !img.altText || img.altText.trim() === "");

  const handleGenerateAltTextForProduct = async () => {
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append("intent", "generate");
      formData.append("productId", product.id);
      formData.append("productTitle", product.title);
      formData.append("productType", product.productType || "");

      const response = await fetch("/app/api/alttext", { method: "POST", body: formData });
      const data = await response.json();

      if (data.generated !== undefined) {
        alert(`Generated alt text for ${data.generated} images`);
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

  return (
    <Page>
      <BlockStack gap="600">
        {/* ── Header ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={() => navigate("/app/products")}>← Back</Button>
              <BlockStack gap="100">
                <Text as="h1" variant="headingLg">{product.title}</Text>
                {product.productType && (
                  <Text tone="subdued">{product.productType}</Text>
                )}
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Stats ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" wrap>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="headingMd">{images.length}</Text>
                  <Text variant="bodySm" tone="subdued">Total Images</Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="headingMd" tone={imagesWithoutAlt.length > 0 ? "caution" : "success"}>
                    {imagesWithoutAlt.length}
                  </Text>
                  <Text variant="bodySm" tone="subdued">Missing Alt Text</Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="headingMd" tone={imagesWithoutAlt.length === 0 ? "success" : "caution"}>
                    {images.length - imagesWithoutAlt.length}
                  </Text>
                  <Text variant="bodySm" tone="subdued">With Alt Text</Text>
                </BlockStack>
              </Box>
            </InlineStack>

            {imagesWithoutAlt.length > 0 && (
              <Button
                variant="primary"
                onClick={handleGenerateAltTextForProduct}
                loading={isGenerating}
                disabled={isGenerating}
              >
                Generate Alt Text for All Images
              </Button>
            )}
          </BlockStack>
        </Card>

        {/* ── Images Grid ── */}
        {images.length === 0 ? (
          <Card>
            <Box padding="600" textAlign="center">
              <Text tone="subdued">No images for this product</Text>
            </Box>
          </Card>
        ) : (
          <BlockStack gap="300">
            {images.map((image, index) => {
              const hasAlt = image.altText && image.altText.trim() !== "";
              return (
                <Card key={image.id}>
                  <InlineStack gap="400" blockAlign="start">
                    {/* Image Thumbnail */}
                    <Box
                      style={{
                        width: "120px",
                        height: "120px",
                        minWidth: "120px",
                        overflow: "hidden",
                        borderRadius: "4px",
                        backgroundColor: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
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

                    {/* Image Info */}
                    <BlockStack gap="200" style={{ flex: 1 }}>
                      <InlineStack blockAlign="center" gap="200">
                        <Text as="h3" variant="headingMd">
                          Image {index + 1}
                        </Text>
                        <Badge tone={hasAlt ? "success" : "critical"}>
                          {hasAlt ? "Alt Text" : "Missing"}
                        </Badge>
                      </InlineStack>

                      {hasAlt && (
                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">Current Alt Text:</Text>
                            <Text variant="bodySm">{image.altText}</Text>
                          </BlockStack>
                        </Box>
                      )}

                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          variant={hasAlt ? "secondary" : "primary"}
                          onClick={() => setSelectedImage(image)}
                        >
                          {hasAlt ? "Regenerate" : "Generate"} Alt Text
                        </Button>
                        <Button
                          size="slim"
                          onClick={() => window.open(image.url, "_blank")}
                        >
                          View Full Size
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>
                </Card>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>

      {/* ── Generate Alt Text Modal ── */}
      {selectedImage && (
        <Modal
          open={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          title="Generate Alt Text"
          primaryAction={{
            content: "Generate",
            onAction: async () => {
              try {
                const formData = new FormData();
                formData.append("intent", "generate");
                formData.append("productId", product.id);
                formData.append("productTitle", product.title);
                formData.append("productType", product.productType || "");

                const response = await fetch("/app/api/alttext", { method: "POST", body: formData });
                const data = await response.json();

                if (data.generated !== undefined) {
                  alert(`Generated alt text for image`);
                  window.location.reload();
                } else {
                  alert(`Error: ${data.error || "Unknown error"}`);
                }
              } catch (error) {
                alert(`Error: ${error.message}`);
              }
            },
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setSelectedImage(null),
            },
          ]}
        >
          <Modal.Section>
            <TextContainer>
              <Text>Generate SEO-friendly alt text for this image?</Text>
              <Text tone="subdued" variant="bodySm">
                Alt text will be generated using AI and limited to 125 characters.
              </Text>
            </TextContainer>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
