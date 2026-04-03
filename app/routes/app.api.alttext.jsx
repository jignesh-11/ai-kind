import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { checkAndChargeUsage } from "../billing.server";
import prisma from "../db.server";
import {
  fetchAllProductImages,
  generateAltTextForImage,
  saveAltTextHistory,
  cleanupOldAltTextRecords,
  fetchAltTextHistory,
} from "../alttext.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // ── Batch generate alt text for all products ──────────────────────────
  if (intent === "generate" && !formData.get("productId")) {
    try {
      // Fetch all products
      const productsResponse = await admin.graphql(
        `#graphql
        query getAllProducts {
          products(first: 50, sortKey: TITLE) {
            nodes {
              id title productType
              images(first: 25) {
                nodes {
                  id url altText
                }
              }
            }
          }
        }`
      );
      const productsJson = await productsResponse.json();
      if (productsJson.errors) {
        return json({ error: "Failed to fetch products" }, { status: 500 });
      }

      const products = productsJson.data.products.nodes;
      let totalGenerated = 0;
      const results = [];

      // Process each product
      for (const product of products) {
        if (!product.images || product.images.nodes.length === 0) {
          continue; // Skip products with no images
        }

        const imagesToProcess = product.images.nodes.filter((img) => !img.altText || img.altText.trim() === "");

        for (const image of imagesToProcess) {
          try {
            // Check usage
            try {
              await checkAndChargeUsage(admin, session.shop, 1);
            } catch (billErr) {
              console.log("Billing check failed, continuing anyway:", billErr.message);
            }

            // Generate alt text
            const altText = await generateAltTextForImage(image.url, {
              title: product.title,
              productType: product.productType || "",
            });

            // Save to history
            await saveAltTextHistory(session.shop, product.id, product.title, image.url, altText);

            results.push({
              productId: product.id,
              productTitle: product.title,
              imageUrl: image.url,
              altText,
              success: true,
            });

            totalGenerated++;

            // Update usage stats
            try {
              await prisma.usageStat.upsert({
                where: { shop: session.shop },
                update: { altTextGenerated: { increment: 1 } },
                create: { shop: session.shop, altTextGenerated: 1 },
              });
            } catch (err) {
              console.error("Stats update failed:", err);
            }

            // Clean up old records
            await cleanupOldAltTextRecords(session.shop, product.id);

            // Rate limiting: 3.5s between images
            await new Promise((resolve) => setTimeout(resolve, 3500));
          } catch (error) {
            console.error(`Error processing image ${image.url}:`, error);
            results.push({
              productId: product.id,
              productTitle: product.title,
              imageUrl: image.url,
              error: error.message,
              success: false,
            });
          }
        }
      }

      return json({
        success: true,
        generatedCount: totalGenerated,
        totalCount: results.length,
        message: `Generated alt text for ${totalGenerated} images across all products`,
        results: results.slice(0, 10), // Return first 10 for UI feedback
      });
    } catch (error) {
      console.error("Batch alt text generation error:", error);
      return json({ error: `Batch generation failed: ${error.message}` }, { status: 500 });
    }
  }

  // ── Generate alt text for specific product images ──────────────────────
  if (intent === "generate") {
    const productId = formData.get("productId");
    const productTitle = formData.get("productTitle");
    const productType = formData.get("productType") || "";
    const tags = formData.get("tags") || "";

    try {
      // Fetch all images for the product
      const images = await fetchAllProductImages(admin, productId);

      if (!images || images.length === 0) {
        return json({ message: "No images found for this product", generated: 0 });
      }

      // Filter images without alt text
      const imagesToProcess = images.filter((img) => !img.altText || img.altText.trim() === "");

      if (imagesToProcess.length === 0) {
        return json({ message: "All images already have alt text", generated: 0 });
      }

      let generated = 0;
      const results = [];

      // Generate alt text for each image
      for (const image of imagesToProcess) {
        try {
          // Charge usage
          await checkAndChargeUsage(admin, session.shop, 1);

          // Generate alt text
          const altText = await generateAltTextForImage(image.url, {
            title: productTitle,
            productType,
            tags,
          });

          // Save to history
          await saveAltTextHistory(session.shop, productId, productTitle, image.url, altText);

          results.push({
            imageUrl: image.url,
            altText,
            success: true,
          });

          generated++;

          // Update usage stats
          try {
            await prisma.usageStat.upsert({
              where: { shop: session.shop },
              update: { altTextGenerated: { increment: 1 } },
              create: { shop: session.shop, altTextGenerated: 1 },
            });
          } catch (err) {
            console.error("Stats update failed:", err);
          }

          // Clean up old records
          await cleanupOldAltTextRecords(session.shop, productId);
        } catch (error) {
          console.error(`Error processing image ${image.url}:`, error);
          results.push({
            imageUrl: image.url,
            error: error.message,
            success: false,
          });
        }
      }

      return json({
        generated,
        total: imagesToProcess.length,
        results,
        message: `Generated alt text for ${generated} of ${imagesToProcess.length} images`,
      });
    } catch (error) {
      console.error("Alt text generation error:", error);
      return json({ error: `Failed to generate alt text. Error: ${error.message}` }, { status: 500 });
    }
  }

  // ── Fetch alt text history ────────────────────────────────────────────
  if (intent === "fetch_history") {
    const productId = formData.get("productId");

    try {
      const history = await fetchAltTextHistory(session.shop, productId);
      return json({ history });
    } catch (_) {
      return json({ history: [] });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};
