import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    DataTable,
    Divider,
    EmptyState,
    InlineGrid,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text,
    TextField
} from "@shopify/polaris";
import { useCallback, useState } from "react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get imported products with prices
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
  const styles = styleIds.length > 0 ? await prisma.sSStyleCache.findMany({
    where: { styleId: { in: styleIds } },
    select: { styleId: true, styleName: true, brandName: true, basePrice: true },
  }) : [];

  const styleMap = new Map(styles.map(s => [s.styleId.toString(), s]));

  // Get unique brands
  const brands = [...new Set(styles.map(s => s.brandName))].sort();

  // Get active price rules
  const priceRules = await prisma.priceRule.findMany({
    where: { shop, isActive: true },
    orderBy: { priority: 'asc' },
  });

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
    activePriceRulesCount: priceRules.length,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "preview") {
    const adjustType = formData.get("adjustType") as string;
    const adjustValue = parseFloat(formData.get("adjustValue") as string) || 0;
    const brandFilter = formData.get("brandFilter") as string;
    const roundTo = formData.get("roundTo") as string;

    // Get products matching filter
    const products = await prisma.productMap.findMany({
      where: { shop },
      select: { id: true, ssStyleId: true },
    });

    const styleIds = products.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));

    const where: Record<string, unknown> = { styleId: { in: styleIds } };
    if (brandFilter) where.brandName = brandFilter;

    const styles = await prisma.sSStyleCache.findMany({
      where,
      select: { styleId: true, styleName: true, brandName: true, basePrice: true },
    });

    const styleMap = new Map(styles.map(s => [s.styleId.toString(), s]));

    const preview: ProductPreview[] = [];

    products.forEach(p => {
      const style = styleMap.get(p.ssStyleId);
      if (!style) return;

      let newPrice = style.basePrice || 0;

      switch (adjustType) {
        case 'percent_increase':
          newPrice = newPrice * (1 + adjustValue / 100);
          break;
        case 'percent_decrease':
          newPrice = newPrice * (1 - adjustValue / 100);
          break;
        case 'fixed_increase':
          newPrice = newPrice + adjustValue;
          break;
        case 'fixed_decrease':
          newPrice = newPrice - adjustValue;
          break;
        case 'multiplier':
          newPrice = newPrice * adjustValue;
          break;
        case 'set_fixed':
          newPrice = adjustValue;
          break;
      }

      // Apply rounding
      switch (roundTo) {
        case '0.99':
          newPrice = Math.floor(newPrice) + 0.99;
          break;
        case '0.95':
          newPrice = Math.floor(newPrice) + 0.95;
          break;
        case 'round':
          newPrice = Math.round(newPrice);
          break;
        case 'up':
          newPrice = Math.ceil(newPrice);
          break;
      }

      // Ensure positive price
      newPrice = Math.max(0.01, newPrice);

      preview.push({
        id: p.id,
        ssStyleId: p.ssStyleId,
        styleName: style.styleName,
        brandName: style.brandName,
        currentPrice: style.basePrice || 0,
        newPrice: Math.round(newPrice * 100) / 100,
      });
    });

    return json({
      success: true,
      action: 'preview',
      preview: preview.slice(0, 20),
      totalProducts: preview.length,
      avgChange: preview.length > 0
        ? ((preview.reduce((sum, p) => sum + ((p.newPrice - p.currentPrice) / (p.currentPrice || 1)), 0) / preview.length) * 100).toFixed(1)
        : 0,
    });
  }

  if (action === "apply") {
    const adjustType = formData.get("adjustType") as string;
    const adjustValue = parseFloat(formData.get("adjustValue") as string) || 0;
    const brandFilter = formData.get("brandFilter") as string;
    const roundTo = formData.get("roundTo") as string;

    // Get products matching filter
    const products = await prisma.productMap.findMany({
      where: { shop },
      select: { id: true, ssStyleId: true, shopifyProductId: true },
    });

    const styleIds = products.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));

    const where: Record<string, unknown> = { styleId: { in: styleIds } };
    if (brandFilter) where.brandName = brandFilter;

    const styles = await prisma.sSStyleCache.findMany({
      where,
      select: { styleId: true, basePrice: true },
    });

    const styleMap = new Map(styles.map(s => [s.styleId.toString(), s]));

    let updated = 0;
    let failed = 0;

    for (const product of products) {
      const style = styleMap.get(product.ssStyleId);
      if (!style) continue;

      let newPrice = style.basePrice || 0;

      switch (adjustType) {
        case 'percent_increase':
          newPrice = newPrice * (1 + adjustValue / 100);
          break;
        case 'percent_decrease':
          newPrice = newPrice * (1 - adjustValue / 100);
          break;
        case 'fixed_increase':
          newPrice = newPrice + adjustValue;
          break;
        case 'fixed_decrease':
          newPrice = newPrice - adjustValue;
          break;
        case 'multiplier':
          newPrice = newPrice * adjustValue;
          break;
        case 'set_fixed':
          newPrice = adjustValue;
          break;
      }

      switch (roundTo) {
        case '0.99':
          newPrice = Math.floor(newPrice) + 0.99;
          break;
        case '0.95':
          newPrice = Math.floor(newPrice) + 0.95;
          break;
        case 'round':
          newPrice = Math.round(newPrice);
          break;
        case 'up':
          newPrice = Math.ceil(newPrice);
          break;
      }

      newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

      try {
        // Update Shopify product price via GraphQL
        const response = await admin.graphql(`
          mutation updateProductPrice($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `, {
          variables: {
            input: {
              id: `gid://shopify/Product/${product.shopifyProductId}`,
              variants: [{
                price: newPrice.toString(),
              }],
            },
          },
        });

        updated++;
      } catch (error) {
        failed++;
      }
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        shop,
        action: 'bulk_price_update',
        resource: 'product',
        details: JSON.stringify({
          adjustType,
          adjustValue,
          brandFilter,
          roundTo,
          updated,
          failed,
        }),
      },
    });

    return json({
      success: true,
      action: 'apply',
      message: `Prices updated! ${updated} products updated, ${failed} failed.`,
    });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function BulkPriceUpdatePage() {
  const { productsCount, products, brands, activePriceRulesCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [adjustType, setAdjustType] = useState('percent_increase');
  const [adjustValue, setAdjustValue] = useState('20');
  const [brandFilter, setBrandFilter] = useState('');
  const [roundTo, setRoundTo] = useState('0.99');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const isLoading = navigation.state === "submitting";

  const handlePreview = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "preview");
    formData.set("adjustType", adjustType);
    formData.set("adjustValue", adjustValue);
    formData.set("brandFilter", brandFilter);
    formData.set("roundTo", roundTo);
    submit(formData, { method: "POST" });
  }, [adjustType, adjustValue, brandFilter, roundTo, submit]);

  const handleApply = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "apply");
    formData.set("adjustType", adjustType);
    formData.set("adjustValue", adjustValue);
    formData.set("brandFilter", brandFilter);
    formData.set("roundTo", roundTo);
    submit(formData, { method: "POST" });
    setConfirmModalOpen(false);
  }, [adjustType, adjustValue, brandFilter, roundTo, submit]);

  const adjustTypeOptions = [
    { label: 'Increase by %', value: 'percent_increase' },
    { label: 'Decrease by %', value: 'percent_decrease' },
    { label: 'Increase by $', value: 'fixed_increase' },
    { label: 'Decrease by $', value: 'fixed_decrease' },
    { label: 'Multiply by', value: 'multiplier' },
    { label: 'Set to fixed price', value: 'set_fixed' },
  ];

  const roundToOptions = [
    { label: 'No rounding', value: 'none' },
    { label: 'Round to .99', value: '0.99' },
    { label: 'Round to .95', value: '0.95' },
    { label: 'Round to nearest $1', value: 'round' },
    { label: 'Round up', value: 'up' },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const previewData = actionData?.action === 'preview' ? actionData : null;

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Bulk Price Update"
      subtitle="Update prices for multiple products at once"
    >
      <TitleBar title="Bulk Price Update" />
      <BlockStack gap="600">
        {actionData?.action === 'apply' && actionData.message && (
          <Banner tone="success" onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Stats */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Products</Text>
              <Text as="p" variant="heading2xl">{productsCount}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Brands</Text>
              <Text as="p" variant="heading2xl">{brands.length}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Active Price Rules</Text>
              <Text as="p" variant="heading2xl">{activePriceRulesCount}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Configuration */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Price Adjustment</Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="400">
                  <Select
                    label="Adjustment Type"
                    options={adjustTypeOptions}
                    value={adjustType}
                    onChange={setAdjustType}
                  />
                  <TextField
                    label={adjustType.includes('percent') ? 'Percentage' : adjustType === 'multiplier' ? 'Multiplier' : 'Amount ($)'}
                    type="number"
                    value={adjustValue}
                    onChange={setAdjustValue}
                    autoComplete="off"
                    suffix={adjustType.includes('percent') ? '%' : adjustType === 'multiplier' ? 'x' : '$'}
                  />
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <BlockStack gap="400">
                  <Select
                    label="Filter by Brand"
                    options={[
                      { label: 'All Brands', value: '' },
                      ...brands.map(b => ({ label: b, value: b })),
                    ]}
                    value={brandFilter}
                    onChange={setBrandFilter}
                  />
                  <Select
                    label="Price Rounding"
                    options={roundToOptions}
                    value={roundTo}
                    onChange={setRoundTo}
                  />
                </BlockStack>
              </Layout.Section>
            </Layout>
            <InlineStack gap="300">
              <Button onClick={handlePreview} loading={isLoading}>
                Preview Changes
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Preview */}
        {previewData && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Preview ({previewData.totalProducts} products)</Text>
                <Badge>Avg change: {previewData.avgChange}%</Badge>
              </InlineStack>
              <Divider />
              {previewData.preview && previewData.preview.length > 0 && (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text']}
                  headings={['Product', 'Brand', 'Current', 'New', 'Change']}
                  rows={previewData.preview.map((p: ProductPreview) => {
                    const change = p.newPrice - p.currentPrice;
                    const changePercent = p.currentPrice > 0 ? ((change / p.currentPrice) * 100).toFixed(1) : 0;
                    return [
                      p.styleName,
                      p.brandName,
                      formatCurrency(p.currentPrice),
                      formatCurrency(p.newPrice),
                      <Badge key={p.id} tone={change >= 0 ? 'success' : 'critical'}>
                        {change >= 0 ? '+' : ''}{changePercent}%
                      </Badge>,
                    ];
                  })}
                />
              )}
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={() => setConfirmModalOpen(true)}
                  disabled={previewData.totalProducts === 0}
                  tone="critical"
                >
                  Apply to {previewData.totalProducts} Products
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {productsCount === 0 && (
          <Card>
            <EmptyState
              heading="No products to update"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Import Products",
                url: "/app/products",
              }}
            >
              <p>Import products from SSActiveWear first, then update prices.</p>
            </EmptyState>
          </Card>
        )}

        {/* Confirm Modal */}
        <Modal
          open={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          title="Confirm Price Update"
          primaryAction={{
            content: "Update Prices",
            onAction: handleApply,
            loading: isLoading,
            destructive: true,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setConfirmModalOpen(false) },
          ]}
        >
          <Modal.Section>
            <Banner tone="warning">
              <p>This will update prices for <strong>{previewData?.totalProducts || 0}</strong> products in Shopify.</p>
              <p>This action cannot be undone automatically.</p>
            </Banner>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
