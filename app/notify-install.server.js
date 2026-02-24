import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send an email notification when a new shop installs the app.
 * Fire-and-forget — errors are logged but never block the app.
 *
 * @param {string} shop - The shop domain (e.g. "my-store.myshopify.com")
 */
export async function sendInstallNotification(shop) {
    const to = process.env.NOTIFY_EMAIL || "jigneshdhandhukiya63@gmail.com";

    try {
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "CopySpark <onboarding@resend.dev>",
            to: [to],
            subject: `🎉 New Install: ${shop}`,
            html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 22px;">🎉 New App Installation!</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">A new merchant just installed <strong>CopySpark</strong>.</p>

          <div style="background: #f7f8fc; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #6b7280; font-size: 13px; padding: 6px 0;">Shop</td>
                <td style="color: #1a1a2e; font-size: 13px; font-weight: 600; text-align: right; padding: 6px 0;">${shop}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; font-size: 13px; padding: 6px 0;">Date</td>
                <td style="color: #1a1a2e; font-size: 13px; font-weight: 600; text-align: right; padding: 6px 0;">${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; font-size: 13px; padding: 6px 0;">Free Credits</td>
                <td style="color: #1a1a2e; font-size: 13px; font-weight: 600; text-align: right; padding: 6px 0;">30</td>
              </tr>
            </table>
          </div>

          <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
            CopySpark Install Notifications
          </p>
        </div>
      `,
        });

        if (error) {
            console.error(`[Install Notify] Resend error for ${shop}:`, error);
        } else {
            console.log(`[Install Notify] Email sent for ${shop}, id: ${data?.id}`);
        }
    } catch (err) {
        console.error(`[Install Notify] Failed to send email for ${shop}:`, err);
    }
}
