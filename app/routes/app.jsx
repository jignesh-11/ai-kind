import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { initializeFreeCredits } from "../init-credits.server";
import SupportWidget from "../components/SupportWidget";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Initialize 30 free credits for new installations
  const isNewInstall = await initializeFreeCredits(session.shop);

  return { apiKey: process.env.SHOPIFY_API_KEY || "", isNewInstall };
};

export default function App() {
  const { apiKey, isNewInstall } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/descriptions">Product Descriptions</Link>
        <Link to="/app/seo">SEO Generator</Link>
        <Link to="/app/audit">SEO Audit</Link>
      </NavMenu>
      <Outlet />
      <SupportWidget defaultOpen={isNewInstall} />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
