import { useState, useEffect, useCallback } from "react";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Text, Card, Button, BlockStack, Box, TextField,
  Select, Banner, InlineStack, IndexTable, Modal, Thumbnail,
  useIndexResourceState, Badge, Divider, Tooltip, ProgressBar
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { ArrowLeftIcon, EditIcon, ClockIcon, RefreshIcon, StarIcon } from "@shopify/polaris-icons";
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

  if (intent === "fetch_history") {
    try {
      const history = await prisma.descriptionHistory.findMany({
        where: { shop: session.shop, productId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return json({ history });
    } catch (_) {
      return json({ history: [] });
    }
  }

  if (intent === "fetch_multiple") {
    const productIds = JSON.parse(formData.get("productIds"));
    const response = await admin.graphql(
      `#graphql
      query getProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id title productType vendor tags descriptionHtml
            variants(first: 10) { nodes { title } }
          }
        }
      }`,
      { variables: { ids: productIds } }
    );
    const responseJson = await response.json();
    const products = responseJson.data.nodes.map(p => ({
      id: p.id,
      title: p.title,
      productType: p.productType || "",
      vendor: p.vendor || "",
      tags: (p.tags || []).join(", "),
      variants: (p.variants?.nodes || []).map(v => v.title).join(", "),
      originalDescription: p.descriptionHtml,
      rewrittenDescription: "",
      status: "idle",
    }));
    return json({ products });
  }

  if (intent === "rewrite") {
    const productDescription = formData.get("productDescription");
    const productTitle       = formData.get("productTitle");
    const tone               = formData.get("tone");
    const length             = formData.get("length");
    const language           = formData.get("language") || "English";
    const customInstructions = formData.get("customInstructions") || "";
    const productType        = formData.get("productType") || "";
    const vendor             = formData.get("vendor") || "";
    const tags               = formData.get("tags") || "";
    const variants           = formData.get("variants") || "";

    let brandVoiceContext = "";
    try {
      const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
      if (settings?.brandVoicePrompt) brandVoiceContext = `Brand Voice Guide:\n${settings.brandVoicePrompt}\n\n`;
    } catch (_) {}

    const toneRules = `Tone Rules:\n- simple: Easy language, Short sentences\n- premium: Polished, Elegant\n- professional: Formal, Trustworthy\n- persuasive: Compelling\n- witty: Fun, Clever\n- luxury: Exclusive\n- minimalist: Direct\n- storytelling: Narrative`;
    const lengthRules = `Length Rules:\n- short: ~50 words\n- long: ~150 words`;

    const cleanDescription = productDescription ? productDescription.replace(/<[^>]*>/g, '').trim() : "";
    const isDescriptionEmpty = cleanDescription.length < 5;

    let prompt = "";
    if (isDescriptionEmpty) {
      prompt = `${brandVoiceContext}Product Title: ${productTitle}\nTone: ${tone}\nLength: ${length}\nReturn HTML description in ${language}.`;
    } else {
      prompt = `${brandVoiceContext}Original Description: ${productDescription}\nTone: ${tone}\nLength: ${length}\nRewrite HTML in ${language}.`;
    }

    try {
      await checkAndChargeUsage(admin, session.shop, 1);
      await prisma.usageStat.upsert({
        where: { shop: session.shop },
        update: { descriptionsGenerated: { increment: 1 } },
        create: { shop: session.shop, descriptionsGenerated: 1 }
      });
      const text = await generateContentSafe(prompt);
      if (productId) {
        await prisma.descriptionHistory.create({
          data: { shop: session.shop, productId, productTitle: productTitle || "", content: text, tone: tone || "", language }
        });
      }
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

  if (intent === "save_settings") {
    const defaultTone = formData.get("defaultTone");
    const defaultLang = formData.get("defaultLang");
    const defaultLen  = formData.get("defaultLen");
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { defaultTone, defaultLang, defaultLen },
      create: { shop: session.shop, defaultTone, defaultLang, defaultLen }
    });
    return json({ settingsSaved: true });
  }

  return null;
};

const TONE_OPTIONS = [
  { label: 'Professional', value: 'professional' },
  { label: 'Simple', value: 'simple' },
  { label: 'Premium', value: 'premium' },
  { label: 'Persuasive', value: 'persuasive' },
  { label: 'Witty', value: 'witty' },
  { label: 'luxury', value: 'luxury' },
  { label: 'Minimalist', value: 'minimalist' },
  { label: 'Storytelling', value: 'storytelling' },
];
const LENGTH_OPTIONS = [{ label: 'Short', value: 'short' }, { label: 'Long', value: 'long' }];
const LANGUAGE_OPTIONS = [{ label: 'English', value: 'English' }, { label: 'Spanish', value: 'Spanish' }, { label: 'French', value: 'French' }];

const RATE_LIMIT_DELAY = 3500;

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
  const [productType, setProductType] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [variants, setVariants] = useState("");
  const [description, setDescription] = useState("");
  const [rewrittenDescription, setRewrittenDescription] = useState("");
  const [tone, setTone] = useState(loaderData?.settings?.defaultTone || "professional");
  const [length, setLength] = useState(loaderData?.settings?.defaultLen || "short");
  const [language, setLanguage] = useState(loaderData?.settings?.defaultLang || "English");
  const [customInstructions, setCustomInstructions] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [modalDescription, setModalDescription] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const isLoading = navigation.state === "submitting";

  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(loaderData?.allProducts || []);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.productTitle) {
      setDescription(actionData.originalDescription);
      setProductTitle(actionData.productTitle);
      setProductType(actionData.productType);
      setVendor(actionData.vendor);
      setTags(actionData.tags);
      setVariants(actionData.variants);
    }
    if (actionData.rewritten) setRewrittenDescription(sanitizeHtml(actionData.rewritten));
    if (actionData.success) {
      setRewrittenDescription("");
      if (actionData.newDescription) setDescription(actionData.newDescription);
    }
    if (actionData.history) {
      setHistory(actionData.history);
      setHistoryModalOpen(true);
    }
    if (actionData.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  const handleStartSingle = (product) => {
    setProductId(product.id);
    setProductTitle(product.title);
    setProductType(product.productType || "");
    setVendor(product.vendor || "");
    setTags((product.tags || []).join(", "));
    setVariants((product.variants?.nodes || []).map(v => v.title).join(", "));
    setDescription(product.descriptionHtml || "");
    setRewrittenDescription("");
  };

  const handleStartBulk = () => {
    if (planName !== "Elite (Scale)") {
      shopify.toast.show("Bulk editing is an Elite plan feature.", { isError: true });
      return;
    }
    const selected = (loaderData?.allProducts || []).filter(p => selectedResources.includes(p.id));
    setSelectedProducts(selected.map(p => ({
      id: p.id, title: p.title, productType: p.productType || "", vendor: p.vendor || "",
      originalDescription: p.descriptionHtml, newDescription: "", status: "idle",
    })));
    setIsBulkMode(true);
  };

  const handleRewrite = () => {
    const formData = new FormData();
    formData.append("intent", "rewrite");
    formData.append("productId", productId);
    formData.append("productDescription", description);
    formData.append("productTitle", productTitle);
    formData.append("tone", tone);
    formData.append("length", length);
    formData.append("language", language);
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
                <Text variant="bodySm" fontWeight="bold">{`${usageCount} / ${totalCredits === 999999 ? 'Unlimited' : totalCredits}`}</Text>
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
        <Layout>
          {isBulkMode ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="start" blockAlign="center" gap="300">
                    <Button icon={ArrowLeftIcon} onClick={() => setIsBulkMode(false)} accessibilityLabel="Back" />
                    <Text as="h2" variant="headingMd">Bulk Editor ({selectedProducts.length} products)</Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          ) : productId ? (
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
                    <div style={{ flex: 1 }}><Select label="Length" options={LENGTH_OPTIONS} onChange={setLength} value={length} /></div>
                  </InlineStack>
                  <Button variant="primary" onClick={handleRewrite} loading={isLoading}>Rewrite Description</Button>
                  {rewrittenDescription && (
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                      <div dangerouslySetInnerHTML={{ __html: rewrittenDescription }} />
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          ) : (
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
                    promotedBulkActions={[{ content: "Edit Selected", onAction: handleStartBulk, disabled: planName !== "Elite (Scale)" }]}
                  >
                    {(loaderData?.products || []).map((product, index) => (
                      <IndexTable.Row id={product.id} key={product.id} selected={selectedResources.includes(product.id)} position={index}>
                        <IndexTable.Cell>
                          {product.featuredImage?.url && <Thumbnail source={product.featuredImage.url} alt={product.title} size="small" />}
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text fontWeight="bold">{product.title}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Button size="slim" onClick={() => handleStartSingle(product)}>Edit</Button></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
