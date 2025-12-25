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
  EmptyState
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ArrowLeftIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
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

    if (!process.env.GEMINI_API_KEY) {
      return json({ error: "Server configuration error: API key missing." }, { status: 500 });
    }

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
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Clean up markdown code blocks if present
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const seoData = JSON.parse(cleanText);
      
      // Update stats
      if (prisma && prisma.usageStat) {
        const { session } = await authenticate.admin(request);
        await prisma.usageStat.upsert({
          where: { shop: session.shop },
          update: { seoGenerated: { increment: 1 } },
          create: { shop: session.shop, seoGenerated: 1 }
        });
      } else {
        console.warn("Skipping stats update: prisma.usageStat is undefined");
      }

      return json({ generatedSeo: seoData });
    } catch (error) {
      console.error("Gemini API Error:", error);
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

  const selectProduct = async () => {
    const selection = await shopify.resourcePicker({
      type: 'product',
      filter: {
        variants: false
      },
      multiple: false, // Start with single mode for simplicity
      action: 'select'
    });
    
    if (selection && selection.length > 0) {
      const id = selection[0].id;
      setProductId(id);
      const formData = new FormData();
      formData.append("intent", "fetch");
      formData.append("productId", id);
      submit(formData, { method: "post" });
    }
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

  return (
    <Page>
      <TitleBar title="AI SEO Generator" />
      <BlockStack gap="500">
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
                    <Button onClick={selectProduct}>
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
                           <Button onClick={() => { setGeneratedSeoTitle(""); setGeneratedSeoDescription(""); }}>Discard</Button>
                           <Button variant="primary" onClick={handleSave} loading={isLoading}>Save to Product</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  heading="Optimize your Product SEO"
                  action={{ content: 'Select Product', onAction: selectProduct }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Select a product to automatically generate high-ranking SEO titles and meta descriptions.</p>
                </EmptyState>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
