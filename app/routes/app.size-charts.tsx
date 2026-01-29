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
    IndexTable,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text,
    TextField,
    useIndexResourceState
} from "@shopify/polaris";
import {
    PlusIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface SizeChartItem {
  id: string;
  brand: string;
  category: string | null;
  chartData: string;
  unit: string;
  createdAt: string;
}

interface SizeData {
  sizes: string[];
  measurements: { label: string; values: Record<string, string> }[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get all size charts (global, not shop-specific)
  const sizeCharts = await prisma.sizeChart.findMany({
    orderBy: { brand: 'asc' },
  });

  // Get unique brands from products
  const brands = await prisma.sSBrand.findMany({
    select: { name: true },
    orderBy: { name: 'asc' },
  });

  const categories = ['T-Shirt', 'Long Sleeve', 'Tank Top', 'Hoodie', 'Sweatshirt', 'Polo', 'Jacket', 'Pants', 'Shorts', 'Hat'];

  return json({
    sizeCharts: sizeCharts.map((s): SizeChartItem => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    brands: brands.map((b: { name: string }) => b.name),
    categories,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create" || action === "update") {
    const brand = formData.get("brand") as string;
    const category = formData.get("category") as string || null;
    const unit = formData.get("unit") as string || "inches";
    const chartData = formData.get("chartData") as string;
    const chartId = formData.get("chartId") as string;

    // Validate JSON
    try {
      JSON.parse(chartData);
    } catch {
      return json({ success: false, message: "Invalid chart data format" });
    }

    if (action === "update" && chartId) {
      await prisma.sizeChart.update({
        where: { id: chartId },
        data: { brand, category, unit, chartData },
      });
      return json({ success: true, message: "Size chart updated" });
    } else {
      // Check for existing
      const existing = await prisma.sizeChart.findUnique({
        where: { brand_category: { brand, category: category || '' } },
      });

      if (existing) {
        await prisma.sizeChart.update({
          where: { id: existing.id },
          data: { chartData, unit },
        });
        return json({ success: true, message: "Size chart updated" });
      }

      await prisma.sizeChart.create({
        data: { brand, category, unit, chartData },
      });
      return json({ success: true, message: "Size chart created" });
    }
  }

  if (action === "delete") {
    const chartId = formData.get("chartId") as string;
    await prisma.sizeChart.delete({ where: { id: chartId } });
    return json({ success: true, message: "Size chart deleted" });
  }

  if (action === "generateDefault") {
    const brand = formData.get("brand") as string;
    const category = formData.get("category") as string || null;

    // Generate default size chart data
    const defaultChartData: SizeData = {
      sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
      measurements: [
        { label: 'Chest (in)', values: { 'XS': '32-34', 'S': '34-36', 'M': '38-40', 'L': '42-44', 'XL': '46-48', '2XL': '50-52', '3XL': '54-56' } },
        { label: 'Length (in)', values: { 'XS': '27', 'S': '28', 'M': '29', 'L': '30', 'XL': '31', '2XL': '32', '3XL': '33' } },
        { label: 'Sleeve (in)', values: { 'XS': '8', 'S': '8.5', 'M': '9', 'L': '9.5', 'XL': '10', '2XL': '10.5', '3XL': '11' } },
      ],
    };

    const existing = await prisma.sizeChart.findUnique({
      where: { brand_category: { brand, category: category || '' } },
    });

    if (existing) {
      return json({ success: false, message: "Size chart already exists for this brand/category" });
    }

    await prisma.sizeChart.create({
      data: {
        brand,
        category,
        unit: "inches",
        chartData: JSON.stringify(defaultChartData),
      },
    });

    return json({ success: true, message: "Default size chart created" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function SizeChartsPage() {
  const { sizeCharts, brands, categories } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingChart, setEditingChart] = useState<SizeChartItem | null>(null);
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("inches");
  const [chartData, setChartData] = useState("");

  const isLoading = navigation.state === "submitting";

  const resourceName = { singular: 'size chart', plural: 'size charts' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(sizeCharts);

  const resetForm = useCallback(() => {
    setBrand("");
    setCategory("");
    setUnit("inches");
    setChartData("");
    setEditingChart(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback((chart: SizeChartItem) => {
    setEditingChart(chart);
    setBrand(chart.brand);
    setCategory(chart.category || "");
    setUnit(chart.unit);
    setChartData(chart.chartData);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("action", editingChart ? "update" : "create");
    if (editingChart) formData.set("chartId", editingChart.id);
    formData.set("brand", brand);
    formData.set("category", category);
    formData.set("unit", unit);
    formData.set("chartData", chartData);
    submit(formData, { method: "POST" });
    setModalOpen(false);
    resetForm();
  }, [editingChart, brand, category, unit, chartData, submit, resetForm]);

  const handleDelete = useCallback((chartId: string) => {
    if (!confirm("Delete this size chart?")) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("chartId", chartId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleGenerateDefault = useCallback((brandName: string, cat: string) => {
    const formData = new FormData();
    formData.set("action", "generateDefault");
    formData.set("brand", brandName);
    formData.set("category", cat);
    submit(formData, { method: "POST" });
  }, [submit]);

  const parseChartData = (data: string): SizeData | null => {
    try {
      return JSON.parse(data) as SizeData;
    } catch {
      return null;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const rowMarkup = sizeCharts.map((chart, index) => {
    const parsed = parseChartData(chart.chartData);
    return (
      <IndexTable.Row
        id={chart.id}
        key={chart.id}
        selected={selectedResources.includes(chart.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">{chart.brand}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge>{chart.category || 'All Categories'}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {parsed ? `${parsed.sizes.length} sizes` : 'Invalid'}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {chart.unit}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {formatDate(chart.createdAt)}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="100">
            <Button size="slim" variant="plain" onClick={() => openEditModal(chart)}>
              Edit
            </Button>
            <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(chart.id)}>
              Delete
            </Button>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const defaultChartTemplate = JSON.stringify({
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    measurements: [
      { label: 'Chest (in)', values: { 'XS': '32-34', 'S': '34-36', 'M': '38-40', 'L': '42-44', 'XL': '46-48', '2XL': '50-52' } },
      { label: 'Length (in)', values: { 'XS': '27', 'S': '28', 'M': '29', 'L': '30', 'XL': '31', '2XL': '32' } },
    ],
  }, null, 2);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Size Charts"
      subtitle="Manage size charts for product pages"
      primaryAction={{
        content: "Add Size Chart",
        icon: PlusIcon,
        onAction: openCreateModal,
      }}
    >
      <TitleBar title="Size Charts" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Quick Generate */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Quick Generate Default Charts</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Generate standard size charts for popular brands
            </Text>
            <InlineStack gap="200" wrap>
              {brands.slice(0, 8).map(b => (
                <Button
                  key={b}
                  size="slim"
                  onClick={() => handleGenerateDefault(b, 'T-Shirt')}
                  disabled={sizeCharts.some(c => c.brand === b)}
                >
                  {b}
                </Button>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Size Charts List */}
        {sizeCharts.length === 0 ? (
          <Card>
            <EmptyState
              heading="No size charts"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Add Size Chart",
                onAction: openCreateModal,
              }}
            >
              <p>Create size charts to help customers find the right fit.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={sizeCharts.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Brand' },
                { title: 'Category' },
                { title: 'Sizes' },
                { title: 'Unit' },
                { title: 'Created' },
                { title: 'Actions' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Preview a size chart if any exist */}
        {sizeCharts.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Preview: {sizeCharts[0].brand}</Text>
              <Divider />
              {(() => {
                const parsed = parseChartData(sizeCharts[0].chartData);
                if (!parsed) return <Text as="p" tone="subdued">Invalid chart data</Text>;

                return (
                  <DataTable
                    columnContentTypes={['text', ...parsed.sizes.map(() => 'text' as const)]}
                    headings={['Measurement', ...parsed.sizes]}
                    rows={parsed.measurements.map(m => [
                      m.label,
                      ...parsed.sizes.map(s => m.values[s] || '—'),
                    ])}
                  />
                );
              })()}
            </BlockStack>
          </Card>
        )}

        {/* Add/Edit Modal */}
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); resetForm(); }}
          title={editingChart ? "Edit Size Chart" : "Add Size Chart"}
          primaryAction={{
            content: "Save",
            onAction: handleSubmit,
            loading: isLoading,
            disabled: !brand || !chartData,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => { setModalOpen(false); resetForm(); } },
          ]}
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Layout>
                <Layout.Section variant="oneHalf">
                  <TextField
                    label="Brand"
                    value={brand}
                    onChange={setBrand}
                    autoComplete="off"
                    placeholder="Gildan, Next Level, etc."
                  />
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Select
                    label="Category (optional)"
                    options={[
                      { label: 'All Categories', value: '' },
                      ...categories.map(c => ({ label: c, value: c })),
                    ]}
                    value={category}
                    onChange={setCategory}
                  />
                </Layout.Section>
              </Layout>
              <Select
                label="Unit"
                options={[
                  { label: 'Inches', value: 'inches' },
                  { label: 'Centimeters', value: 'cm' },
                ]}
                value={unit}
                onChange={setUnit}
              />
              <TextField
                label="Chart Data (JSON)"
                value={chartData}
                onChange={setChartData}
                multiline={10}
                autoComplete="off"
                placeholder={defaultChartTemplate}
                helpText="Use the format: { sizes: [...], measurements: [{ label, values: {} }] }"
              />
              <Button variant="plain" onClick={() => setChartData(defaultChartTemplate)}>
                Load Template
              </Button>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 How Size Charts Work</Text>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              Size charts are displayed on product pages in your store's theme.
              They help customers choose the right size before purchasing.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              To display size charts, add the Size Chart widget to your theme's product page template.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
