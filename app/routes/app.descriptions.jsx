import { useState, useEffect, useCallback } from "react";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Text, Card, Button, BlockStack, Box, TextField,
  Select, Banner, InlineStack, IndexTable, Modal, Thumbnail,
  useIndexResourceState, Badge, Divider, Tooltip
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { ArrowLeftIcon, EditIcon, ClockIcon, RefreshIcon } from "@shopify/polaris-icons";
import prisma from "../db.server";
import { checkAndChargeUsage } from "../billing.server";
import { generateContentSafe } from "../gemini.server";

// ─── Sanitize HTML (strip script/on* — no external lib needed server-side) ───
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
          id
          title
          productType
          vendor
          tags
          descriptionHtml
          featuredImage { url altText }
          variants(first: 10) {
            nodes { title price availableForSale }
          }
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

  // Load shop settings (defaults)
  let settings = null;
  try {
    settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  } catch (_) {}

  return json({
    products: paginatedProducts,
    credits: usage?.credits || 0,
    settings: settings || { defaultTone: "professional", defaultLang: "English", defaultLen: "short" },
    pagination: {
      currentPage,
      totalPages,
      totalProducts: allProducts.length,
      perPage,
    },
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const productId = formData.get("productId");

  // ── fetch single product ──────────────────────────────────────────────────
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

  // ── fetch description history ────────────────────────────────────────────
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

  // ── fetch multiple products for bulk mode ─────────────────────────────────
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

  // ── rewrite (single via form submit — bulk uses fetch API) ────────────────
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

    const toneRules = `Tone Rules:
- simple: Easy language, Short sentences
- premium: Polished, Elegant
- indian audience: Friendly, Practical, No Western slang
- professional: Formal, Trustworthy, Expert
- persuasive: Compelling, Action-oriented, Benefit-focused
- witty: Fun, Engaging, Clever, Light-hearted
- luxury: Exclusive, Sophisticated, High-end vocabulary
- minimalist: Direct, Clean, No fluff
- storytelling: Narrative, Emotional connection, Descriptive`;

    const lengthRules = `Length Rules:
- short: Concise, ~50 words
- long: Detailed, ~150 words`;

    const cleanDescription = productDescription ? productDescription.replace(/<[^>]*>/g, '').trim() : "";
    const isDescriptionEmpty = cleanDescription.length < 5;

    let prompt = "";
    if (isDescriptionEmpty) {
      if (!productTitle) return json({ error: "Product title is required." }, { status: 400 });
      prompt = `${brandVoiceContext}You are a Shopify AI Product Description Generator.

Product Title: ${productTitle}
${productType ? `Product Type: ${productType}` : ""}
${vendor ? `Brand/Vendor: ${vendor}` : ""}
${tags ? `Tags: ${tags}` : ""}
${variants ? `Available Variants: ${variants}` : ""}
Tone: ${tone}
Length: ${length}
Language: ${language}
${customInstructions ? `Custom Instructions: ${customInstructions}` : ""}

Rules:
- Create a compelling description from the title and context.
- Do NOT hallucinate specific specs.
- Output MUST be valid HTML. No emojis.
${customInstructions ? `- IMPORTANT: ${customInstructions}` : ""}

${toneRules}
${lengthRules}

Return ONLY the HTML description in ${language}.`;
    } else {
      prompt = `${brandVoiceContext}You are a Shopify AI Product Description Improver.

Product Title: ${productTitle}
${productType ? `Product Type: ${productType}` : ""}
${vendor ? `Brand/Vendor: ${vendor}` : ""}
${tags ? `Tags: ${tags}` : ""}
${variants ? `Available Variants: ${variants}` : ""}

Original Description (HTML):
${productDescription}

Tone: ${tone}
Length: ${length}
Language: ${language}
${customInstructions ? `Custom Instructions: ${customInstructions}` : ""}

Rules:
- Preserve all factual information.
- Improve clarity, readability, and flow. Fix grammar.
- Input is HTML — output MUST be valid HTML. No emojis.
${customInstructions ? `- IMPORTANT: ${customInstructions}` : ""}

${toneRules}
${lengthRules}

Return ONLY the rewritten HTML in ${language}.`;
    }

    try {
      await checkAndChargeUsage(admin, session.shop, 1);
      try {
        await prisma.usageStat.upsert({
          where: { shop: session.shop },
          update: { descriptionsGenerated: { increment: 1 } },
          create: { shop: session.shop, descriptionsGenerated: 1 }
        });
      } catch (err) { console.error("Stats update failed:", err); }

      const text = await generateContentSafe(prompt);

      // Save to history
      if (productId) {
        try {
          await prisma.descriptionHistory.create({
            data: { shop: session.shop, productId, productTitle: productTitle || "", content: text, tone: tone || "", language }
          });
          const all = await prisma.descriptionHistory.findMany({
            where: { shop: session.shop, productId }, orderBy: { createdAt: "desc" }, select: { id: true }
          });
          if (all.length > 10) {
            await prisma.descriptionHistory.deleteMany({ where: { id: { in: all.slice(10).map(r => r.id) } } });
          }
        } catch (err) { console.error("History save failed:", err); }
      }

      return json({ rewritten: text });
    } catch (error) {
      console.error("Gemini error:", error);
      if (error.status === 402 || error.message?.includes("No active billing")) return json({ error: error.message }, { status: 402 });
      if (error.status === 429 || error.message?.includes("429")) return json({ error: "AI rate limit reached. Please wait and try again." }, { status: 429 });
      return json({ error: `Failed to generate: ${error.message}` }, { status: 500 });
    }
  }

  // ── save description ──────────────────────────────────────────────────────
  if (intent === "save") {
    const newDescription = formData.get("newDescription");
    const response = await admin.graphql(
      `#graphql
      mutation updateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: productId, descriptionHtml: newDescription } } }
    );
    const responseJson = await response.json();
    if (responseJson.data.productUpdate.userErrors.length > 0) {
      return json({ error: responseJson.data.productUpdate.userErrors[0].message }, { status: 400 });
    }
    return json({ success: true, newDescription });
  }

  // ── save shop settings / defaults ─────────────────────────────────────────
  if (intent === "save_settings") {
    const defaultTone = formData.get("defaultTone");
    const defaultLang = formData.get("defaultLang");
    const defaultLen  = formData.get("defaultLen");
    try {
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { defaultTone, defaultLang, defaultLen, updatedAt: new Date() },
        create: { shop: session.shop, defaultTone, defaultLang, defaultLen, updatedAt: new Date() }
      });
      return json({ settingsSaved: true });
    } catch (err) {
      return json({ error: "Failed to save settings." }, { status: 500 });
    }
  }

  return null;
};

// ─── Tone / length / language options ────────────────────────────────────────
const TONE_OPTIONS = [
  { label: 'Simple',          value: 'simple' },
  { label: 'Premium',         value: 'premium' },
  { label: 'Indian Audience', value: 'indian audience' },
  { label: 'Professional',    value: 'professional' },
  { label: 'Persuasive',      value: 'persuasive' },
  { label: 'Witty',           value: 'witty' },
  { label: 'Luxury',          value: 'luxury' },
  { label: 'Minimalist',      value: 'minimalist' },
  { label: 'Storytelling',    value: 'storytelling' },
];
const LENGTH_OPTIONS = [
  { label: 'Short (~50 words)',  value: 'short' },
  { label: 'Long (~150 words)',  value: 'long' },
];
const LANGUAGE_OPTIONS = [
  { label: 'English',    value: 'English' },
  { label: 'Spanish',    value: 'Spanish' },
  { label: 'French',     value: 'French' },
  { label: 'German',     value: 'German' },
  { label: 'Italian',    value: 'Italian' },
  { label: 'Portuguese', value: 'Portuguese' },
  { label: 'Hindi',      value: 'Hindi' },
  { label: 'Chinese',    value: 'Chinese' },
  { label: 'Japanese',   value: 'Japanese' },
];

const RATE_LIMIT_DELAY = 3500;

export default function Descriptions() {
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const fetchedProducts = loaderData?.products || [];
  const settings = loaderData?.settings || {};

  // ── single-product state ──────────────────────────────────────────────────
  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [productType, setProductType] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [variants, setVariants] = useState("");
  const [description, setDescription] = useState("");
  const [rewrittenDescription, setRewrittenDescription] = useState("");

  // ── tone / length / language ──────────────────────────────────────────────
  const [tone, setTone] = useState(settings.defaultTone || "professional");
  const [length, setLength] = useState(settings.defaultLen || "short");
  const [language, setLanguage] = useState(settings.defaultLang || "English");
  const [customInstructions, setCustomInstructions] = useState("");

  // ── bulk state ────────────────────────────────────────────────────────────
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // ── history ───────────────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // ── modal ─────────────────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [modalDescription, setModalDescription] = useState("");

  const isLoading = navigation.state === "submitting";

  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(fetchedProducts);

  // ── action data handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (!actionData) return;

    if (actionData.originalDescription !== undefined) {
      setDescription(actionData.originalDescription);
      setProductTitle(actionData.productTitle || "");
      setProductType(actionData.productType || "");
      setVendor(actionData.vendor || "");
      setTags(actionData.tags || "");
      setVariants(actionData.variants || "");
      shopify.toast.show("Product loaded");
    }
    if (actionData.products) {
      setSelectedProducts(actionData.products);
      setIsBulkMode(true);
      shopify.toast.show(`${actionData.products.length} products loaded`);
    }
    if (actionData.rewritten) {
      setRewrittenDescription(sanitizeHtml(actionData.rewritten));
    }
    if (actionData.success) {
      shopify.toast.show("Product updated successfully");
      setRewrittenDescription("");
      if (actionData.newDescription) setDescription(actionData.newDescription);
    }
    if (actionData.settingsSaved) {
      shopify.toast.show("Defaults saved");
    }
    if (actionData.history) {
      setHistory(actionData.history);
      setHistoryModalOpen(true);
    }
    if (actionData.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  // ── helpers ───────────────────────────────────────────────────────────────
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
    const selected = fetchedProducts.filter(p => selectedResources.includes(p.id));
    setSelectedProducts(selected.map(p => ({
      id: p.id, title: p.title,
      productType: p.productType || "", vendor: p.vendor || "",
      tags: (p.tags || []).join(", "),
      variants: (p.variants?.nodes || []).map(v => v.title).join(", "),
      originalDescription: p.descriptionHtml,
      newDescription: "", status: "idle",
    })));
    setIsBulkMode(true);
  };

  const handleRewrite = () => {
    const formData = new FormData();
    formData.append("intent", "rewrite");
    formData.append("productId", productId);
    formData.append("productDescription", description);
    formData.append("productTitle", productTitle);
    formData.append("productType", productType);
    formData.append("vendor", vendor);
    formData.append("tags", tags);
    formData.append("variants", variants);
    formData.append("tone", tone);
    formData.append("length", length);
    formData.append("language", language);
    formData.append("customInstructions", customInstructions);
    submit(formData, { method: "post" });
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("productId", productId);
    formData.append("newDescription", rewrittenDescription);
    submit(formData, { method: "post" });
  };

  const handleBack = () => {
    setProductId(""); setProductTitle(""); setDescription(""); setRewrittenDescription("");
    setProductType(""); setVendor(""); setTags(""); setVariants("");
  };

  const handleFetchHistory = () => {
    const formData = new FormData();
    formData.append("intent", "fetch_history");
    formData.append("productId", productId);
    submit(formData, { method: "post" });
  };

  const handleRestoreHistory = (content) => {
    setRewrittenDescription(sanitizeHtml(content));
    setHistoryModalOpen(false);
    shopify.toast.show("Version restored — review and save when ready");
  };

  const handleSaveSettings = () => {
    const formData = new FormData();
    formData.append("intent", "save_settings");
    formData.append("defaultTone", tone);
    formData.append("defaultLang", language);
    formData.append("defaultLen", length);
    submit(formData, { method: "post" });
  };

  // ── bulk generate ─────────────────────────────────────────────────────────
  const handleBulkGenerate = async () => {
    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    let done = 0;
    for (const product of selectedProducts) {
      setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: "generating…" } : p));
      const formData = new FormData();
      formData.append("intent", "rewrite");
      formData.append("productId", product.id);
      formData.append("productTitle", product.title);
      formData.append("productDescription", product.originalDescription || "");
      formData.append("productType", product.productType || "");
      formData.append("vendor", product.vendor || "");
      formData.append("tags", product.tags || "");
      formData.append("variants", product.variants || "");
      formData.append("tone", tone);
      formData.append("length", length);
      formData.append("language", language);
      formData.append("customInstructions", customInstructions);

      try {
        const response = await fetch("/app/api/generate", { method: "POST", body: formData, credentials: "same-origin" });
        const data = await response.json();
        if (data.rewritten) {
          setSelectedProducts(prev => prev.map(p =>
            p.id === product.id ? { ...p, status: "ready to save", newDescription: sanitizeHtml(data.rewritten) } : p
          ));
        } else {
          setSelectedProducts(prev => prev.map(p =>
            p.id === product.id ? { ...p, status: "failed: " + (data.error || "unknown error") } : p
          ));
        }
      } catch (e) {
        setSelectedProducts(prev => prev.map(p =>
          p.id === product.id ? { ...p, status: "failed: " + e.message } : p
        ));
      }
      done++;
      setBulkProgress(Math.round((done / selectedProducts.length) * 100));
      await delay(RATE_LIMIT_DELAY);
    }
  };

  // ── bulk save ─────────────────────────────────────────────────────────────
  const handleBulkSave = async () => {
    for (const product of selectedProducts) {
      if ((product.status === "ready to save" || product.status === "edited") && product.newDescription) {
        setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: "saving…" } : p));
        const formData = new FormData();
        formData.append("intent", "save");
        formData.append("productId", product.id);
        formData.append("newDescription", product.newDescription);
        try {
          const response = await fetch("/app/api/save", { method: "POST", body: formData, credentials: "same-origin" });
          const data = await response.json();
          setSelectedProducts(prev => prev.map(p =>
            p.id === product.id
              ? { ...p, status: data.success ? "saved ✓" : "save error: " + (data.error || "unknown"), originalDescription: data.success ? product.newDescription : p.originalDescription }
              : p
          ));
        } catch (e) {
          setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: "save error: " + e.message } : p));
        }
      }
    }
  };

  const handleEditClick = (product, field) => {
    setEditingProduct(product);
    setEditingField(field);
    setModalDescription(field === "original" ? (product.originalDescription || "") : (product.newDescription || ""));
    setActiveModal(true);
  };

  const handleModalSave = () => {
    if (editingProduct && editingField) {
      setSelectedProducts(prev => prev.map(p => {
        if (p.id !== editingProduct.id) return p;
        return editingField === "original"
          ? { ...p, originalDescription: modalDescription }
          : { ...p, newDescription: modalDescription, status: "edited" };
      }));
    }
    setActiveModal(false);
  };

  const statusBadge = (status) => {
    if (!status || status === "idle") return <Badge>Idle</Badge>;
    if (status.startsWith("generating")) return <Badge tone="info">Generating…</Badge>;
    if (status === "ready to save") return <Badge tone="warning">Ready to save</Badge>;
    if (status === "edited") return <Badge tone="warning">Edited</Badge>;
    if (status.includes("saving")) return <Badge tone="info">Saving…</Badge>;
    if (status.startsWith("saved")) return <Badge tone="success">Saved</Badge>;
    if (status.startsWith("failed") || status.startsWith("save error")) return <Badge tone="critical">Error</Badge>;
    return <Badge>{status}</Badge>;
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Page>
      <TitleBar title="AI Product Description Improver" />
      <BlockStack gap="500">
        <Layout>
          {/* ── BULK MODE ── */}
          {isBulkMode ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Button icon={ArrowLeftIcon} onClick={() => { setIsBulkMode(false); setSelectedProducts([]); setBulkProgress(0); }} accessibilityLabel="Back" />
                      <Text as="h2" variant="headingMd">Bulk Editor ({selectedProducts.length} products)</Text>
                    </InlineStack>
                  </InlineStack>

                  <InlineStack gap="300">
                    <div style={{ flex: 1 }}><Select label="Tone" options={TONE_OPTIONS} onChange={setTone} value={tone} /></div>
                    <div style={{ flex: 1 }}><Select label="Length" options={LENGTH_OPTIONS} onChange={setLength} value={length} /></div>
                    <div style={{ flex: 1 }}><Select label="Language" options={LANGUAGE_OPTIONS} onChange={setLanguage} value={language} /></div>
                  </InlineStack>

                  <TextField
                    label="Custom Instructions / Keywords"
                    value={customInstructions}
                    onChange={setCustomInstructions}
                    placeholder="e.g. Mention eco-friendly materials, target Gen Z…"
                    autoComplete="off"
                  />

                  {bulkProgress > 0 && bulkProgress < 100 && (
                    <Box>
                      <Text variant="bodySm" tone="subdued">Generating… {bulkProgress}%</Text>
                      <div style={{ background: "var(--p-color-border)", borderRadius: "4px", height: "6px", marginTop: "6px" }}>
                        <div style={{ background: "var(--p-color-text-interactive)", height: "6px", borderRadius: "4px", width: `${bulkProgress}%`, transition: "width 0.3s" }} />
                      </div>
                    </Box>
                  )}

                  <IndexTable
                    resourceName={{ singular: "product", plural: "products" }}
                    itemCount={selectedProducts.length}
                    headings={[{ title: "Product" }, { title: "Original" }, { title: "New Description" }, { title: "Status" }]}
                    selectable={false}
                  >
                    {selectedProducts.map((product, index) => (
                      <IndexTable.Row id={product.id} key={product.id} position={index}>
                        <IndexTable.Cell>
                          <Text fontWeight="bold" as="span">{product.title}</Text>
                          {product.productType && <Text as="span" variant="bodySm" tone="subdued"> · {product.productType}</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" align="start" blockAlign="center">
                            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--p-color-text-subdued)" }}>
                              {product.originalDescription
                                ? product.originalDescription.replace(/<[^>]*>/g, '').substring(0, 30) + "…"
                                : "Empty"}
                            </span>
                            <Button icon={EditIcon} variant="plain" onClick={() => handleEditClick(product, "original")} accessibilityLabel="Edit original" />
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" align="start" blockAlign="center">
                            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--p-color-text-subdued)" }}>
                              {product.newDescription ? product.newDescription.replace(/<[^>]*>/g, '').substring(0, 30) + "…" : "—"}
                            </span>
                            {product.newDescription && (
                              <Button icon={EditIcon} variant="plain" onClick={() => handleEditClick(product, "new")} accessibilityLabel="Edit new" />
                            )}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{statusBadge(product.status)}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

                  <Modal
                    open={activeModal}
                    onClose={() => setActiveModal(false)}
                    title={`Edit ${editingField === "original" ? "Original" : "New"} Description: ${editingProduct?.title}`}
                    primaryAction={{ content: "Save", onAction: handleModalSave }}
                    secondaryActions={[{ content: "Cancel", onAction: () => setActiveModal(false) }]}
                  >
                    <Modal.Section>
                      <TextField label="Description (HTML)" value={modalDescription} onChange={setModalDescription} multiline={10} autoComplete="off" />
                    </Modal.Section>
                  </Modal>

                  <InlineStack align="end" gap="300">
                    <Button
                      variant="primary"
                      disabled={selectedProducts.some(p => p.status === "generating…")}
                      onClick={handleBulkGenerate}
                    >
                      Generate All
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!selectedProducts.some(p => p.status === "ready to save" || p.status === "edited")}
                      onClick={handleBulkSave}
                    >
                      Save All
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

          /* ── SINGLE PRODUCT MODE ── */
          ) : productId ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Button icon={ArrowLeftIcon} onClick={handleBack} accessibilityLabel="Back" />
                      <Text as="h2" variant="headingMd">Editing: {productTitle}</Text>
                    </InlineStack>
                    <Tooltip content="View version history">
                      <Button icon={ClockIcon} onClick={handleFetchHistory} loading={isLoading && !rewrittenDescription}>
                        History
                      </Button>
                    </Tooltip>
                  </InlineStack>

                  {/* Product context info */}
                  {(productType || vendor || tags) && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <InlineStack gap="400" wrap>
                        {productType && <Text variant="bodySm" tone="subdued">Type: <strong>{productType}</strong></Text>}
                        {vendor && <Text variant="bodySm" tone="subdued">Brand: <strong>{vendor}</strong></Text>}
                        {tags && <Text variant="bodySm" tone="subdued">Tags: <strong>{tags}</strong></Text>}
                        {variants && <Text variant="bodySm" tone="subdued">Variants: <strong>{variants}</strong></Text>}
                      </InlineStack>
                    </Box>
                  )}

                  <TextField
                    label="Original Description (HTML)"
                    value={description}
                    onChange={setDescription}
                    multiline={6}
                    autoComplete="off"
                    helpText="You can edit this before rewriting."
                  />

                  <InlineStack gap="300">
                    <div style={{ flex: 1 }}><Select label="Tone" options={TONE_OPTIONS} onChange={setTone} value={tone} /></div>
                    <div style={{ flex: 1 }}><Select label="Length" options={LENGTH_OPTIONS} onChange={setLength} value={length} /></div>
                    <div style={{ flex: 1 }}><Select label="Language" options={LANGUAGE_OPTIONS} onChange={setLanguage} value={language} /></div>
                  </InlineStack>

                  <TextField
                    label="Custom Instructions / Keywords"
                    value={customInstructions}
                    onChange={setCustomInstructions}
                    placeholder="e.g. Mention eco-friendly materials, target Gen Z…"
                    autoComplete="off"
                  />

                  <InlineStack align="space-between">
                    <Tooltip content="Save current tone/language/length as your store defaults">
                      <Button onClick={handleSaveSettings} loading={isLoading} plain>Save as defaults</Button>
                    </Tooltip>
                    <Button
                      variant="primary"
                      onClick={handleRewrite}
                      loading={isLoading && !rewrittenDescription}
                      disabled={!productId}
                    >
                      {description && description.replace(/<[^>]*>/g, '').trim().length > 5
                        ? "Rewrite Description"
                        : "Generate Description"}
                    </Button>
                  </InlineStack>

                  {actionData?.error && (
                    <Banner tone="critical" title="Error"><p>{actionData.error}</p></Banner>
                  )}

                  {rewrittenDescription && (
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200" borderWidth="025" borderColor="border">
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingSm" fontWeight="bold">Improved Description Preview</Text>
                        <div
                          style={{ maxHeight: 300, overflowY: "auto", background: "white", padding: 10, borderRadius: 4 }}
                          dangerouslySetInnerHTML={{ __html: rewrittenDescription }}
                        />
                        <InlineStack align="end" gap="300">
                          <Button disabled={isLoading} onClick={() => setRewrittenDescription("")}>Discard</Button>
                          <Button variant="primary" onClick={handleSave} loading={isLoading}>Save to Product</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>

              {/* ── History modal ── */}
              <Modal
                open={historyModalOpen}
                onClose={() => setHistoryModalOpen(false)}
                title={`Version History: ${productTitle}`}
              >
                <Modal.Section>
                  {history.length === 0 ? (
                    <Text tone="subdued">No previous versions found for this product.</Text>
                  ) : (
                    <BlockStack gap="300">
                      {history.map((entry, i) => (
                        <Box key={entry.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text variant="bodySm" tone="subdued">
                                {new Date(entry.createdAt).toLocaleString()} · {entry.tone} · {entry.language}
                              </Text>
                              <Button size="slim" onClick={() => handleRestoreHistory(entry.content)}>Restore</Button>
                            </InlineStack>
                            <div
                              style={{ maxHeight: 80, overflowY: "auto", fontSize: 13, color: "var(--p-color-text-subdued)" }}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.content).substring(0, 200) + "…" }}
                            />
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}
                </Modal.Section>
              </Modal>
            </Layout.Section>

          /* ── PRODUCT LIST ── */
          ) : (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Select Products to Improve</Text>
                  <IndexTable
                    resourceName={{ singular: "product", plural: "products" }}
                    itemCount={fetchedProducts.length}
                    selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: "Image" },
                      { title: "Product" },
                      { title: "Type" },
                      { title: "Description" },
                      { title: "Action" },
                    ]}
                    promotedBulkActions={[{ content: "Edit Selected", onAction: handleStartBulk }]}
                  >
                    {fetchedProducts.map((product, index) => (
                      <IndexTable.Row
                        id={product.id}
                        key={product.id}
                        selected={selectedResources.includes(product.id)}
                        position={index}
                      >
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
                          {product.vendor && <Text as="span" variant="bodySm" tone="subdued"> · {product.vendor}</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm" tone="subdued">{product.productType || "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {product.descriptionHtml
                            ? <Badge tone="success">Has description</Badge>
                            : <Badge tone="critical">Empty</Badge>
                          }
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button size="slim" onClick={() => handleStartSingle(product)}>Edit</Button>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

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
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
