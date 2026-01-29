import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    Checkbox,
    Divider,
    EmptyState,
    Icon,
    IndexTable,
    InlineStack,
    Layout,
    Page,
    Select,
    Text,
    TextField,
    Thumbnail,
    useIndexResourceState
} from "@shopify/polaris";
import {
    CheckIcon,
    ClockIcon,
    PlayIcon,
    SearchIcon,
    XIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [queue, priceRules] = await Promise.all([
    prisma.importQueue.findMany({
      where: { shop },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.priceRule.findMany({
      where: { shop, isActive: true },
      orderBy: { priority: 'asc' },
    }),
  ]);

  // Get style details for queued items
  const styleIds = queue.map(q => q.styleId);
  const styles = await prisma.sSStyleCache.findMany({
    where: { styleId: { in: styleIds } },
  });

  const queueWithDetails = queue.map(q => {
    const style = styles.find(s => s.styleId === q.styleId);
    return {
      ...q,
      styleName: style?.styleName || `Style ${q.styleId}`,
      brandName: style?.brandName || 'Unknown',
      partNumber: style?.partNumber || '',
      styleImage: style?.styleImage || null,
    };
  });

  return json({ queue: queueWithDetails, priceRules });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "search") {
    const query = formData.get("query") as string;

    // Search in cached styles
    const results = await prisma.sSStyleCache.findMany({
      where: {
        OR: [
          { styleName: { contains: query } },
          { partNumber: { contains: query } },
          { brandName: { contains: query } },
        ],
      },
      take: 20,
    });

    return json({ success: true, searchResults: results });
  }

  if (action === "addToQueue") {
    const styleIds = JSON.parse(formData.get("styleIds") as string) as number[];
    const priceRuleId = formData.get("priceRuleId") as string || null;
    const tags = formData.get("tags") as string || null;
    const collection = formData.get("collection") as string || null;

    // Check for existing items
    const existing = await prisma.importQueue.findMany({
      where: { shop, styleId: { in: styleIds } },
    });
    const existingIds = existing.map(e => e.styleId);
    const newIds = styleIds.filter(id => !existingIds.includes(id));

    if (newIds.length === 0) {
      return json({ success: false, message: "All selected styles are already in queue" });
    }

    await prisma.importQueue.createMany({
      data: newIds.map(styleId => ({
        shop,
        styleId,
        priceRuleId,
        tags,
        collection,
        status: "pending",
      })),
    });

    return json({
      success: true,
      message: `Added ${newIds.length} styles to import queue`,
    });
  }

  if (action === "removeFromQueue") {
    const queueId = formData.get("queueId") as string;
    await prisma.importQueue.delete({ where: { id: queueId } });
    return json({ success: true, message: "Removed from queue" });
  }

  if (action === "bulkRemove") {
    const ids = JSON.parse(formData.get("ids") as string);
    await prisma.importQueue.deleteMany({
      where: { id: { in: ids }, shop },
    });
    return json({ success: true, message: `Removed ${ids.length} items` });
  }

  if (action === "clearCompleted") {
    await prisma.importQueue.deleteMany({
      where: { shop, status: "completed" },
    });
    return json({ success: true, message: "Cleared completed imports" });
  }

  if (action === "clearFailed") {
    await prisma.importQueue.deleteMany({
      where: { shop, status: "failed" },
    });
    return json({ success: true, message: "Cleared failed imports" });
  }

  // Note: Actual import processing would happen in a background job
  // For now, we'll just mark items as processing
  if (action === "startImport") {
    const ids = JSON.parse(formData.get("ids") as string || "[]");

    const whereClause = ids.length > 0
      ? { id: { in: ids }, shop, status: "pending" }
      : { shop, status: "pending" };

    await prisma.importQueue.updateMany({
      where: whereClause,
      data: { status: "processing" },
    });

    return json({
      success: true,
      message: "Import started! Products will be imported in the background.",
    });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function BulkImportPage() {
  const { queue, priceRules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<number[]>([]);
  const [selectedPriceRule, setSelectedPriceRule] = useState("");
  const [tags, setTags] = useState("");
  const [collection, setCollection] = useState("");

  const isLoading = navigation.state === "submitting";

  const resourceName = {
    singular: 'import',
    plural: 'imports',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(queue);

  // Stats
  const pendingCount = queue.filter(q => q.status === "pending").length;
  const processingCount = queue.filter(q => q.status === "processing").length;
  const completedCount = queue.filter(q => q.status === "completed").length;
  const failedCount = queue.filter(q => q.status === "failed").length;

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const formData = new FormData();
    formData.set("action", "search");
    formData.set("query", searchQuery);
    submit(formData, { method: "POST" });
  }, [searchQuery, submit]);

  // Update search results from action data
  if (actionData?.searchResults && searchResults !== actionData.searchResults) {
    setSearchResults(actionData.searchResults);
  }

  const handleAddToQueue = useCallback(() => {
    if (selectedStyles.length === 0) return;
    const formData = new FormData();
    formData.set("action", "addToQueue");
    formData.set("styleIds", JSON.stringify(selectedStyles));
    formData.set("priceRuleId", selectedPriceRule);
    formData.set("tags", tags);
    formData.set("collection", collection);
    submit(formData, { method: "POST" });
    setSelectedStyles([]);
    setSearchResults([]);
    setSearchQuery("");
  }, [selectedStyles, selectedPriceRule, tags, collection, submit]);

  const handleRemove = useCallback((queueId: string) => {
    const formData = new FormData();
    formData.set("action", "removeFromQueue");
    formData.set("queueId", queueId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleBulkRemove = useCallback(() => {
    if (!confirm(`Remove ${selectedResources.length} items from queue?`)) return;
    const formData = new FormData();
    formData.set("action", "bulkRemove");
    formData.set("ids", JSON.stringify(selectedResources));
    submit(formData, { method: "POST" });
  }, [selectedResources, submit]);

  const handleStartImport = useCallback((ids?: string[]) => {
    const formData = new FormData();
    formData.set("action", "startImport");
    formData.set("ids", JSON.stringify(ids || []));
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleClearCompleted = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "clearCompleted");
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleClearFailed = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "clearFailed");
    submit(formData, { method: "POST" });
  }, [submit]);

  const toggleStyleSelection = useCallback((styleId: number) => {
    setSelectedStyles(prev =>
      prev.includes(styleId)
        ? prev.filter(id => id !== styleId)
        : [...prev, styleId]
    );
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge tone="attention"><InlineStack gap="100"><Icon source={ClockIcon} />Pending</InlineStack></Badge>;
      case 'processing':
        return <Badge tone="info">Processing...</Badge>;
      case 'completed':
        return <Badge tone="success"><InlineStack gap="100"><Icon source={CheckIcon} />Completed</InlineStack></Badge>;
      case 'failed':
        return <Badge tone="critical"><InlineStack gap="100"><Icon source={XIcon} />Failed</InlineStack></Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const promotedBulkActions = [
    {
      content: 'Start Import',
      onAction: () => handleStartImport(selectedResources),
    },
    {
      content: 'Remove',
      destructive: true,
      onAction: handleBulkRemove,
    },
  ];

  const rowMarkup = queue.map((item, index) => (
    <IndexTable.Row
      id={item.id}
      key={item.id}
      selected={selectedResources.includes(item.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Thumbnail
          source={item.styleImage ? SSActiveWearClient.buildImageUrl(item.styleImage, 'small') : "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"}
          alt={item.styleName}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{item.styleName}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{item.brandName}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{item.partNumber}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {getStatusBadge(item.status)}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {item.tags && (
          <InlineStack gap="100" wrap>
            {item.tags.split(',').slice(0, 2).map((tag, idx) => (
              <Badge key={idx} size="small">{tag.trim()}</Badge>
            ))}
          </InlineStack>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {item.status === "pending" && (
          <InlineStack gap="100">
            <Button size="slim" onClick={() => handleStartImport([item.id])}>Import</Button>
            <Button size="slim" variant="plain" tone="critical" onClick={() => handleRemove(item.id)}>
              Remove
            </Button>
          </InlineStack>
        )}
        {item.status === "failed" && (
          <Button size="slim" onClick={() => handleStartImport([item.id])}>Retry</Button>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Bulk Import"
      subtitle="Search products and add them to the import queue"
      secondaryActions={[
        pendingCount > 0 && {
          content: `Import All (${pendingCount})`,
          icon: PlayIcon,
          onAction: () => handleStartImport([]),
        },
        completedCount > 0 && {
          content: "Clear Completed",
          onAction: handleClearCompleted,
        },
        failedCount > 0 && {
          content: "Clear Failed",
          destructive: true,
          onAction: handleClearFailed,
        },
      ].filter(Boolean) as any}
    >
      <TitleBar title="Bulk Import" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Stats */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Pending</Text>
                <Text as="p" variant="heading2xl">{pendingCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Processing</Text>
                <Text as="p" variant="heading2xl" tone="info">{processingCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Completed</Text>
                <Text as="p" variant="heading2xl" tone="success">{completedCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Failed</Text>
                <Text as="p" variant="heading2xl" tone="critical">{failedCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Search Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Search Products</Text>
            <InlineStack gap="200">
              <div style={{ flexGrow: 1 }}>
                <TextField
                  label=""
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search by style name, part number, or brand..."
                  autoComplete="off"
                  prefix={<Icon source={SearchIcon} />}
                  onBlur={() => {}}
                />
              </div>
              <Button onClick={handleSearch} loading={isLoading}>Search</Button>
            </InlineStack>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <>
                <Divider />
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingSm">
                      Results ({searchResults.length})
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {selectedStyles.length} selected
                    </Text>
                  </InlineStack>

                  <Box background="bg-surface-secondary" padding="300" borderRadius="200" style={{ maxHeight: "300px", overflow: "auto" }}>
                    <BlockStack gap="200">
                      {searchResults.map((style) => (
                        <Box
                          key={style.styleId}
                          padding="200"
                          background={selectedStyles.includes(style.styleId) ? "bg-surface-selected" : "bg-surface"}
                          borderRadius="100"
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="300">
                              <Checkbox
                                label=""
                                checked={selectedStyles.includes(style.styleId)}
                                onChange={() => toggleStyleSelection(style.styleId)}
                              />
                              <Thumbnail
                                source={style.styleImage ? SSActiveWearClient.buildImageUrl(style.styleImage, 'small') : "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"}
                                alt={style.styleName}
                                size="small"
                              />
                              <BlockStack gap="050">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">{style.styleName}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{style.brandName} • {style.partNumber}</Text>
                              </BlockStack>
                            </InlineStack>
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </Box>

                  {/* Import Options */}
                  {selectedStyles.length > 0 && (
                    <>
                      <Divider />
                      <Layout>
                        <Layout.Section variant="oneHalf">
                          <Select
                            label="Price Rule"
                            options={[
                              { label: "No price rule", value: "" },
                              ...priceRules.map(r => ({ label: r.name, value: r.id })),
                            ]}
                            value={selectedPriceRule}
                            onChange={setSelectedPriceRule}
                          />
                        </Layout.Section>
                        <Layout.Section variant="oneHalf">
                          <TextField
                            label="Tags"
                            value={tags}
                            onChange={setTags}
                            autoComplete="off"
                            placeholder="new, summer, sale"
                          />
                        </Layout.Section>
                      </Layout>
                      <Button variant="primary" onClick={handleAddToQueue} loading={isLoading}>
                        Add {selectedStyles.length} Products to Queue
                      </Button>
                    </>
                  )}
                </BlockStack>
              </>
            )}
          </BlockStack>
        </Card>

        {/* Import Queue */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Import Queue</Text>
            {queue.length === 0 ? (
              <EmptyState
                heading="Queue is empty"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Search for products above and add them to the import queue.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={queue.length}
                selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                headings={[
                  { title: 'Image' },
                  { title: 'Product' },
                  { title: 'Part #' },
                  { title: 'Status' },
                  { title: 'Tags' },
                  { title: 'Added' },
                  { title: 'Actions' },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
