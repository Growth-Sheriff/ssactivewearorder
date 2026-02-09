import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    Divider,
    EmptyState,
    FormLayout,
    InlineGrid,
    InlineStack,
    Page,
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

  const rules = await prisma.volumePriceRule.findMany({
    where: { shop },
    include: {
      tiers: { orderBy: { sortOrder: "asc" } },
      sizePremiums: { orderBy: { sortOrder: "asc" } },
      _count: { select: { products: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json({ rules });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "create") {
    const name = (formData.get("name") as string) || "New Rule";
    const description = (formData.get("description") as string) || "";

    const rule = await prisma.volumePriceRule.create({
      data: {
        shop,
        name,
        description: description || null,
        // Create default tiers
        tiers: {
          create: [
            { minQty: 1, maxQty: 11, discountType: "percentage", discountValue: 0, sortOrder: 0 },
            { minQty: 12, maxQty: 24, discountType: "percentage", discountValue: 10, sortOrder: 1 },
            { minQty: 25, maxQty: 36, discountType: "percentage", discountValue: 20, sortOrder: 2 },
            { minQty: 37, maxQty: 72, discountType: "percentage", discountValue: 30, sortOrder: 3 },
            { minQty: 73, maxQty: 144, discountType: "percentage", discountValue: 40, sortOrder: 4 },
            { minQty: 145, maxQty: 288, discountType: "percentage", discountValue: 50, sortOrder: 5 },
            { minQty: 289, maxQty: null, discountType: "percentage", discountValue: 60, sortOrder: 6 },
          ],
        },
      },
    });

    return json({ success: true, message: "Rule created", ruleId: rule.id });
  }

  if (actionType === "delete") {
    const ruleId = formData.get("ruleId") as string;
    await prisma.volumePriceRule.delete({ where: { id: ruleId } });
    return json({ success: true, message: "Rule deleted" });
  }

  if (actionType === "toggle") {
    const ruleId = formData.get("ruleId") as string;
    const rule = await prisma.volumePriceRule.findUnique({ where: { id: ruleId } });
    if (rule) {
      await prisma.volumePriceRule.update({
        where: { id: ruleId },
        data: { isActive: !rule.isActive },
      });
    }
    return json({ success: true, message: "Rule toggled" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function VolumePricingPage() {
  const { rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleDesc, setNewRuleDesc] = useState("");
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "create");
    formData.set("name", newRuleName || "New Rule");
    formData.set("description", newRuleDesc);
    submit(formData, { method: "POST" });
    setShowCreateModal(false);
    setNewRuleName("");
    setNewRuleDesc("");
  }, [newRuleName, newRuleDesc, submit]);

  const handleDelete = useCallback(() => {
    if (!deleteRuleId) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("ruleId", deleteRuleId);
    submit(formData, { method: "POST" });
    setDeleteRuleId(null);
  }, [deleteRuleId, submit]);

  const handleToggle = useCallback((ruleId: string) => {
    const formData = new FormData();
    formData.set("action", "toggle");
    formData.set("ruleId", ruleId);
    submit(formData, { method: "POST" });
  }, [submit]);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Volume Pricing"
      subtitle="Quantity-based pricing rules for imported products"
      primaryAction={{
        content: "Create Rule",
        icon: PlusIcon,
        onAction: () => setShowCreateModal(true),
      }}
    >
      <TitleBar title="Volume Pricing" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Stats */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Total Rules</Text>
              <Text as="p" variant="heading2xl">{rules.length}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Active Rules</Text>
              <Text as="p" variant="heading2xl">{rules.filter(r => r.isActive).length}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Total Products</Text>
              <Text as="p" variant="heading2xl">{rules.reduce((sum, r) => sum + (r._count?.products || 0), 0)}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Rules List */}
        {rules.length === 0 ? (
          <Card>
            <EmptyState
              heading="No volume pricing rules"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Create your first rule",
                onAction: () => setShowCreateModal(true),
              }}
            >
              <p>Create quantity-based pricing rules and assign imported products to automatically sync prices from SSActiveWear.</p>
            </EmptyState>
          </Card>
        ) : (
          <BlockStack gap="400">
            {rules.map((rule) => (
              <Card key={rule.id}>
                <BlockStack gap="400">
                  {/* Header */}
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="h2" variant="headingMd" fontWeight="bold">{rule.name}</Text>
                      <Badge tone={rule.isActive ? "success" : undefined}>
                        {rule.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {rule.syncEnabled && (
                        <Badge tone="info">{`Auto-sync (${rule.syncIntervalDays}d)`}</Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button
                        icon={EditIcon}
                        onClick={() => navigate(`/app/volume-pricing/${rule.id}`)}
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => handleToggle(rule.id)}
                        tone={rule.isActive ? undefined : "success" as any}
                      >
                        {rule.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        icon={DeleteIcon}
                        variant="primary"
                        tone="critical"
                        onClick={() => setDeleteRuleId(rule.id)}
                      />
                    </InlineStack>
                  </InlineStack>

                  {rule.description && (
                    <Text as="p" variant="bodySm" tone="subdued">{rule.description}</Text>
                  )}

                  <Divider />

                  {/* Tiers Preview */}
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">Quantity Tiers</Text>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "#f6f6f7" }}>
                            {rule.tiers.map((tier, i) => (
                              <th key={i} style={{
                                padding: "8px 12px",
                                textAlign: "center",
                                borderBottom: "2px solid #e1e3e5",
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                              }}>
                                {`${tier.minQty}-${tier.maxQty || "+"}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {rule.tiers.map((tier, i) => (
                              <td key={i} style={{
                                padding: "8px 12px",
                                textAlign: "center",
                                borderBottom: "1px solid #e1e3e5",
                                color: tier.discountValue > 0 ? "#008060" : "#637381",
                                fontWeight: tier.discountValue > 0 ? 600 : 400,
                              }}>
                                {tier.discountType === "percentage"
                                  ? `${tier.discountValue}%`
                                  : `$${tier.discountValue.toFixed(2)}`}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </BlockStack>

                  {/* Size Premiums & Product Count */}
                  <InlineStack align="space-between">
                    <InlineStack gap="200">
                      {rule.sizePremiums.length > 0 ? (
                        <Badge>{`${rule.sizePremiums.length} size premium(s)`}</Badge>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">{"No size premiums"}</Text>
                      )}
                    </InlineStack>
                    <Badge tone="info">
                      {`${rule._count?.products || 0} product(s) assigned`}
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}
      </BlockStack>

      {/* Create Form */}
      {showCreateModal && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Create Volume Pricing Rule</Text>
              <Button onClick={() => setShowCreateModal(false)}>Cancel</Button>
            </InlineStack>
            <Divider />
            <FormLayout>
              <TextField
                label="Rule Name"
                value={newRuleName}
                onChange={setNewRuleName}
                placeholder="e.g. Unisex Adult Crewneck"
                autoComplete="off"
              />
              <TextField
                label="Description (optional)"
                value={newRuleDesc}
                onChange={setNewRuleDesc}
                placeholder="e.g. Volume pricing for standard t-shirts"
                multiline={2}
                autoComplete="off"
              />
              <Banner tone="info">
                {"Default quantity tiers (1-11: 0%, 12-24: 10%, 25-36: 20%, etc.) will be created. You can customize them after."}
              </Banner>
              <InlineStack gap="200">
                <Button variant="primary" onClick={handleCreate} loading={isSubmitting}>Create</Button>
                <Button onClick={() => setShowCreateModal(false)}>Cancel</Button>
              </InlineStack>
            </FormLayout>
          </BlockStack>
        </Card>
      )}

      {/* Delete Confirmation */}
      {deleteRuleId && (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Delete Rule?</Text>
            <Divider />
            <Text as="p">{"This will permanently delete this pricing rule and remove all product assignments. Products will no longer have volume pricing."}</Text>
            <InlineStack gap="200">
              <Button variant="primary" tone="critical" onClick={handleDelete} loading={isSubmitting}>Delete</Button>
              <Button onClick={() => setDeleteRuleId(null)}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </Page>
  );
}
