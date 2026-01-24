import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateContentSafe } from "../gemini.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { admin, session, billing } = await authenticate.admin(request);
  /* Billing disabled until app is public
  await billing.require({
    plans: ["Growth"],
    isTest: true,
    onFailure: async () => {
      throw new Response("Billing required", { status: 402 });
    }
  });
  */

  const formData = await request.formData();

  const productTitle = formData.get("productTitle");
  const productDescription = formData.get("productDescription");
  const tone = formData.get("tone");
  const length = formData.get("length");
  const language = formData.get("language") || "English";
  const customInstructions = formData.get("customInstructions") || "";

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
Custom Instructions: ${customInstructions}

Rules:
- Create a compelling description from scratch.
- Focus on benefits and features implied by the title.
- Do NOT hallucinate specific specs (like dimensions) unless standard.
- Output MUST be valid HTML.
- No emojis.
${customInstructions ? `- IMPORTANT: Follow these custom instructions: ${customInstructions}` : ''}

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
${customInstructions ? `- IMPORTANT: Follow these custom instructions: ${customInstructions}` : ''}

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
Length: ${length}
Language: ${language}
Custom Instructions: ${customInstructions}

Final Instruction:
Rewrite the provided product description HTML according to the selected tone and length in ${language} language. Return ONLY the HTML.
`;
  }

  // Key check handled by getGeminiModel

  try {
    // Pre-check Billing/Update Stats
    if (prisma && prisma.usageStat) {
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
    }

    const text = await generateContentSafe(prompt);

    return json({ rewritten: text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    if (error.status === 429 || error.message?.includes("429")) {
      return json({ error: "AI usage limit reached. Please wait a minute and try again." }, { status: 429 });
    }
    return json({ error: `Failed to generate description. Error: ${error.message}` }, { status: 500 });
  }
};
