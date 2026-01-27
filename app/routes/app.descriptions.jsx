import { useState, useEffect } from "react";
import { useActionData, useNavigation, useSubmit, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  TextField,
  Select,
  Banner,
  InlineStack,
  EmptyState,
  IndexTable,
  Modal,
  Thumbnail,
  useIndexResourceState
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { generateContentSafe } from "../gemini.server";
import { ArrowLeftIcon, EditIcon } from "@shopify/polaris-icons";
import prisma from "../db.server";
import { checkAndChargeUsage } from "../billing.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          descriptionHtml
          featuredImage {
            url
            altText
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
    products: responseJson.data.products.nodes,
    usageCount: usage?.monthlyUsageCount || 0,
    credits: usage?.credits || 0
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
          title
          descriptionHtml
        }
      }`,
      { variables: { id: productId } }
    );
    const responseJson = await response.json();
    const product = responseJson.data.product;
    return json({
      productTitle: product.title,
      originalDescription: product.descriptionHtml
    });
  }

  if (intent === "fetch_multiple") {
    const productIds = JSON.parse(formData.get("productIds"));
    const response = await admin.graphql(
      `#graphql
      query getProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            descriptionHtml
          }
        }
      }`,
      { variables: { ids: productIds } }
    );
    const responseJson = await response.json();
    const products = responseJson.data.nodes.map(p => ({
      id: p.id,
      title: p.title,
      originalDescription: p.descriptionHtml,
      rewrittenDescription: "",
      status: "idle" // idle, loading, success, error
    }));
    return json({ products });
  }

  if (intent === "rewrite") {
    const productDescription = formData.get("productDescription");
    const tone = formData.get("tone");
    const length = formData.get("length");
    const language = formData.get("language") || "English";

    const productTitle = formData.get("productTitle");

    // Strip HTML tags to check if there is real content
    const cleanDescription = productDescription ? productDescription.replace(/<[^>]*>/g, '').trim() : "";
    const isDescriptionEmpty = cleanDescription.length < 5;

    let prompt = "";
    if (isDescriptionEmpty) {
      // Generate mode
      if (!productTitle) {
        return json({ error: "Product title is required to generate a description." }, { status: 400 });
      }
      prompt = `
You are building a Shopify AI Product Description Generator.
Generate a new product description based on the product title.

Product Title: ${productTitle}
Tone: ${tone}
Length: ${length}
Language: ${language}

Rules:
- Create a compelling description from scratch.
- Focus on benefits and features implied by the title.
- Do NOT hallucinate specific specs (like dimensions) unless standard.
- Output MUST be valid HTML.
- No emojis.

Tone Rules:
- simple: Easy language, Short sentences
- premium: Polished, Elegant
- indian audience: Friendly, Practical, No Western slang
- professional: Formal, Trustworthy, Expert
- persuasive: Compelling, Action-oriented, Benefit-focused
- witty: Fun, Engaging, Clever, Light-hearted
- luxury: Exclusive, Sophisticated, High-end vocabulary
- minimalist: Direct, Clean, No fluff
- storytelling: Narrative, Emotional connection, Descriptive

Length Rules:
- short: Concise, ~50 words
- long: Detailed, ~150 words

Final Instruction:
Final Instruction:
Generate a product description in HTML format in ${language} language. Return ONLY the HTML.
`;
    } else {
      // Rewrite mode
      prompt = `
You are building a Shopify AI Product Description Improver.
This tool must rewrite existing product descriptions.

Core Rules:
- NEVER create a description from nothing.
- Preserve factual meaning.
- Optimize for low token usage.
- Input is HTML, Output MUST be valid HTML.
- Do NOT add new features.

Rewrite Guidelines:
- Improve clarity, readability, and flow.
- Fix grammar.
- No emojis.
- Avoid exaggerated marketing words unless tone = premium.

Tone Rules:
- simple: Easy language, Short sentences
- premium: Polished, Elegant
- indian audience: Friendly, Practical, No Western slang
- professional: Formal, Trustworthy, Expert
- persuasive: Compelling, Action-oriented, Benefit-focused
- witty: Fun, Engaging, Clever, Light-hearted
- luxury: Exclusive, Sophisticated, High-end vocabulary
- minimalist: Direct, Clean, No fluff
- storytelling: Narrative, Emotional connection, Descriptive

Length Rules:
- short: Reduce verbosity
- long: Slightly expand explanations

Input Variables:
Original description (HTML):
${productDescription}

Tone: ${tone}
Tone: ${tone}
Length: ${length}
Language: ${language}

Final Instruction:
Final Instruction:
Rewrite the provided product description HTML according to the selected tone and length in ${language} language. Return ONLY the HTML.
`;
    }

    // Key check handled by getGeminiModel

    // Pre-check Billing/Update Stats
    if (prisma && prisma.usageStat) {
      try {
        // This will throw if no free credits AND no active plan
        await checkAndChargeUsage(admin, session.shop, 1);

        try {
          await prisma.usageStat.upsert({
            where: { shop: session.shop },
            update: { descriptionsGenerated: { increment: 1 } },
            create: { shop: session.shop, descriptionsGenerated: 1 }
          });
        } catch (err) {
          console.error("Stats update failed:", err);
        }
      } catch (err) {
        // Billing check failed (no plan)
        return json({ error: err.message }, { status: 402 });
      }
    }

    try {
      const text = await generateContentSafe(prompt);
      return json({ rewritten: text });
    } catch (error) {
      console.error("Gemini API Error:", error);

      // Log available models for debugging
      try {
        // const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // const modelList = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).apiKey; 
      } catch (e) {
        console.error("Could not list models", e);
      }

      if (error.status === 429 || error.message?.includes("429")) {
        return json({ error: "AI usage limit reached. Please wait a minute and try again." }, { status: 429 });
      }
      return json({ error: `Failed to generate description. Error: ${error.message}` }, { status: 500 });
    }
  }

  if (intent === "save") {
    const newDescription = formData.get("newDescription");
    const response = await admin.graphql(
      `#graphql
      mutation updateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
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
            descriptionHtml: newDescription
          }
        }
      }
    );
    const responseJson = await response.json();
    if (responseJson.data.productUpdate.userErrors.length > 0) {
      return json({ error: responseJson.data.productUpdate.userErrors[0].message }, { status: 400 });
    }
    return json({ success: true, newDescription });
  }

  return null;
};

export default function Index() {
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewrittenDescription, setRewrittenDescription] = useState("");

  // Bulk state
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);

  const fetchedProducts = loaderData?.products || [];

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(fetchedProducts);

  const handleStartBulk = () => {
    const selectedObjects = fetchedProducts.filter(p => selectedResources.includes(p.id));
    setSelectedProducts(selectedObjects.map(p => ({
      id: p.id,
      title: p.title,
      originalDescription: p.descriptionHtml,
      rewrittenDescription: "",
      status: "idle"
    })));
    setIsBulkMode(true);
  };

  const handleStartSingle = (product) => {
    setProductId(product.id);
    setProductTitle(product.title);
    setDescription(product.descriptionHtml);
  };

  // Modal State
  const [activeModal, setActiveModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingField, setEditingField] = useState(null); // 'original' or 'new'
  const [modalDescription, setModalDescription] = useState("");

  const [tone, setTone] = useState("simple");
  const [length, setLength] = useState("short");
  const [language, setLanguage] = useState("English");
  const [customInstructions, setCustomInstructions] = useState("");

  const isLoading = navigation.state === "submitting";

  const handleEditClick = (product, field) => {
    setEditingProduct(product);
    setEditingField(field);
    setModalDescription(field === 'original' ? (product.originalDescription || "") : (product.newDescription || ""));
    setActiveModal(true);
  };

  const handleModalSave = () => {
    if (editingProduct && editingField) {
      setSelectedProducts(prev => prev.map(p => {
        if (p.id === editingProduct.id) {
          if (editingField === 'original') {
            return { ...p, originalDescription: modalDescription };
          } else {
            return { ...p, newDescription: modalDescription, status: 'edited' };
          }
        }
        return p;
      }));
    }
    setActiveModal(false);
    setEditingProduct(null);
    setEditingField(null);
  };

  const handleModalClose = () => {
    setActiveModal(false);
    setEditingProduct(null);
    setEditingField(null);
  };

  // Handle action responses
  useEffect(() => {
    if (actionData?.originalDescription) {
      // Single fetch response
      setDescription(actionData.originalDescription);
      setProductTitle(actionData.productTitle);
      shopify.toast.show("Product loaded");
    }

    if (actionData?.products) {
      // Bulk fetch response
      setSelectedProducts(actionData.products);
      setIsBulkMode(true);
      shopify.toast.show(`${actionData.products.length} products loaded`);
    }

    if (actionData?.rewritten) {
      // Single rewrite response
      setRewrittenDescription(actionData.rewritten);
    }

    if (actionData?.success) {
      shopify.toast.show("Product updated successfully");
      if (isBulkMode) {
        // Update status in bulk list
        setSelectedProducts(prev => prev.map(p =>
          p.id === actionData.productId ? { ...p, status: 'saved', newDescription: actionData.newDescription } : p
        ));
      } else {
        setRewrittenDescription(""); // Clear after save
        if (actionData.newDescription) {
          setDescription(actionData.newDescription);
        }
      }
    }
    if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify, isBulkMode]);

  const selectProduct = async () => {
    const currentSelectionIds = selectedProducts.map(p => ({ id: p.id }));

    const selection = await shopify.resourcePicker({
      type: 'product',
      multiple: true,
      selectionIds: currentSelectionIds,
      filter: {
        variants: false
      },
      action: 'select'
    });

    if (selection) {
      if (selection.length === 1) {
        // Single mode
        setIsBulkMode(false);
        const id = selection[0].id;
        setProductId(id);
        const formData = new FormData();
        formData.append("intent", "fetch");
        formData.append("productId", id);
        submit(formData, { method: "post" });
      } else {
        // Bulk mode
        setIsBulkMode(true);
        const ids = selection.map(p => p.id);
        const formData = new FormData();
        formData.append("intent", "fetch_multiple");
        formData.append("productIds", JSON.stringify(ids));
        submit(formData, { method: "post" });
      }
    }
  };

  const handleRewrite = () => {
    const formData = new FormData();
    formData.append("intent", "rewrite");
    formData.append("productDescription", description);
    formData.append("productTitle", productTitle);
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
    setProductId("");
    setProductTitle("");
    setDescription("");
    setRewrittenDescription("");
  };

  const usageCount = loaderData?.usageCount || 0;
  const credits = loaderData?.credits || 0;

  const [showBanner, setShowBanner] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hidePaidBanner') !== 'true';
    }
    return true;
  });

  const handleDismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem('hidePaidBanner', 'true');
  };

  return (
    <Page>
      <TitleBar title="AI Product Description Improver" />

      <BlockStack gap="500">
        {credits > 0 ? (
          <Banner tone="success" title="Using Free Credits">
            <p>You have <strong>{credits}</strong> free credits remaining. This generation is free.</p>
          </Banner>
        ) : (
          showBanner && (
            <Banner tone="info" title="Paid Usage Active" onDismiss={handleDismissBanner}>
              <p>You have used all free credits. This generation will cost <strong>$0.015</strong>.</p>
            </Banner>
          )
        )}
        <Layout>
          {isBulkMode ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Button icon={ArrowLeftIcon} onClick={() => { setIsBulkMode(false); setSelectedProducts([]); setProductId(""); }} accessibilityLabel="Back to Dashboard" />
                      <Text as="h2" variant="headingMd">
                        Bulk Editor ({selectedProducts.length} products)
                      </Text>
                    </InlineStack>
                  </InlineStack>

                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Tone"
                        options={[
                          { label: 'Simple', value: 'simple' },
                          { label: 'Premium', value: 'premium' },
                          { label: 'Indian Audience', value: 'indian audience' },
                          { label: 'Professional', value: 'professional' },
                          { label: 'Persuasive', value: 'persuasive' },
                          { label: 'Witty', value: 'witty' },
                          { label: 'Luxury', value: 'luxury' },
                          { label: 'Minimalist', value: 'minimalist' },
                          { label: 'Storytelling', value: 'storytelling' },
                        ]}
                        onChange={setTone}
                        value={tone}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Length"
                        options={[
                          { label: 'Short', value: 'short' },
                          { label: 'Long', value: 'long' },
                        ]}
                        onChange={setLength}
                        value={length}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Language"
                        options={[
                          { label: 'English', value: 'English' },
                          { label: 'Spanish', value: 'Spanish' },
                          { label: 'French', value: 'French' },
                          { label: 'German', value: 'German' },
                          { label: 'Italian', value: 'Italian' },
                          { label: 'Portuguese', value: 'Portuguese' },
                          { label: 'Hindi', value: 'Hindi' },
                          { label: 'Chinese', value: 'Chinese' },
                          { label: 'Japanese', value: 'Japanese' },
                        ]}
                        onChange={setLanguage}
                        value={language}
                      />
                    </div>
                  </InlineStack>

                  <TextField
                    label="Custom Instructions / Keywords"
                    value={customInstructions}
                    onChange={setCustomInstructions}
                    placeholder="e.g. Mention organic materials, summer sale, target Gen Z..."
                    autoComplete="off"
                  />

                  <IndexTable
                    resourceName={{ singular: 'product', plural: 'products' }}
                    itemCount={selectedProducts.length}
                    headings={[
                      { title: 'Product' },
                      { title: 'Original Status' },
                      { title: 'New Description' },
                      { title: 'Status' },
                    ]}
                    selectable={false}
                  >
                    {selectedProducts.map((product, index) => (
                      <IndexTable.Row id={product.id} key={product.id} position={index}>
                        <IndexTable.Cell>
                          <Text fontWeight="bold" as="span">{product.title}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" align="start" blockAlign="center">
                            <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {product.originalDescription && product.originalDescription.length > 10
                                ? product.originalDescription.replace(/<[^>]*>/g, '').substring(0, 15) + '...'
                                : 'Empty'}
                            </span>
                            <Button icon={EditIcon} variant="plain" onClick={() => handleEditClick(product, 'original')} accessibilityLabel="Edit Original" />
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200" align="start" blockAlign="center">
                            <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {product.newDescription
                                ? product.newDescription.replace(/<[^>]*>/g, '').substring(0, 15) + (product.newDescription.length > 15 ? '...' : '')
                                : '-'}
                            </span>
                            {product.newDescription && (
                              <Button icon={EditIcon} variant="plain" onClick={() => handleEditClick(product, 'new')} accessibilityLabel="Edit New" />
                            )}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {product.status}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

                  <Modal
                    open={activeModal}
                    onClose={handleModalClose}
                    title={`Edit ${editingField === 'original' ? 'Original' : 'New'} Description: ${editingProduct?.title}`}
                    primaryAction={{
                      content: 'Save',
                      onAction: handleModalSave,
                    }}
                    secondaryActions={[
                      {
                        content: 'Cancel',
                        onAction: handleModalClose,
                      },
                    ]}
                  >
                    <Modal.Section>
                      <TextField
                        label="Description"
                        value={modalDescription}
                        onChange={setModalDescription}
                        multiline={10}
                        autoComplete="off"
                      />
                    </Modal.Section>
                  </Modal>

                  <InlineStack align="end" gap="300">
                    <Button
                      variant="primary"
                      disabled={selectedProducts.some(p => p.status === 'generating...')}
                      onClick={async () => {
                        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                        for (const product of selectedProducts) {
                          // Update status to loading
                          setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'generating...' } : p));

                          const formData = new FormData();
                          formData.append("intent", "rewrite");
                          formData.append("productTitle", product.title);
                          formData.append("productDescription", product.originalDescription || "");
                          formData.append("tone", tone);
                          formData.append("length", length);
                          formData.append("language", language);
                          formData.append("customInstructions", customInstructions);

                          try {
                            const response = await fetch("/app/api/generate", {
                              method: "POST",
                              body: formData,
                              credentials: "same-origin"
                            });

                            if (!response.ok) {
                              throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const text = await response.text();
                            let data;
                            try {
                              data = JSON.parse(text);
                            } catch (e) {
                              console.error("Failed to parse JSON:", text);
                              throw new Error("Invalid server response");
                            }

                            if (data.rewritten) {
                              setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'ready to save', newDescription: data.rewritten } : p));
                            } else if (data.error) {
                              // If error (e.g. rate limit), show original description and do not save
                              setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'failed', newDescription: product.originalDescription } : p));
                            }
                          } catch (e) {
                            setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'failed', newDescription: product.originalDescription } : p));
                          }

                          // Add delay to avoid rate limits
                          await delay(10000);
                        }
                      }}
                    >
                      Generate All
                    </Button>
                    <Button
                      variant="primary"
                      onClick={async () => {
                        for (const product of selectedProducts) {
                          if ((product.status === 'ready to save' || product.status === 'edited') && product.newDescription) {
                            setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'saving...' } : p));
                            const formData = new FormData();
                            formData.append("intent", "save");
                            formData.append("productId", product.id);
                            formData.append("newDescription", product.newDescription);

                            try {
                              const response = await fetch("/app/api/save", {
                                method: "POST",
                                body: formData,
                                credentials: "same-origin"
                              });

                              if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                              }

                              const text = await response.text();
                              let data;
                              try {
                                data = JSON.parse(text);
                              } catch (e) {
                                console.error("Failed to parse JSON:", text);
                                throw new Error("Invalid server response");
                              }

                              if (data.success) {
                                setSelectedProducts(prev => prev.map(p => p.id === product.id ? {
                                  ...p,
                                  status: 'saved',
                                  originalDescription: product.newDescription
                                } : p));
                              } else {
                                setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'save error: ' + (data.error || 'Unknown') } : p));
                              }
                            } catch (e) {
                              setSelectedProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: 'save error: ' + e.message } : p));
                            }
                          }
                        }
                      }}
                    >
                      Save All
                    </Button>
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
                      <Button icon={ArrowLeftIcon} onClick={handleBack} accessibilityLabel="Back" />
                      <Text as="h2" variant="headingMd">
                        {productTitle ? `Editing: ${productTitle}` : "Select a Product"}
                      </Text>
                    </InlineStack>
                  </InlineStack>

                  <TextField
                    label="Original Description (HTML)"
                    value={description}
                    onChange={setDescription}
                    multiline={6}
                    autoComplete="off"
                    helpText="You can edit this before rewriting."
                  />

                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Tone"
                        options={[
                          { label: 'Simple', value: 'simple' },
                          { label: 'Premium', value: 'premium' },
                          { label: 'Indian Audience', value: 'indian audience' },
                          { label: 'Professional', value: 'professional' },
                          { label: 'Persuasive', value: 'persuasive' },
                          { label: 'Witty', value: 'witty' },
                          { label: 'Luxury', value: 'luxury' },
                          { label: 'Minimalist', value: 'minimalist' },
                          { label: 'Storytelling', value: 'storytelling' },
                        ]}
                        onChange={setTone}
                        value={tone}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Length"
                        options={[
                          { label: 'Short', value: 'short' },
                          { label: 'Long', value: 'long' },
                        ]}
                        onChange={setLength}
                        value={length}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Language"
                        options={[
                          { label: 'English', value: 'English' },
                          { label: 'Spanish', value: 'Spanish' },
                          { label: 'French', value: 'French' },
                          { label: 'German', value: 'German' },
                          { label: 'Italian', value: 'Italian' },
                          { label: 'Portuguese', value: 'Portuguese' },
                          { label: 'Hindi', value: 'Hindi' },
                          { label: 'Chinese', value: 'Chinese' },
                          { label: 'Japanese', value: 'Japanese' },
                        ]}
                        onChange={setLanguage}
                        value={language}
                      />
                    </div>
                  </InlineStack>

                  <TextField
                    label="Custom Instructions / Keywords"
                    value={customInstructions}
                    onChange={setCustomInstructions}
                    placeholder="e.g. Mention organic materials, summer sale, target Gen Z..."
                    autoComplete="off"
                  />

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={handleRewrite}
                      loading={isLoading && !rewrittenDescription}
                      disabled={!productId}
                    >
                      {description && description.replace(/<[^>]*>/g, '').trim().length > 5 ? "Rewrite Description" : "Generate Description"}
                    </Button>
                  </InlineStack>

                  {actionData?.error && (
                    <Banner tone="critical" title="Error">
                      <p>{actionData.error}</p>
                    </Banner>
                  )}

                  {rewrittenDescription && (
                    <Box
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingSm" fontWeight="bold">
                          Improved Description Preview
                        </Text>
                        <div
                          style={{ maxHeight: '300px', overflowY: 'auto', background: 'white', padding: '10px', borderRadius: '4px' }}
                          dangerouslySetInnerHTML={{ __html: rewrittenDescription }}
                        />
                        <InlineStack align="end" gap="300">
                          <Button
                            disabled={isLoading}
                            onClick={() => setRewrittenDescription("")}
                          >
                            Discard
                          </Button>
                          <Button
                            variant="primary"
                            onClick={handleSave}
                            loading={isLoading}
                          >
                            Save to Product
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          ) : (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Select Products to Improve</Text>
                  <IndexTable
                    resourceName={{ singular: 'product', plural: 'products' }}
                    itemCount={fetchedProducts.length}
                    selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: 'Image' },
                      { title: 'Product' },
                      { title: 'Action' },
                    ]}
                    promotedBulkActions={[
                      {
                        content: 'Edit Selected',
                        onAction: handleStartBulk,
                      },
                    ]}
                  >
                    {fetchedProducts.map((product, index) => (
                      <IndexTable.Row
                        id={product.id}
                        key={product.id}
                        selected={selectedResources.includes(product.id)}
                        position={index}
                      >
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
                          <Button size="slim" onClick={() => handleStartSingle(product)}>Edit Description</Button>
                        </IndexTable.Cell>
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
