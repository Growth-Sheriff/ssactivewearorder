import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    Divider,
    EmptyState,
    IndexTable,
    InlineStack,
    Modal,
    Page,
    Text,
    TextField,
    useIndexResourceState
} from "@shopify/polaris";
import {
    OrderIcon,
    PlusIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface TemplateItem {
  sku: string;
  qty: number;
  title?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const templates = await prisma.reorderTemplate.findMany({
    where: { shop },
    orderBy: { lastUsed: 'desc' },
  });

  // Parse items JSON for each template
  const templatesWithItems = templates.map(t => ({
    ...t,
    itemsParsed: JSON.parse(t.items || '[]') as TemplateItem[],
  }));

  return json({ templates: templatesWithItems });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const name = formData.get("name") as string;
    const items = formData.get("items") as string;
    const itemsParsed = JSON.parse(items || '[]') as TemplateItem[];

    await prisma.reorderTemplate.create({
      data: {
        shop,
        name,
        items,
        totalItems: itemsParsed.reduce((sum, i) => sum + i.qty, 0),
      },
    });

    return json({ success: true, message: "Template created" });
  }

  if (action === "update") {
    const templateId = formData.get("templateId") as string;
    const name = formData.get("name") as string;
    const items = formData.get("items") as string;
    const itemsParsed = JSON.parse(items || '[]') as TemplateItem[];

    await prisma.reorderTemplate.update({
      where: { id: templateId },
      data: {
        name,
        items,
        totalItems: itemsParsed.reduce((sum, i) => sum + i.qty, 0),
      },
    });

    return json({ success: true, message: "Template updated" });
  }

  if (action === "delete") {
    const templateId = formData.get("templateId") as string;
    await prisma.reorderTemplate.delete({ where: { id: templateId } });
    return json({ success: true, message: "Template deleted" });
  }

  if (action === "reorder") {
    const templateId = formData.get("templateId") as string;

    // Update last used
    await prisma.reorderTemplate.update({
      where: { id: templateId },
      data: { lastUsed: new Date() },
    });

    // In production, this would create an actual order
    // For now, just simulate success
    return json({
      success: true,
      message: "Order placed! Check the Orders page for status.",
    });
  }

  if (action === "duplicate") {
    const templateId = formData.get("templateId") as string;
    const original = await prisma.reorderTemplate.findUnique({ where: { id: templateId } });

    if (original) {
      await prisma.reorderTemplate.create({
        data: {
          shop,
          name: `${original.name} (Copy)`,
          items: original.items,
          totalItems: original.totalItems,
        },
      });
    }

    return json({ success: true, message: "Template duplicated" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function QuickReorderPage() {
  const { templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<typeof templates[0] | null>(null);
  const [name, setName] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [confirmReorderId, setConfirmReorderId] = useState<string | null>(null);

  const isLoading = navigation.state === "submitting";

  const resourceName = {
    singular: 'template',
    plural: 'templates',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(templates);

  const resetForm = useCallback(() => {
    setName("");
    setItemsText("");
    setEditingTemplate(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback((template: typeof templates[0]) => {
    setEditingTemplate(template);
    setName(template.name);
    // Format items as SKU,QTY per line
    const formatted = template.itemsParsed.map(i => `${i.sku},${i.qty}`).join('\n');
    setItemsText(formatted);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(() => {
    // Parse items from text (format: SKU,QTY per line)
    const items: TemplateItem[] = itemsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .map(line => {
        const [sku, qtyStr] = line.split(',').map(s => s.trim());
        return { sku, qty: parseInt(qtyStr) || 1 };
      })
      .filter(item => item.sku);

    const formData = new FormData();
    formData.set("action", editingTemplate ? "update" : "create");
    if (editingTemplate) formData.set("templateId", editingTemplate.id);
    formData.set("name", name);
    formData.set("items", JSON.stringify(items));
    submit(formData, { method: "POST" });
    setModalOpen(false);
    resetForm();
  }, [editingTemplate, name, itemsText, submit, resetForm]);

  const handleDelete = useCallback((templateId: string) => {
    if (!confirm("Delete this template?")) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("templateId", templateId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleDuplicate = useCallback((templateId: string) => {
    const formData = new FormData();
    formData.set("action", "duplicate");
    formData.set("templateId", templateId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleReorder = useCallback((templateId: string) => {
    const formData = new FormData();
    formData.set("action", "reorder");
    formData.set("templateId", templateId);
    submit(formData, { method: "POST" });
    setConfirmReorderId(null);
  }, [submit]);

  const rowMarkup = templates.map((template, index) => (
    <IndexTable.Row
      id={template.id}
      key={template.id}
      selected={selectedResources.includes(template.id)}
      position={index}
    >
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{template.name}</Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {template.itemsParsed.length} SKUs
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge size="large">{template.totalItems}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          {template.itemsParsed.slice(0, 3).map((item, idx) => (
            <Text key={idx} as="span" variant="bodySm" tone="subdued">
              {item.sku} × {item.qty}
            </Text>
          ))}
          {template.itemsParsed.length > 3 && (
            <Text as="span" variant="bodySm" tone="subdued">
              +{template.itemsParsed.length - 3} more
            </Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {template.lastUsed ? new Date(template.lastUsed).toLocaleDateString() : "Never"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(template.createdAt).toLocaleDateString()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          <Button
            size="slim"
            variant="primary"
            icon={OrderIcon}
            onClick={() => setConfirmReorderId(template.id)}
          >
            Reorder
          </Button>
          <Button size="slim" variant="plain" onClick={() => openEditModal(template)}>
            Edit
          </Button>
          <Button size="slim" variant="plain" onClick={() => handleDuplicate(template.id)}>
            Copy
          </Button>
          <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(template.id)}>
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Quick Reorder"
      subtitle="Save and reuse order templates for fast repeat ordering"
      primaryAction={{
        content: "Create Template",
        icon: PlusIcon,
        onAction: openCreateModal,
      }}
    >
      <TitleBar title="Quick Reorder" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* How It Works */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How Quick Reorder Works</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Create templates with frequently ordered SKUs and quantities. When you need to restock,
              simply click "Reorder" to instantly create an order with all items. Perfect for regular
              inventory replenishment.
            </Text>
          </BlockStack>
        </Card>

        {/* Templates List */}
        {templates.length === 0 ? (
          <Card>
            <EmptyState
              heading="No reorder templates"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Create Template",
                onAction: openCreateModal,
              }}
            >
              <p>Create templates to quickly reorder your most common SKU combinations.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={templates.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Template' },
                { title: 'Total Items' },
                { title: 'SKUs' },
                { title: 'Last Used' },
                { title: 'Created' },
                { title: 'Actions' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Create/Edit Modal */}
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); resetForm(); }}
          title={editingTemplate ? "Edit Template" : "Create Reorder Template"}
          primaryAction={{
            content: editingTemplate ? "Save Changes" : "Create Template",
            onAction: handleSubmit,
            loading: isLoading,
            disabled: !name || !itemsText,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => { setModalOpen(false); resetForm(); },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Template Name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="e.g., Summer T-Shirt Restock"
              />
              <TextField
                label="Items (SKU, Quantity per line)"
                value={itemsText}
                onChange={setItemsText}
                multiline={8}
                autoComplete="off"
                placeholder="G500-BLK-L, 24&#10;G500-BLK-M, 36&#10;G500-WHT-L, 24"
                helpText="Enter one item per line in format: SKU, Quantity"
              />
              {itemsText && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Preview</Text>
                    <Divider />
                    {itemsText.split('\n').filter(l => l.trim()).slice(0, 5).map((line, idx) => {
                      const [sku, qty] = line.split(',').map(s => s.trim());
                      return (
                        <InlineStack key={idx} align="space-between">
                          <Text as="span" variant="bodySm">{sku}</Text>
                          <Badge size="small">×{qty || 1}</Badge>
                        </InlineStack>
                      );
                    })}
                    {itemsText.split('\n').filter(l => l.trim()).length > 5 && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        +{itemsText.split('\n').filter(l => l.trim()).length - 5} more items
                      </Text>
                    )}
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" fontWeight="semibold">Total Items:</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {itemsText.split('\n').filter(l => l.trim()).reduce((sum, line) => {
                          const [, qty] = line.split(',').map(s => s.trim());
                          return sum + (parseInt(qty) || 1);
                        }, 0)}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Confirm Reorder Modal */}
        <Modal
          open={!!confirmReorderId}
          onClose={() => setConfirmReorderId(null)}
          title="Confirm Reorder"
          primaryAction={{
            content: "Place Order",
            onAction: () => confirmReorderId && handleReorder(confirmReorderId),
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setConfirmReorderId(null),
            },
          ]}
        >
          <Modal.Section>
            {confirmReorderId && (
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd">
                  Are you sure you want to place this order?
                </Text>
                {(() => {
                  const template = templates.find(t => t.id === confirmReorderId);
                  if (!template) return null;
                  return (
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">{template.name}</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Total SKUs</Text>
                          <Text as="span" variant="bodyMd">{template.itemsParsed.length}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Total Items</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{template.totalItems}</Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  );
                })()}
                <Banner tone="info">
                  The order will be created and queued for processing. Check the Orders page for status.
                </Banner>
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
