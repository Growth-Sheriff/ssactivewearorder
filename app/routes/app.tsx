import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/catalog">Browse Catalog</Link>
        <Link to="/app/favorites">Favorites</Link>
        <Link to="/app/bulk-import">Bulk Import</Link>
        <Link to="/app/orders">Orders</Link>
        <Link to="/app/tracking">Tracking</Link>
        <Link to="/app/price-rules">Price Rules</Link>
        <Link to="/app/stock-alerts">Stock Alerts</Link>
        <Link to="/app/automation">Automation</Link>
        <Link to="/app/quick-reorder">Quick Reorder</Link>
        <Link to="/app/reports">Reports</Link>
        <Link to="/app/sync">Catalog Sync</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}


// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
