import { generateContentSafe } from "./gemini.server";
import prisma from "./db.server";

/**
 * Fetch all product images from Shopify
 * @param {object} admin - Shopify admin GraphQL client
 * @param {string} productId - Shopify product ID
 * @returns {Promise<Array>} Array of image objects with url and altText
 */
export async function fetchAllProductImages(admin, productId) {
  try {
    const response = await admin.graphql(
      `#graphql
      query getProductImages($id: ID!) {
        product(id: $id) {
          id title
          images(first: 25) {
            nodes {
              id url altText
            }
          }
        }
      }`,
      { variables: { id: productId } }
    );

    const responseJson = await response.json();
    if (responseJson.errors) {
      console.error("GraphQL error:", responseJson.errors);
      return [];
    }

    return responseJson.data.product.images.nodes || [];
  } catch (error) {
    console.error("Error fetching images:", error);
    return [];
  }
}

/**
 * Generate alt text for a product image using Gemini
 * @param {string} imageUrl - Image URL
 * @param {object} productInfo - Product info {title, productType, tags}
 * @returns {Promise<string>} Generated alt text (max 125 chars)
 */
export async function generateAltTextForImage(imageUrl, productInfo = {}) {
  try {
    const prompt = `Analyze this product image and generate a concise, SEO-friendly alt text.
Product Name: ${productInfo.title || "Product"}
${productInfo.productType ? `Product Type: ${productInfo.productType}` : ""}
${productInfo.tags ? `Tags: ${productInfo.tags}` : ""}

Requirements:
- Maximum 125 characters
- Be specific about what's visible in the image
- Include the product name if visible
- Make it descriptive and searchable
- Do NOT use phrases like "image of", "picture of", or "screenshot of"

Image URL: ${imageUrl}

Generate ONLY the alt text, nothing else.`;

    const altText = await generateContentSafe(prompt);
    // Clean up the response
    return altText.trim().substring(0, 125);
  } catch (error) {
    console.error("Error generating alt text:", error);
    // Fallback to product name
    return (productInfo.title || "Product").substring(0, 125);
  }
}

/**
 * Save alt text to history in database
 * @param {string} shop - Shop domain
 * @param {string} productId - Shopify product ID
 * @param {string} productTitle - Product title
 * @param {string} imageUrl - Image URL
 * @param {string} altText - Generated alt text
 * @returns {Promise<object>} Created record
 */
export async function saveAltTextHistory(shop, productId, productTitle, imageUrl, altText) {
  try {
    const record = await prisma.altTextHistory.create({
      data: {
        shop,
        productId,
        productTitle,
        imageUrl,
        generatedAltText: altText,
      },
    });
    return record;
  } catch (error) {
    console.error("Error saving alt text history:", error);
    return null;
  }
}

/**
 * Clean up old alt text records, keeping only the last 5 per image per product
 * @param {string} shop - Shop domain
 * @param {string} productId - Product ID
 * @returns {Promise<void>}
 */
export async function cleanupOldAltTextRecords(shop, productId) {
  try {
    // Group by imageUrl and get counts
    const records = await prisma.altTextHistory.findMany({
      where: { shop, productId },
      orderBy: { createdAt: "desc" },
    });

    // Group by imageUrl
    const byImageUrl = new Map();
    records.forEach((record) => {
      if (!byImageUrl.has(record.imageUrl)) {
        byImageUrl.set(record.imageUrl, []);
      }
      byImageUrl.get(record.imageUrl).push(record);
    });

    // Delete records beyond the 5th for each image
    for (const [imageUrl, imageRecords] of byImageUrl.entries()) {
      if (imageRecords.length > 5) {
        const toDelete = imageRecords.slice(5).map((r) => r.id);
        await prisma.altTextHistory.deleteMany({
          where: { id: { in: toDelete } },
        });
      }
    }
  } catch (error) {
    console.error("Error cleaning up alt text records:", error);
  }
}

/**
 * Fetch alt text history for a product
 * @param {string} shop - Shop domain
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} Array of alt text history records
 */
export async function fetchAltTextHistory(shop, productId) {
  try {
    const history = await prisma.altTextHistory.findMany({
      where: { shop, productId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return history;
  } catch (error) {
    console.error("Error fetching alt text history:", error);
    return [];
  }
}

/**
 * Get unique images for a product that don't have alt text
 * @param {array} images - Array of image objects with url and altText
 * @returns {array} Images without alt text
 */
export function getImagesNeedingAltText(images) {
  return images.filter((img) => !img.altText || img.altText.trim() === "");
}
