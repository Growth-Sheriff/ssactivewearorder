import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    DataTable,
    Divider,
    InlineGrid,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text,
    TextField
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface ProductPreview {
  id: string;
  ssStyleId: string;
  styleName: string;
  brandName: string;
  currentPrice: number;
  newPrice: number;
}

type ActionData =
  | { success: true; action: 'preview'; preview: ProductPreview[]; totalProducts: number; avgChange: string | number }
  | { success: true; action: 'apply'; message: string }
  | { success: false; message: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    // Get imported products
    const products = await prisma.productMap.findMany({
      where: { shop },
      select: {
        id: true,
        ssStyleId: true,
        shopifyProductId: true,
      },
    });

    // Get style details
    const styleIds = products.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));

    let styles: any[] = [];
    try {
      // We use as any and exclude basePrice if it causes issues, or handle it safely
      styles = styleIds.length > 0 ? await (prisma.sSStyleCache as any).findMany({
        where: { styleId: { in: styleIds } },
        select: { styleId: true, styleName: true, brandName: true, basePrice: true },
      }) : [];
    } catch (e) {
      console.error("SSStyleCache query failed, trying without basePrice:", e);
      styles = styleIds.length > 0 ? await (prisma.sSStyleCache as any).findMany({
        where: { styleId: { in: styleIds } },
        select: { styleId: true, styleName: true, brandName: true },
      }) : [];
    }

    const styleMap = new Map(styles.map(s => [s.styleId.toString(), s]));
    const brands = Array.from(new Set(styles.map(s => s.brandName))).filter(Boolean).sort() as string[];

    let priceRulesCount = 0;
    try {
      priceRulesCount = await (prisma.priceRule as any).count({ where: { shop, isActive: true } });
    } catch (e) {}

    return json({
      productsCount: products.length,
      products: products.slice(0, 50).map(p => {
        const style = styleMap.get(p.ssStyleId);
        return {
          id: p.id,
          ssStyleId: p.ssStyleId,
          shopifyProductId: p.shopifyProductId,
          styleName: style?.styleName || `Style ${p.ssStyleId}`,
          brandName: style?.brandName || 'Unknown',
          basePrice: style?.basePrice || 0,
        };
      }),
      brands,
      activePriceRulesCount: priceRulesCount,
    });
  } catch (error) {
    console.error("Bulk Price Loader Error:", error);
    throw new Response("Internal Server Error", { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionName = formData.get("action") as string;

  if (actionName === "preview") {
    const adjustType = formData.get("adjustType") as string;
    const adjustValue = parseFloat(formData.get("adjustValue") as string) || 0;
    const brandFilter = formData.get("brandFilter") as string;
    const roundTo = formData.get("roundTo") as string;

    const products = await prisma.productMap.findMany({
      where: { shop },
      select: { id: true, ssStyleId: true },
    });

    const styleIds = products.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));
    const where: any = { styleId: { in: styleIds } };
    if (brandFilter) where.brandName = brandFilter;

    const styles = await (prisma.sSStyleCache as any).findMany({
      where,
      select: { styleId: true, styleName: true, brandName: true, basePrice: true },
    });

    const styleMap = new Map(styles.map((s: any) => [s.styleId.toString(), s]));
    const preview: ProductPreview[] = [];

    products.forEach(p => {
      const style: any = styleMap.get(p.ssStyleId);
      if (!style) return;

      let newPrice = style.basePrice || 0;
      const currentPrice = newPrice;

      switch (adjustType) {
        case 'percent_increase': newPrice *= (1 + adjustValue / 100); break;
        case 'percent_decrease': newPrice *= (1 - adjustValue / 100); break;
        case 'fixed_increase': newPrice += adjustValue; break;
        case 'fixed_decrease': newPrice -= adjustValue; break;
        case 'multiplier': newPrice *= adjustValue; break;
        case 'set_fixed': newPrice = adjustValue; break;
      }

      switch (roundTo) {
        case '0.99': newPrice = Math.floor(newPrice) + 0.99; break;
        case '0.95': newPrice = Math.floor(newPrice) + 0.95; break;
        case 'round': newPrice = Math.round(newPrice); break;
        case 'up': newPrice = Math.ceil(newPrice); break;
      }

      newPrice = Math.max(0.01, newPrice);

      preview.push({
        id: p.id,
        ssStyleId: p.ssStyleId,
        styleName: style.styleName,
        brandName: style.brandName,
        currentPrice: currentPrice,
        newPrice: Math.round(newPrice * 100) / 100,
      });
    });

    return json<ActionData>({
      success: true,
      action: 'preview',
      preview: preview.slice(0, 20),
      totalProducts: preview.length,
      avgChange: preview.length > 0
        ? ((preview.reduce((sum, p) => sum + ((p.newPrice - p.currentPrice) / (p.currentPrice || 1)), 0) / preview.length) * 100).toFixed(1)
        : 0,
    });
  }

  if (actionName === "apply") {
    const adjustType = formData.get("adjustType") as string;
    const adjustValue = parseFloat(formData.get("adjustValue") as string) || 0;
    const brandFilter = formData.get("brandFilter") as string;
    const roundTo = formData.get("roundTo") as string;

    const products = await prisma.productMap.findMany({
      where: { shop },
      select: { id: true, ssStyleId: true, shopifyProductId: true },
    });

    const styleIds = products.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));
    const where: any = { styleId: { in: styleIds } };
    if (brandFilter) where.brandName = brandFilter;

    const styles = await (prisma.sSStyleCache as any).findMany({
      where,
      select: { styleId: true, basePrice: true },
    });

    const styleMap = new Map(styles.map((s: any) => [s.styleId.toString(), s]));
    let updated = 0;
    let failed = 0;

    for (const product of products) {
      const style: any = styleMap.get(product.ssStyleId);
      if (!style) continue;

      let newPrice = style.basePrice || 0;

      switch (adjustType) {
        case 'percent_increase': newPrice *= (1 + adjustValue / 100); break;
        case 'percent_decrease': newPrice *= (1 - adjustValue / 100); break;
        case 'fixed_increase': newPrice += adjustValue; break;
        case 'fixed_decrease': newPrice -= adjustValue; break;
        case 'multiplier': newPrice *= adjustValue; break;
        case 'set_fixed': newPrice = adjustValue; break;
      }

      switch (roundTo) {
        case '0.99': newPrice = Math.floor(newPrice) + 0.99; break;
        case '0.95': newPrice = Math.floor(newPrice) + 0.95; break;
        case 'round': newPrice = Math.round(newPrice); break;
        case 'up': newPrice = Math.ceil(newPrice); break;
      }

      newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

      try {
        await admin.graphql(`
          mutation updateProductPrice($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { message }
            }
          }
        `, {
          variables: {
            input: {
              id: product.shopifyProductId,
              variants: [{ price: newPrice.toString() }],
            },
          },
        });
        updated++;
      } catch (error) { failed++; }
    }

    return json<ActionData>({
      success: true,
      action: 'apply',
      message: `Prices updated! ${updated} products updated, ${failed} failed.`,
    });
  }

  return json<ActionData>({ success: false, message: "Unknown action" });
};

export default function BulkPriceUpdatePage() {
  const { productsCount, brands, activePriceRulesCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [adjustType, setAdjustType] = useState('percent_increase');
  const [adjustValue, setAdjustValue] = useState('20');
  const [brandFilter, setBrandFilter] = useState('');
  const [roundTo, setRoundTo] = useState('0.99');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success && actionData.action === 'apply') {
      shopify.toast.show(actionData.message);
      setConfirmModalOpen(false);
    } else if (actionData?.success === false) {
      shopify.toast.show(actionData.message, { isError: true });
    }
  }, [actionData, shopify]);

  const handlePreview = useCallback(() => {
    submit({ action: "preview", adjustType, adjustValue, brandFilter, roundTo }, { method: "POST" });
  }, [adjustType, adjustValue, brandFilter, roundTo, submit]);

  const handleApply = useCallback(() => {
    submit({ action: "apply", adjustType, adjustValue, brandFilter, roundTo }, { method: "POST" });
  }, [adjustType, adjustValue, brandFilter, roundTo, submit]);

  const previewData = actionData?.success && actionData.action === 'preview' ? actionData : null;

  return (
    <Page backAction={{ url: "/app" }} title="Bulk Price Update">
      <TitleBar title="Bulk Price Update" />
      <BlockStack gap="600">
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card><BlockStack gap="200"><Text as="h3" variant="headingSm" tone="subdued">Products</Text><Text as="p" variant="heading2xl">{productsCount}</Text></BlockStack></Card>
          <Card><BlockStack gap="200"><Text as="h3" variant="headingSm" tone="subdued">Brands</Text><Text as="p" variant="heading2xl">{brands.length}</Text></BlockStack></Card>
          <Card><BlockStack gap="200"><Text as="h3" variant="headingSm" tone="subdued">Active Rules</Text><Text as="p" variant="heading2xl">{activePriceRulesCount}</Text></BlockStack></Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Price Adjustment</Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="400">
                  <Select label="Adjustment Type" options={[
                      { label: 'Increase by %', value: 'percent_increase' },
                      { label: 'Decrease by %', value: 'percent_decrease' },
                      { label: 'Increase by $', value: 'fixed_increase' },
                      { label: 'Decrease by $', value: 'fixed_decrease' },
                      { label: 'Multiply by', value: 'multiplier' },
                      { label: 'Set to fixed price', value: 'set_fixed' },
                    ]} value={adjustType} onChange={setAdjustType} />
                  <TextField label="Amount" type="number" value={adjustValue} onChange={setAdjustValue} autoComplete="off" />
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="400">
                  <Select label="Filter by Brand" options={[{ label: 'All Brands', value: '' }, ...brands.map(b => ({ label: b, value: b }))]} value={brandFilter} onChange={(val) => setBrandFilter(val)} />
                  <Select label="Rounding" options={[
                      { label: 'No rounding', value: 'none' },
                      { label: 'Round to .99', value: '0.99' },
                      { label: 'Round to .95', value: '0.95' },
                      { label: 'Round to nearest $1', value: 'round' },
                      { label: 'Round up', value: 'up' },
                    ]} value={roundTo} onChange={setRoundTo} />
                </BlockStack>
              </Layout.Section>
            </Layout>
            <InlineStack gap="300"><Button onClick={handlePreview} loading={isLoading}>Preview Changes</Button></InlineStack>
          </BlockStack>
        </Card>

        {previewData && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Preview ({previewData.totalProducts} products)</Text>
                <Badge tone="info">Avg change: {previewData.avgChange}%</Badge>
              </InlineStack>
              <Divider />
              {previewData.preview && (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text']}
                  headings={['Product', 'Brand', 'Current', 'New', 'Change']}
                  rows={previewData.preview.map((p) => [
                    p.styleName, p.brandName, `$${p.currentPrice}`, `$${p.newPrice}`,
                    <Badge key={p.id} tone={(p.newPrice ?? 0) >= (p.currentPrice ?? 0) ? 'success' : 'critical'}>
                      {(p.newPrice ?? 0) >= (p.currentPrice ?? 0) ? '+' : ''}{(( (p.newPrice ?? 0) - (p.currentPrice ?? 0)) / ((p.currentPrice ?? 1) || 1) * 100).toFixed(1)}%
                    </Badge>
                  ])}
                />
              )}
              <InlineStack align="end">
                <Button variant="primary" onClick={() => setConfirmModalOpen(true)} tone="critical">
                  Apply to {previewData.totalProducts} Products
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Modal open={confirmModalOpen} onClose={() => setConfirmModalOpen(false)} title="Confirm Price Update"
          primaryAction={{ content: "Update Prices", onAction: handleApply, loading: isLoading, destructive: true }}
          secondaryActions={[{ content: "Cancel", onAction: () => setConfirmModalOpen(false) }]}>
          <Modal.Section><Banner tone="warning"><p>This will update prices for <strong>{previewData?.totalProducts || 0}</strong> products. Action cannot be undone.</p></Banner></Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
