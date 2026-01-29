import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    Checkbox,
    Divider,
    EmptyState,
    FormLayout,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text,
    TextField
} from "@shopify/polaris";
import {
    DeleteIcon,
    EditIcon,
    PlusIcon,
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const priceRules = await prisma.priceRule.findMany({
    where: { shop },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });

  const brands = await prisma.sSBrand.findMany({
    orderBy: { name: 'asc' },
    select: { brandId: true, name: true },
  });

  const categories = await prisma.sSCategory.findMany({
    orderBy: { name: 'asc' },
    select: { categoryId: true, name: true },
  });

  return json({ priceRules, brands, categories });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create" || action === "update") {
    const data = {
      shop,
      name: formData.get("name") as string,
      type: formData.get("type") as string,
      value: parseFloat(formData.get("value") as string) || 0,
      applyTo: formData.get("applyTo") as string,
      applyToValue: formData.get("applyToValue") as string || null,
      roundTo: parseFloat(formData.get("roundTo") as string) || 0.99,
      minMargin: parseFloat(formData.get("minMargin") as string) || 0,
      isActive: formData.get("isActive") === "true",
      priority: parseInt(formData.get("priority") as string) || 0,
    };

    if (action === "create") {
      await prisma.priceRule.create({ data });
      return json({ success: true, message: "Price rule created" });
    } else {
      const ruleId = formData.get("ruleId") as string;
      await prisma.priceRule.update({
        where: { id: ruleId },
        data,
      });
      return json({ success: true, message: "Price rule updated" });
    }
  }

  if (action === "delete") {
    const ruleId = formData.get("ruleId") as string;
    await prisma.priceRule.delete({ where: { id: ruleId } });
    return json({ success: true, message: "Price rule deleted" });
  }

  if (action === "toggle") {
    const ruleId = formData.get("ruleId") as string;
    const rule = await prisma.priceRule.findUnique({ where: { id: ruleId } });
    if (rule) {
      await prisma.priceRule.update({
        where: { id: ruleId },
        data: { isActive: !rule.isActive },
      });
    }
    return json({ success: true, message: "Rule toggled" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function PriceRulesPage() {
  const { priceRules, brands, categories } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<typeof priceRules[0] | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("percentage");
  const [value, setValue] = useState("25");
  const [applyTo, setApplyTo] = useState("all");
  const [applyToValue, setApplyToValue] = useState("");
  const [roundTo, setRoundTo] = useState("0.99");
  const [minMargin, setMinMargin] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState("0");

  const isLoading = navigation.state === "submitting";

  const resetForm = useCallback(() => {
    setName("");
    setType("percentage");
    setValue("25");
    setApplyTo("all");
    setApplyToValue("");
    setRoundTo("0.99");
    setMinMargin("0");
    setIsActive(true);
    setPriority("0");
    setEditingRule(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback((rule: typeof priceRules[0]) => {
    setEditingRule(rule);
    setName(rule.name);
    setType(rule.type);
    setValue(rule.value.toString());
    setApplyTo(rule.applyTo);
    setApplyToValue(rule.applyToValue || "");
    setRoundTo(rule.roundTo.toString());
    setMinMargin(rule.minMargin.toString());
    setIsActive(rule.isActive);
    setPriority(rule.priority.toString());
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("action", editingRule ? "update" : "create");
    if (editingRule) formData.set("ruleId", editingRule.id);
    formData.set("name", name);
    formData.set("type", type);
    formData.set("value", value);
    formData.set("applyTo", applyTo);
    formData.set("applyToValue", applyToValue);
    formData.set("roundTo", roundTo);
    formData.set("minMargin", minMargin);
    formData.set("isActive", isActive.toString());
    formData.set("priority", priority);
    submit(formData, { method: "POST" });
    setModalOpen(false);
    resetForm();
  }, [editingRule, name, type, value, applyTo, applyToValue, roundTo, minMargin, isActive, priority, submit, resetForm]);

  const handleDelete = useCallback((ruleId: string) => {
    if (!confirm("Delete this price rule?")) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("ruleId", ruleId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleToggle = useCallback((ruleId: string) => {
    const formData = new FormData();
    formData.set("action", "toggle");
    formData.set("ruleId", ruleId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const getTypeLabel = (t: string) => {
    switch (t) {
      case "percentage": return "Percentage Markup";
      case "fixed": return "Fixed Amount";
      case "multiplier": return "Multiplier";
      default: return t;
    }
  };

  const getApplyToLabel = (a: string, val: string | null) => {
    if (a === "all") return "All Products";
    if (a === "brand") return `Brand: ${val}`;
    if (a === "category") return `Category: ${val}`;
    return a;
  };

  const calculateExample = (t: string, v: number) => {
    const cost = 10;
    let price = cost;
    if (t === "percentage") price = cost * (1 + v / 100);
    else if (t === "fixed") price = cost + v;
    else if (t === "multiplier") price = cost * v;
    return price.toFixed(2);
  };

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Price Rules"
      subtitle="Set markup rules for automatic pricing when importing products"
      primaryAction={{
        content: "Create Rule",
        icon: PlusIcon,
        onAction: openCreateModal,
      }}
    >
      <TitleBar title="Price Rules" />
      <BlockStack gap="600">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* How It Works */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How Price Rules Work</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              When you import products, these rules automatically calculate the selling price based on SSActiveWear's wholesale cost.
              Rules are applied in priority order (lowest number first). The first matching rule is used.
            </Text>
            <InlineStack gap="400">
              <Badge tone="info">Percentage: Cost × (1 + %)</Badge>
              <Badge tone="info">Fixed: Cost + Amount</Badge>
              <Badge tone="info">Multiplier: Cost × Value</Badge>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Rules List */}
        {priceRules.length === 0 ? (
          <Card>
            <EmptyState
              heading="No price rules yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Create First Rule",
                onAction: openCreateModal,
              }}
            >
              <p>Create price rules to automatically set product prices when importing from SSActiveWear.</p>
            </EmptyState>
          </Card>
        ) : (
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                {priceRules.map((rule) => (
                  <Card key={rule.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h3" variant="headingMd">{rule.name}</Text>
                            {rule.isActive ? (
                              <Badge tone="success">Active</Badge>
                            ) : (
                              <Badge tone="subdued">Inactive</Badge>
                            )}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Priority: {rule.priority}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button size="slim" variant="plain" onClick={() => handleToggle(rule.id)}>
                            {rule.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button size="slim" icon={EditIcon} onClick={() => openEditModal(rule)}>
                            Edit
                          </Button>
                          <Button size="slim" icon={DeleteIcon} tone="critical" variant="plain" onClick={() => handleDelete(rule.id)}>
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                      <Divider />
                      <InlineStack gap="600">
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Type</Text>
                          <Text as="span" variant="bodyMd">{getTypeLabel(rule.type)}</Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Value</Text>
                          <Text as="span" variant="bodyMd">
                            {rule.type === "percentage" ? `${rule.value}%` : rule.type === "multiplier" ? `×${rule.value}` : `$${rule.value}`}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Applies To</Text>
                          <Text as="span" variant="bodyMd">{getApplyToLabel(rule.applyTo, rule.applyToValue)}</Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Round To</Text>
                          <Text as="span" variant="bodyMd">.{rule.roundTo.toString().split('.')[1] || '99'}</Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Example</Text>
                          <Text as="span" variant="bodyMd">
                            $10.00 → ${calculateExample(rule.type, rule.value)}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}

        {/* Create/Edit Modal */}
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); resetForm(); }}
          title={editingRule ? "Edit Price Rule" : "Create Price Rule"}
          primaryAction={{
            content: editingRule ? "Save Changes" : "Create Rule",
            onAction: handleSubmit,
            loading: isLoading,
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
                label="Rule Name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="e.g., Standard 25% Markup"
              />

              <FormLayout.Group>
                <Select
                  label="Markup Type"
                  options={[
                    { label: "Percentage Markup", value: "percentage" },
                    { label: "Fixed Amount", value: "fixed" },
                    { label: "Multiplier", value: "multiplier" },
                  ]}
                  value={type}
                  onChange={setType}
                />
                <TextField
                  label={type === "percentage" ? "Percentage (%)" : type === "fixed" ? "Amount ($)" : "Multiplier"}
                  type="number"
                  value={value}
                  onChange={setValue}
                  autoComplete="off"
                  suffix={type === "percentage" ? "%" : type === "fixed" ? "$" : "×"}
                />
              </FormLayout.Group>

              <Select
                label="Apply To"
                options={[
                  { label: "All Products", value: "all" },
                  { label: "Specific Brand", value: "brand" },
                  { label: "Specific Category", value: "category" },
                ]}
                value={applyTo}
                onChange={setApplyTo}
              />

              {applyTo === "brand" && (
                <Select
                  label="Select Brand"
                  options={[
                    { label: "Select a brand...", value: "" },
                    ...brands.map(b => ({ label: b.name, value: b.name })),
                  ]}
                  value={applyToValue}
                  onChange={setApplyToValue}
                />
              )}

              {applyTo === "category" && (
                <Select
                  label="Select Category"
                  options={[
                    { label: "Select a category...", value: "" },
                    ...categories.map(c => ({ label: c.name, value: c.name })),
                  ]}
                  value={applyToValue}
                  onChange={setApplyToValue}
                />
              )}

              <FormLayout.Group>
                <TextField
                  label="Round Prices To"
                  type="number"
                  value={roundTo}
                  onChange={setRoundTo}
                  autoComplete="off"
                  helpText="e.g., 0.99 for $19.99, 0.00 for $20.00"
                />
                <TextField
                  label="Minimum Margin (%)"
                  type="number"
                  value={minMargin}
                  onChange={setMinMargin}
                  autoComplete="off"
                  helpText="Never sell below this margin"
                />
              </FormLayout.Group>

              <TextField
                label="Priority"
                type="number"
                value={priority}
                onChange={setPriority}
                autoComplete="off"
                helpText="Lower numbers are checked first (0 = highest priority)"
              />

              <Checkbox
                label="Rule is active"
                checked={isActive}
                onChange={setIsActive}
              />

              {/* Live Preview */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Preview</Text>
                  <Text as="p" variant="bodyMd">
                    If wholesale cost is <strong>$10.00</strong>, selling price will be{" "}
                    <strong>${calculateExample(type, parseFloat(value) || 0)}</strong>
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
