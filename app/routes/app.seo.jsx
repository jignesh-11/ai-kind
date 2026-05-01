import {
  Page, Layout, Text, Card, Button, BlockStack, Box,
  TextField, InlineStack, IndexTable, Thumbnail, Banner, Badge, ProgressBar, Tooltip
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ArrowLeftIcon, ClockIcon, StarIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData, useNavigate } from "@remix-run/react";
import { generateJsonSafe } from "../gemini.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";
import { Modal } from "@shopify/polaris";
import { FREE_PLAN, PLAN_CONFIG } from "../constants";

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
  const planName = usage?.planName || FREE_PLAN;
  const planConfig = PLAN_CONFIG[planName] || PLAN_CONFIG[FREE_PLAN];

  return json({
    apiKey:   process.env.SHOPIFY_API_KEY || "",
    allProducts, // Return all products for searching
    products: paginatedProducts,
    credits:  usage?.credits || 0,
    usageCount: usage?.monthlyUsageCount || 0,
    planName,
    totalCredits: planConfig.credits,
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

  if (intent === "generate_seo") {
    const productTitle       = formData.get("productTitle");
    const productDescription = formData.get("productDescription");
    const keywords           = formData.get("keywords");
    const productType        = formData.get("productType") || "";
    const vendor             = formData.get("vendor") || "";
    const tags               = formData.get("tags") || "";

    const prompt = `Generate optimized SEO Title and Meta Description for ${productTitle}.\nKeywords: ${keywords}`;

    try {
      await checkAndChargeUsage(admin, session.shop, 1);
      await prisma.usageStat.upsert({
        where: { shop: session.shop },
        update: { seoGenerated: { increment: 1 } },
        create: { shop: session.shop, seoGenerated: 1 }
      });

      const seoData = await generateJsonSafe(prompt, SEO_SCHEMA);
      return json({ generatedSeo: seoData });
    } catch (error) {
      return json({ error: error.message }, { status: 500 });
    }
  }

  if (intent === "save_seo") {
    const productId      = formData.get("productId");
    const seoTitle       = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");

    await admin.graphql(
      `#graphql
      mutation updateProductSEO($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: productId, seo: { title: seoTitle, description: seoDescription } } } }
    );

    return json({ success: true });
  }

  return null;
};

function SerpPreview({ title, description }) {
  return (
    <Box padding="400" background="bg-surface" borderRadius="200" borderWidth="025" borderColor="border">
      <BlockStack gap="100">
        <div style={{ color: "#1a0dab", fontSize: 18 }}>{title || "Product Title"}</div>
        <Text variant="bodySm">{description || "Description..."}</Text>
      </BlockStack>
    </Box>
  );
}

export default function SeoGenerator() {
  const actionData  = useActionData();
  const loaderData  = useLoaderData();
  const navigation  = useNavigation();
  const navigate    = useNavigate();
  const submit      = useSubmit();
  const shopify     = useAppBridge();

  const { planName, usageCount, totalCredits } = loaderData || {};
  const progress = totalCredits === 999999 ? 100 : Math.min(100, (usageCount / (totalCredits || 1)) * 100);

  const [productId, setProductId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [currentSeoTitle, setCurrentSeoTitle] = useState("");
  const [currentSeoDescription, setCurrentSeoDescription] = useState("");
  const [generatedSeoTitle, setGeneratedSeoTitle] = useState("");
  const [generatedSeoDescription, setGeneratedSeoDescription] = useState("");

  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (!actionData) return;
    if (actionData.productTitle) {
      setProductTitle(actionData.productTitle);
      setCurrentSeoTitle(actionData.currentSeoTitle || "");
      setCurrentSeoDescription(actionData.currentSeoDescription || "");
    }
    if (actionData.generatedSeo) {
      setGeneratedSeoTitle(actionData.generatedSeo.title);
      setGeneratedSeoDescription(actionData.generatedSeo.description);
    }
    if (actionData.success) shopify.toast.show("SEO updated");
    if (actionData.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

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
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="AI SEO Generator">
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
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" blockAlign="center">
                  <Button icon={ArrowLeftIcon} onClick={() => setProductId("")} accessibilityLabel="Back" />
                  <Text variant="headingMd">SEO: {productTitle}</Text>
                </InlineStack>
                <TextField label="SEO Title" value={generatedSeoTitle || currentSeoTitle} onChange={setGeneratedSeoTitle} autoComplete="off" />
                <TextField label="Meta Description" value={generatedSeoDescription || currentSeoDescription} onChange={setGeneratedSeoDescription} multiline={3} autoComplete="off" />
                <SerpPreview title={generatedSeoTitle || currentSeoTitle} description={generatedSeoDescription || currentSeoDescription} />
                <Button variant="primary" onClick={handleGenerate} loading={isLoading && navigation.formData?.get("intent") === "generate_seo"}>Generate SEO</Button>
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Select Product</Text>
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={(loaderData?.products || []).length}
                  headings={[{ title: "Image" }, { title: "Product" }, { title: "Action" }]}
                  selectable={false}
                >
                  {(loaderData?.products || []).map((product, index) => (
                    <IndexTable.Row id={product.id} key={product.id} position={index}>
                      <IndexTable.Cell>
                        {product.featuredImage?.url && <Thumbnail source={product.featuredImage.url} alt={product.title} size="small" />}
                      </IndexTable.Cell>
                      <IndexTable.Cell><Text fontWeight="bold">{product.title}</Text></IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button 
                          size="slim" 
                          onClick={() => selectProduct(product.id)}
                          loading={isLoading && navigation.formData?.get("productId") === product.id && navigation.formData?.get("intent") === "fetch"}
                        >
                          Optimize
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </BlockStack>
            </Card>
          )}
      </BlockStack>
    </Page>
  );
}
