
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import styles from "../styles/privacy.css?url";

export const links = () => [
    { rel: "stylesheet", href: styles },
];

export const loader = async ({ request }) => {
    return json({});
};

export default function PrivacyPolicy() {
    return (
        <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.6", maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
            <h1>Privacy Policy</h1>
            <p>Last updated: {new Date().toLocaleDateString()}</p>

            <h2>1. Introduction</h2>
            <p>
                CopySpark AI ("we", "us", or "our") respects your privacy. This Privacy Policy describes how we collect, use, and share information in connection with your use of our Shopify application (the "App").
            </p>

            <h2>2. Information We Collect</h2>
            <p>
                When you install and use the App, we collect the following types of information:
            </p>
            <ul>
                <li><strong>Shopify Store Information:</strong> We collect your store's name, email, and primary domain to identify your account and provide our services.</li>
                <li><strong>Product Data:</strong> To generate descriptions and SEO metadata, we access your product titles, existing descriptions, and images.</li>
                <li><strong>Usage Data:</strong> We track usage metrics (e.g., number of descriptions generated) to manage your billing and credits.</li>
            </ul>

            <h2>3. How We Use Your Information</h2>
            <p>We use the collected information to:</p>
            <ul>
                <li>Provide the App's core functionality (generating content).</li>
                <li>Process billing and subscription payments.</li>
                <li>Improve and optimize our App's performance.</li>
            </ul>

            <h2>4. Data Sharing and Third Parties</h2>
            <p>
                We do not sell your personal data. We share data only with necessary service providers:
            </p>
            <ul>
                <li><strong>Google Gemini API:</strong> Product data is sent to Google's AI models solely for the purpose of generating text.</li>
                <li><strong>Supabase:</strong> We use Supabase to store session and usage data securely.</li>
            </ul>

            <h2>5. Your Rights</h2>
            <p>
                If you are a European resident, you have the right to access personal information we hold about you and to ask that your personal information be corrected, updated, or deleted. If you would like to exercise this right, please contact us.
            </p>

            <h2>6. Contact Us</h2>
            <p>
                For more information about our privacy practices, if you have questions, or if you would like to make a complaint, please contact us by email.
            </p>
        </div>
    );
}
