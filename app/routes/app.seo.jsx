import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  TextField,
  InlineStack,
  EmptyState,
  IndexTable,
  Thumbnail,
  Pagination,
  Banner
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ArrowLeftIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData } from "@remix-run/react";
import { generateContentSafe } from "../gemini.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  /* Billing disabled until app is public
  await billing.require({
    plans: ["Growth"],
    isTest: true,
    onFailure: async () => billing.request({
      plan: "Growth",
      isTest: true,
      returnUrl: `https://${new URL(request.url).hostname}/app/seo`,
    }),
  });
  */

  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 20, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            url
            altText
          }
          seo {
            title
            description
          }
        }
      }
    }`
  );
  const responseJson = await response.json();

  const usage = await prisma.usageStat.findUnique({
    where: { shop: session.shop }
  });

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    products: responseJson.data.products.nodes,
    usageCount: usage?.monthlyUsageCount || 0,
    credits: usage?.credits || 0
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch") {
    const productId = formData.get("productId");
    const response = await admin.graphql(
      `#graphql
      query getProductSEO($id: ID!) {
        product(id: $id) {
          title
          description
          seo {
            title
            description
          }
        }
      }`,
      { variables: { id: productId } }
    );
    const responseJson = await response.json();
    const product = responseJson.data.product;
    return json({
      productTitle: product.title,
      productDescription: product.description, // Plain text description for context
      currentSeoTitle: product.seo?.title || "",
      currentSeoDescription: product.seo?.description || ""
    });
  }

  if (intent === "generate_seo") {
    const productTitle = formData.get("productTitle");
    const productDescription = formData.get("productDescription");
    const keywords = formData.get("keywords");

    // Key check handled by getGeminiModel

    const prompt = `
You are an SEO Expert for Shopify stores.
Generate an optimized SEO Title and Meta Description for the following product.

Product Title: ${productTitle}
Product Description: ${productDescription}
Target Keywords: ${keywords}

Rules:
1. SEO Title: Max 60 characters. Include the main keyword near the beginning.
2. Meta Description: Max 160 characters. Compelling, encourages clicks, includes keywords naturally.
3. Output Format: JSON with keys "title" and "description".

Example Output:
{
  "title": "Premium Organic Cotton T-Shirt | Eco-Friendly Brand",
  "description": "Shop our softest organic cotton t-shirt. Sustainable, breathable, and perfect for everyday wear. Available in 5 colors. Free shipping on orders over $50."
}

Generate JSON:
`;

    try {
      // Pre-check Billing/Update Stats
      if (prisma && prisma.usageStat) {
        const { session } = await authenticate.admin(request);

        // This will throw if no free credits AND no active plan
        await checkAndChargeUsage(admin, session.shop, 1);

        await prisma.usageStat.upsert({
          where: { shop: session.shop },
          update: { seoGenerated: { increment: 1 } },
          create: { shop: session.shop, seoGenerated: 1 }
        });
      }

      const text = await generateContentSafe(prompt);

      // Clean up markdown code blocks if present
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const seoData = JSON.parse(cleanText);

      return json({ generatedSeo: seoData });
    } catch (error) {
      console.error("Gemini API Error:", error);
      if (error.message.includes("No active billing plan")) {
        return json({ error: error.message }, { status: 402 });
      }
      return json({ error: `Failed to generate SEO. Error: ${error.message}` }, { status: 500 });
    }
  }

  if (intent === "save_seo") {
    const productId = formData.get("productId");
    const seoTitle = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");

    const response = await admin.graphql(
      `#graphql
      mutation updateProductSEO($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            seo {
              title
              description
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            id: productId,
            seo: {
              title: seoTitle,
              description: seoDescription
            }
          }
        }
      }
    );

    const responseJson = await response.json();
    if (responseJson.data.productUpdate.userErrors.length > 0) {
      return json({ error: responseJson.data.productUpdate.userErrors[0].message }, { status: 400 });
    }
    return json({ success: true });
  }

  return null;
};

export default function SeoGenerator() {
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [productDescription, setProductDescription] = useState("");

  const [currentSeoTitle, setCurrentSeoTitle] = useState("");
  const [currentSeoDescription, setCurrentSeoDescription] = useState("");

  const [generatedSeoTitle, setGeneratedSeoTitle] = useState("");
  const [generatedSeoDescription, setGeneratedSeoDescription] = useState("");

  const [keywords, setKeywords] = useState("");

  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.productTitle) {
      setProductTitle(actionData.productTitle);
      setProductDescription(actionData.productDescription || "");
      setCurrentSeoTitle(actionData.currentSeoTitle);
      setCurrentSeoDescription(actionData.currentSeoDescription);
      // Reset generated fields
      setGeneratedSeoTitle("");
      setGeneratedSeoDescription("");
      shopify.toast.show("Product loaded");
    }

    if (actionData?.generatedSeo) {
      setGeneratedSeoTitle(actionData.generatedSeo.title);
      setGeneratedSeoDescription(actionData.generatedSeo.description);
      shopify.toast.show("SEO Generated");
    }

    if (actionData?.success) {
      shopify.toast.show("SEO Updated Successfully");
      setCurrentSeoTitle(generatedSeoTitle);
      setCurrentSeoDescription(generatedSeoDescription);
      setGeneratedSeoTitle("");
      setGeneratedSeoDescription("");
    }

    if (actionData?.error) {
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
    formData.append("keywords", keywords);
    submit(formData, { method: "post" });
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_seo");
    formData.append("productId", productId);
    formData.append("seoTitle", generatedSeoTitle || currentSeoTitle);
    formData.append("seoDescription", generatedSeoDescription || currentSeoDescription);
    submit(formData, { method: "post" });
  };

  const credits = loaderData?.credits || 0;

  const [showPaidBanner, setShowPaidBanner] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hidePaidBanner') !== 'true';
    }
    return true;
  });

  const [showCreditsBanner, setShowCreditsBanner] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hideCreditsBanner') !== 'true';
    }
    return true;
  });

  const handleDismissPaidBanner = () => {
    setShowPaidBanner(false);
    localStorage.setItem('hidePaidBanner', 'true');
  };

  const handleDismissCreditsBanner = () => {
    setShowCreditsBanner(false);
    localStorage.setItem('hideCreditsBanner', 'true');
  };

  return (
    <Page>
      <TitleBar title="AI SEO Generator" />
      <BlockStack gap="500">
        {credits > 0 ? (
          showCreditsBanner && (
            <Banner tone="success" title="Using Free Credits" onDismiss={handleDismissCreditsBanner}>
              <p>You have <strong>{credits}</strong> free credits remaining. This generation is free.</p>
            </Banner>
          )
        ) : (
          showPaidBanner && (
            <Banner tone="info" title="Paid Usage Active" onDismiss={handleDismissPaidBanner}>
              <p>You have used all free credits. This generation will cost <strong>$0.015</strong>.</p>
            </Banner>
          )
        )}
        <Layout>
          <Layout.Section>
            {productId ? (
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Button
                        icon={ArrowLeftIcon}
                        onClick={() => {
                          setProductId("");
                          setProductTitle("");
                          setProductDescription("");
                          setCurrentSeoTitle("");
                          setCurrentSeoDescription("");
                          setGeneratedSeoTitle("");
                          setGeneratedSeoDescription("");
                          setKeywords("");
                        }}
                        accessibilityLabel="Back"
                      />
                      <Text as="h2" variant="headingMd">
                        {`Editing SEO: ${productTitle}`}
                      </Text>
                    </InlineStack>
                    <Button onClick={() => setProductId("")}>
                      Change Product
                    </Button>
                  </InlineStack>

                  <TextField
                    label="Target Keywords"
                    value={keywords}
                    onChange={setKeywords}
                    placeholder="e.g. organic cotton, summer t-shirt"
                    autoComplete="off"
                  />

                  <BlockStack gap="400">
                    <Text variant="headingSm" as="h3">Current SEO</Text>
                    <TextField
                      label="SEO Title"
                      value={currentSeoTitle}
                      disabled
                      autoComplete="off"
                    />
                    <TextField
                      label="Meta Description"
                      value={currentSeoDescription}
                      multiline={3}
                      disabled
                      autoComplete="off"
                    />
                  </BlockStack>

                  <Button
                    variant="primary"
                    onClick={handleGenerate}
                    loading={isLoading}
                  >
                    Generate Optimized SEO
                  </Button>

                  {generatedSeoTitle && (
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="400">
                        <Text variant="headingSm" as="h3">AI Suggestion</Text>
                        <TextField
                          label="SEO Title (Max 60)"
                          value={generatedSeoTitle}
                          onChange={setGeneratedSeoTitle}
                          autoComplete="off"
                          helpText={`${generatedSeoTitle.length}/60 characters`}
                        />
                        <TextField
                          label="Meta Description (Max 160)"
                          value={generatedSeoDescription}
                          onChange={setGeneratedSeoDescription}
                          multiline={3}
                          autoComplete="off"
                          helpText={`${generatedSeoDescription.length}/160 characters`}
                        />
                        <InlineStack align="end" gap="300">
                          <Button disabled={isLoading} onClick={() => { setGeneratedSeoTitle(""); setGeneratedSeoDescription(""); }}>Discard</Button>
                          <Button variant="primary" onClick={handleSave} loading={isLoading}>Save to Product</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Select a Product</Text>
                  <IndexTable
                    resourceName={{ singular: 'product', plural: 'products' }}
                    itemCount={loaderData?.products?.length || 0}
                    headings={[
                      { title: 'Image' },
                      { title: 'Product' },
                      { title: 'Current SEO' },
                      { title: 'Action' },
                    ]}
                    selectable={false}
                  >
                    {loaderData?.products?.map((product, index) => (
                      <IndexTable.Row id={product.id} key={product.id} position={index}>
                        <IndexTable.Cell>
                          <Thumbnail
                            source={product.featuredImage?.url || ""}
                            alt={product.featuredImage?.altText || product.title}
                            size="small"
                          />
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text fontWeight="bold" as="span">{product.title}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {product.seo?.title ? 'Title Set' : 'Missing Title'}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {product.seo?.description ? 'Desc Set' : 'Missing Desc'}
                            </Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button size="slim" onClick={() => selectProduct(product.id)}>Optimize</Button>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
