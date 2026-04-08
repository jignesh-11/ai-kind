import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateContentSafe } from "../gemini.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();

  const productId          = formData.get("productId") || "";
  const productTitle       = formData.get("productTitle");
  const productDescription = formData.get("productDescription");
  const tone               = formData.get("tone");
  const length             = formData.get("length");
  const language           = formData.get("language") || "English";
  const customInstructions = formData.get("customInstructions") || "";
  const productType        = formData.get("productType") || "";
  const vendor             = formData.get("vendor") || "";
  const tags               = formData.get("tags") || "";
  const variants           = formData.get("variants") || "";

  // Load shop brand voice if set
  let brandVoiceContext = "";
  try {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    if (settings?.brandVoicePrompt) {
      brandVoiceContext = `Brand Voice Guide:\n${settings.brandVoicePrompt}\n\n`;
    }
  } catch (_) { /* non-fatal */ }

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
    if (!productTitle) {
      return json({ error: "Product title is required to generate a description." }, { status: 400 });
    }
    prompt = `${brandVoiceContext}You are a Shopify AI Product Description Generator.
Generate a compelling product description from scratch.

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
- Create a compelling description from the title and context provided.
- Focus on benefits and features implied by the title and product type.
- Do NOT hallucinate specific specs (like dimensions) unless standard for this product type.
- If variants are provided, mention them naturally — do not list as a spec table.
- Output MUST be valid HTML (use <p>, <ul>, <li>, <strong> as appropriate).
- No emojis.
${customInstructions ? `- IMPORTANT: Follow these custom instructions: ${customInstructions}` : ""}

${toneRules}
${lengthRules}

Generate the product description in HTML in ${language}. Return ONLY the HTML, no explanation.`;

  } else {
    prompt = `${brandVoiceContext}You are a Shopify AI Product Description Improver.
Rewrite the provided product description while preserving its factual meaning.

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
- Preserve all factual information — do NOT add or remove product specs.
- Improve clarity, readability, and flow.
- Fix grammar and spelling errors.
- Input is HTML — output MUST be valid HTML.
- No emojis.
- Avoid exaggerated marketing words unless tone = premium or luxury.
${customInstructions ? `- IMPORTANT: Follow these custom instructions: ${customInstructions}` : ""}

${toneRules}
${lengthRules}

Rewrite in HTML in ${language}. Return ONLY the HTML, no explanation.`;
  }

  try {
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

    const text = await generateContentSafe(prompt);

    // Save to description history (keep last 10 per product)
    if (productId) {
      try {
        await prisma.descriptionHistory.create({
          data: {
            shop: session.shop,
            productId,
            productTitle: productTitle || "",
            content: text,
            tone: tone || "",
            language,
          }
        });
        const all = await prisma.descriptionHistory.findMany({
          where: { shop: session.shop, productId },
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });
        if (all.length > 10) {
          const toDelete = all.slice(10).map(r => r.id);
          await prisma.descriptionHistory.deleteMany({ where: { id: { in: toDelete } } });
        }
      } catch (err) {
        console.error("History save failed:", err);
      }
    }

    return json({ rewritten: text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    if (error.status === 429 || error.message?.includes("429")) {
      return json({ error: "AI usage limit reached. Please wait a minute and try again." }, { status: 429 });
    }
    return json({ error: `Failed to generate description. Error: ${error.message}` }, { status: 500 });
  }
};
