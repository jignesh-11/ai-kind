import PDFDocument from "pdfkit";

/**
 * Generate an audit PDF from audit data
 * @param {object} auditData - Audit results {products, totalScore, perfect, hasIssues, etc}
 * @param {string} shop - Shop domain name
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateAuditPDF(auditData, shop) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      // Header
      doc.fontSize(24).font("Helvetica-Bold").text("SEO Audit Report", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica").text(shop || "Your Store", { align: "center", color: "#666" });
      doc.fontSize(10).text(new Date().toLocaleDateString(), { align: "center", color: "#999" });
      doc.moveDown(1);

      // Executive Summary
      doc.fontSize(14).font("Helvetica-Bold").text("Executive Summary");
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      const summaryData = [
        ["Overall Score", `${auditData.totalScore || 0}/100`],
        ["Products Audited", auditData.products?.length || 0],
        ["Perfect Score", auditData.perfect || 0],
        ["Needs Attention", auditData.hasIssues || 0],
        ["Missing Descriptions", auditData.missingDesc || 0],
        ["Missing SEO Tags", auditData.missingSeo || 0],
      ];

      doc.fontSize(10).font("Helvetica");
      summaryData.forEach(([label, value]) => {
        doc.fontSize(10);
        doc.text(`${label}: `, { continued: true });
        doc.font("Helvetica-Bold").text(String(value), { color: "#000" });
        doc.moveDown(0.3);
      });
      doc.moveDown(0.5);

      // Score visualization
      const scoreColor = auditData.totalScore >= 80 ? "#16a34a" : auditData.totalScore >= 50 ? "#ea8c55" : "#dc2626";
      doc.fontSize(12).font("Helvetica-Bold").text(`Health Score: ${auditData.totalScore}%`, { color: scoreColor });

      // Simple progress bar
      const barWidth = 200;
      const barHeight = 15;
      const filledWidth = (auditData.totalScore / 100) * barWidth;
      doc.rect(40, doc.y, barWidth, barHeight).stroke("#ddd");
      doc.rect(40, doc.y, filledWidth, barHeight).fill(scoreColor);
      doc.moveDown(1.5);

      // Products Table
      doc.fontSize(14).font("Helvetica-Bold").text("Product Breakdown");
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      // Table headers
      const tableY = doc.y;
      const colWidths = { title: 220, score: 70, issues: 150 };
      const headerColor = "#f3f4f6";

      doc.rect(40, tableY, colWidths.title, 25).fill(headerColor);
      doc.rect(40 + colWidths.title, tableY, colWidths.score, 25).fill(headerColor);
      doc.rect(40 + colWidths.title + colWidths.score, tableY, colWidths.issues, 25).fill(headerColor);

      doc.font("Helvetica-Bold").fontSize(10).text("Product", 50, tableY + 7);
      doc.text("Score", 40 + colWidths.title + 10, tableY + 7);
      doc.text("Issues", 40 + colWidths.title + colWidths.score + 10, tableY + 7);

      doc.moveDown(1.8);

      // Table rows
      const sortedProducts = (auditData.products || []).sort((a, b) => (a.audit?.score || 0) - (b.audit?.score || 0));
      sortedProducts.slice(0, 25).forEach((product) => {
        const score = product.audit?.score || 0;
        const issuesCount = product.audit?.issues?.length || 0;
        const scoreColor = score >= 80 ? "#16a34a" : score >= 50 ? "#ea8c55" : "#dc2626";

        const rowY = doc.y;
        doc.fontSize(9).font("Helvetica");
        doc.text(product.title || "N/A", 50, rowY, { width: colWidths.title - 20 });
        doc.font("Helvetica-Bold").text(String(score), 40 + colWidths.title + 10, rowY, { color: scoreColor });
        doc.font("Helvetica").text(String(issuesCount), 40 + colWidths.title + colWidths.score + 10, rowY);
        doc.moveDown(1);
      });

      if (sortedProducts.length > 25) {
        doc.fontSize(10).font("Helvetica").text(`... and ${sortedProducts.length - 25} more products`, { color: "#666" });
      }

      doc.moveDown(1);

      // Issue Summary
      doc.fontSize(14).font("Helvetica-Bold").text("Issue Summary");
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      const issueTypes = {};
      (auditData.products || []).forEach((product) => {
        (product.audit?.issues || []).forEach((issue) => {
          const key = issue.severity;
          issueTypes[key] = (issueTypes[key] || 0) + 1;
        });
      });

      doc.fontSize(10).font("Helvetica");
      doc.text(`High Severity: ${issueTypes.high || 0}`, { color: "#dc2626" });
      doc.text(`Medium Severity: ${issueTypes.medium || 0}`, { color: "#ea8c55" });
      doc.text(`Low Severity: ${issueTypes.low || 0}`, { color: "#3b82f6" });

      doc.moveDown(2);

      // Footer
      doc.fontSize(8).font("Helvetica").text(
        `Generated on ${new Date().toLocaleString()} | SEO Audit Report`,
        { align: "center", color: "#999" }
      );

      // Finalize PDF
      doc.end();
    } catch (error) {
      doc.end();
      reject(error);
    }
  });
}

/**
 * Log an audit export to database
 * @param {string} shop - Shop domain
 * @param {number} totalScore - Overall audit score
 * @param {number} productsCount - Number of products audited
 * @param {number} issuesCount - Total issues found
 * @returns {Promise<object>} Created record
 */
export async function logAuditExport(prisma, shop, totalScore, productsCount, issuesCount) {
  try {
    const record = await prisma.auditExport.create({
      data: {
        shop,
        totalScore,
        productsCount,
        issuesCount,
      },
    });
    return record;
  } catch (error) {
    console.error("Error logging audit export:", error);
    return null;
  }
}
