import { useState, useEffect } from "react";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Text, Card, Button, BlockStack, Box, TextField,
  Select, InlineStack, IndexTable, Thumbnail, useIndexResourceState, Badge, ProgressBar
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { ArrowLeftIcon, StarIcon } from "@shopify/polaris-icons";
import prisma from "../db.server";
import { checkAndChargeUsage } from "../billing.server";
import { generateContentSafe } from "../gemini.server";
import { FREE_PLAN, PLAN_CONFIG } from "../constants";

function sanitizeHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "");
}

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
          id title productType vendor tags descriptionHtml
          featuredImage { url altText }
          variants(first: 10) { nodes { title price availableForSale } }
        }
      }
    }`
  );
  const responseJson = await response.json();
  const allProducts = responseJson.data.products.nodes;

  const totalPages = Math.ceil(allProducts.length / perPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * perPage;
  const paginatedProducts = allProducts.slice(startIdx, startIdx + perPage);

  const usage = await prisma.usageStat.findUnique({ where: { shop: session.shop } });
  const planName = usage?.planName || FREE_PLAN;
  const planConfig = PLAN_CONFIG[planName] || PLAN_CONFIG[FREE_PLAN];

  let settings = null;
  try {
    settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  } catch (_) {}

  return json({
    allProducts,
    products: paginatedProducts,
    credits: usage?.credits || 0,
    usageCount: usage?.monthlyUsageCount || 0,
    planName,
    totalCredits: planConfig.credits,
    settings: settings || { defaultTone: "professional", defaultLang: "English", defaultLen: "short" },
    pagination: { currentPage, totalPages, totalProducts: allProducts.length, perPage },
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const productId = formData.get("productId");

  if (intent === "fetch") {
    const response = await admin.graphql(
      `#graphql
      query getProductDescription($id: ID!) {
        product(id: $id) {
          title productType vendor tags descriptionHtml
          variants(first: 10) { nodes { title price availableForSale } }
        }
      }`,
      { variables: { id: productId } }
    );
    const responseJson = await response.json();
    const p = responseJson.data.product;
    return json({
      productTitle: p.title,
      productType: p.productType || "",
      vendor: p.vendor || "",
      tags: (p.tags || []).join(", "),
      variants: (p.variants?.nodes || []).map(v => v.title).join(", "),
      originalDescription: p.descriptionHtml,
    });
  }

  if (intent === "rewrite") {
    const productDescription = formData.get("productDescription");
    const tone               = formData.get("tone");
    const language           = formData.get("language") || "English";
    const productTitle       = formData.get("productTitle");

    let brandVoiceContext = "";
    try {
      const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
      if (settings?.brandVoicePrompt) brandVoiceContext = `Brand Voice Guide:\n${settings.brandVoicePrompt}\n\n`;
    } catch (_) {}

    let prompt = `${brandVoiceContext}Rewrite this Shopify product description for ${productTitle} in ${language} using a ${tone} tone.\nOriginal: ${productDescription}`;

    try {
      await checkAndChargeUsage(admin, session.shop, 1);
      await prisma.usageStat.upsert({
        where: { shop: session.shop },
        update: { descriptionsGenerated: { increment: 1 } },
        create: { shop: session.shop, descriptionsGenerated: 1 }
      });
      const text = await generateContentSafe(prompt);
      return json({ rewritten: text });
    } catch (error) {
      return json({ error: error.message }, { status: 500 });
    }
  }

  if (intent === "save") {
    const newDescription = formData.get("newDescription");
    await admin.graphql(
      `#graphql
      mutation updateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: productId, descriptionHtml: newDescription } } }
    );
    return json({ success: true, newDescription });
  }

  return null;
};

const TONE_OPTIONS = [
  { label: 'Professional', value: 'professional' },
  { label: 'Simple', value: 'simple' },
  { label: 'Premium', value: 'premium' },
  { label: 'Persuasive', value: 'persuasive' },
  { label: 'Witty', value: 'witty' },
];

export default function Descriptions() {
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const { planName, usageCount, totalCredits } = loaderData || {};
  const progress = totalCredits === 999999 ? 100 : Math.min(100, (usageCount / (totalCredits || 1)) * 100);

  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewrittenDescription, setRewrittenDescription] = useState("");
  const [tone, setTone] = useState(loaderData?.settings?.defaultTone || "professional");
  const [language, setLanguage] = useState("English");

  const isLoading = navigation.state === "submitting";

  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(loaderData?.allProducts || []);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.productTitle) {
      setDescription(actionData.originalDescription || "");
      setProductTitle(actionData.productTitle);
    }
    if (actionData.rewritten) setRewrittenDescription(sanitizeHtml(actionData.rewritten));
    if (actionData.success) {
      setRewrittenDescription("");
      if (actionData.newDescription) setDescription(actionData.newDescription);
      shopify.toast.show("Saved successfully");
    }
    if (actionData.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  const handleStartSingle = (product) => {
    setProductId(product.id);
    const formData = new FormData();
    formData.append("intent", "fetch");
    formData.append("productId", product.id);
    submit(formData, { method: "post" });
  };

  const handleRewrite = () => {
    const formData = new FormData();
    formData.append("intent", "rewrite");
    formData.append("productId", productId);
    formData.append("productDescription", description);
    formData.append("productTitle", productTitle);
    formData.append("tone", tone);
    formData.append("language", language);
    submit(formData, { method: "post" });
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("productId", productId);
    formData.append("newDescription", rewrittenDescription);
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="AI Product Description Improver">
        <InlineStack gap="300" align="end" blockAlign="center">
          <Box paddingInlineEnd="300">
            <BlockStack gap="100" align="end">
              <InlineStack gap="100">
                <Text variant="bodySm" tone="subdued">Credits:</Text>
                <Text variant="bodySm" fontWeight="bold">{usageCount} / {totalCredits === 999999 ? "Unlimited" : totalCredits}</Text>
              </InlineStack>
              <div style={{ width: '100px' }}>
                <ProgressBar progress={progress} tone={progress > 90 ? "critical" : "primary"} size="small" />
              </div>
            </BlockStack>
          </Box>
          <Button onClick={() => navigate("/app/plans")} icon={StarIcon} size="slim">Upgrade</Button>
        </InlineStack>
      </TitleBar>
      <BlockStack gap="500">
          {productId ? (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Button icon={ArrowLeftIcon} onClick={() => setProductId("")} accessibilityLabel="Back" />
                        <Text as="h2" variant="headingMd">Editing: {productTitle}</Text>
                      </InlineStack>
                    </InlineStack>
                    <TextField label="Original Description (HTML)" value={description} onChange={setDescription} multiline={6} autoComplete="off" />
                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}><Select label="Tone" options={TONE_OPTIONS} onChange={setTone} value={tone} /></div>
                    </InlineStack>
                    <Button variant="primary" onClick={handleRewrite} loading={isLoading && navigation.formData?.get("intent") === "rewrite"}>Rewrite Description</Button>
                    {rewrittenDescription && (
                      <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="400">
                          <div dangerouslySetInnerHTML={{ __html: rewrittenDescription }} />
                          <InlineStack align="end">
                            <Button variant="primary" onClick={handleSave} loading={isLoading && navigation.formData?.get("intent") === "save"}>Save to Shopify</Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          ) : (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Select Products</Text>
                    <IndexTable
                      resourceName={{ singular: "product", plural: "products" }}
                      itemCount={(loaderData?.products || []).length}
                      selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                      onSelectionChange={handleSelectionChange}
                      headings={[{ title: "Image" }, { title: "Product" }, { title: "Action" }]}
                      promotedBulkActions={[{ content: "Edit Selected", onAction: () => navigate("/app/plans"), disabled: planName !== "Elite (Scale)" }]}
                    >
                      {(loaderData?.products || []).map((product, index) => (
                        <IndexTable.Row id={product.id} key={product.id} selected={selectedResources.includes(product.id)} position={index}>
                          <IndexTable.Cell>
                            {product.featuredImage?.url && <Thumbnail source={product.featuredImage.url} alt={product.title} size="small" />}
                          </IndexTable.Cell>
                          <IndexTable.Cell><Text fontWeight="bold">{product.title}</Text></IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button 
                              size="slim" 
                              onClick={() => handleStartSingle(product)}
                              loading={isLoading && navigation.formData?.get("productId") === product.id && navigation.formData?.get("intent") === "fetch"}
                            >
                              Edit
                            </Button>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}
      </BlockStack>
    </Page>
  );
}
