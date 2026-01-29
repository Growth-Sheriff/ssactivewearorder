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
    Divider,
    EmptyState,
    Icon,
    IndexTable,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text,
    TextField,
    useIndexResourceState,
} from "@shopify/polaris";
import {
    PersonIcon,
    PlusIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface StaffItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const staff = await prisma.staffMember.findMany({
    where: { shop },
    orderBy: { createdAt: 'desc' },
  });

  // Define available roles and permissions
  const roles = [
    {
      id: "admin",
      name: "Admin",
      description: "Full access to all features",
      permissions: ["all"],
    },
    {
      id: "manager",
      name: "Manager",
      description: "Can manage products, orders, but not settings",
      permissions: ["products", "orders", "reports", "favorites"],
    },
    {
      id: "viewer",
      name: "Viewer",
      description: "Read-only access to dashboard and reports",
      permissions: ["dashboard", "reports"],
    },
  ];

  const permissionsList = [
    { id: "dashboard", name: "Dashboard" },
    { id: "products", name: "Product Import" },
    { id: "orders", name: "Order Management" },
    { id: "settings", name: "Settings" },
    { id: "reports", name: "Reports" },
    { id: "favorites", name: "Favorites" },
    { id: "automation", name: "Automation" },
    { id: "sync", name: "Catalog Sync" },
  ];

  return json({
    staff: staff.map((s): StaffItem => ({
      ...s,
      lastLogin: s.lastLogin?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
    })),
    roles,
    permissionsList,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "invite") {
    const email = formData.get("email") as string;
    const name = formData.get("name") as string;
    const role = formData.get("role") as string;

    // Check if already exists
    const existing = await prisma.staffMember.findUnique({
      where: { shop_email: { shop, email } },
    });

    if (existing) {
      return json({ success: false, message: "Staff member with this email already exists" });
    }

    await prisma.staffMember.create({
      data: {
        shop,
        email,
        name: name || null,
        role,
        isActive: true,
      },
    });

    return json({ success: true, message: "Staff member invited successfully" });
  }

  if (action === "update") {
    const staffId = formData.get("staffId") as string;
    const name = formData.get("name") as string;
    const role = formData.get("role") as string;

    await prisma.staffMember.update({
      where: { id: staffId },
      data: { name: name || null, role },
    });

    return json({ success: true, message: "Staff member updated" });
  }

  if (action === "toggleActive") {
    const staffId = formData.get("staffId") as string;
    const member = await prisma.staffMember.findUnique({ where: { id: staffId } });

    if (member) {
      await prisma.staffMember.update({
        where: { id: staffId },
        data: { isActive: !member.isActive },
      });
    }

    return json({ success: true, message: member?.isActive ? "Staff member deactivated" : "Staff member activated" });
  }

  if (action === "delete") {
    const staffId = formData.get("staffId") as string;
    await prisma.staffMember.delete({ where: { id: staffId } });
    return json({ success: true, message: "Staff member removed" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function StaffPage() {
  const { staff, roles, permissionsList } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffItem | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("viewer");

  const isLoading = navigation.state === "submitting";

  const resourceName = { singular: 'staff member', plural: 'staff members' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(staff);

  const resetForm = useCallback(() => {
    setEmail("");
    setName("");
    setRole("viewer");
    setEditingStaff(null);
  }, []);

  const openInviteModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback((member: StaffItem) => {
    setEditingStaff(member);
    setEmail(member.email);
    setName(member.name || "");
    setRole(member.role);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("action", editingStaff ? "update" : "invite");
    if (editingStaff) formData.set("staffId", editingStaff.id);
    formData.set("email", email);
    formData.set("name", name);
    formData.set("role", role);
    submit(formData, { method: "POST" });
    setModalOpen(false);
    resetForm();
  }, [editingStaff, email, name, role, submit, resetForm]);

  const handleToggle = useCallback((staffId: string) => {
    const formData = new FormData();
    formData.set("action", "toggleActive");
    formData.set("staffId", staffId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleDelete = useCallback((staffId: string) => {
    if (!confirm("Remove this staff member?")) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("staffId", staffId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const getRoleBadge = (roleId: string) => {
    switch (roleId) {
      case "admin":
        return <Badge tone="success">Admin</Badge>;
      case "manager":
        return <Badge tone="info">Manager</Badge>;
      default:
        return <Badge>Viewer</Badge>;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString();
  };

  const rowMarkup = staff.map((member, index) => (
    <IndexTable.Row
      id={member.id}
      key={member.id}
      selected={selectedResources.includes(member.id)}
      position={index}
    >
      <IndexTable.Cell>
        <InlineStack gap="300">
          <Box background="bg-fill-secondary" padding="200" borderRadius="full">
            <Icon source={PersonIcon} />
          </Box>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {member.name || member.email}
            </Text>
            {member.name && (
              <Text as="span" variant="bodySm" tone="subdued">{member.email}</Text>
            )}
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {getRoleBadge(member.role)}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={member.isActive ? "success" : "subdued"}>
          {member.isActive ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(member.lastLogin)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(member.createdAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          <Button size="slim" variant="plain" onClick={() => openEditModal(member)}>
            Edit
          </Button>
          <Button size="slim" variant="plain" onClick={() => handleToggle(member.id)}>
            {member.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(member.id)}>
            Remove
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Staff & Permissions"
      subtitle="Manage team access and roles"
      primaryAction={{
        content: "Invite Staff",
        icon: PlusIcon,
        onAction: openInviteModal,
      }}
    >
      <TitleBar title="Staff" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Roles Overview */}
        <Layout>
          {roles.map(r => (
            <Layout.Section key={r.id} variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    {getRoleBadge(r.id)}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {staff.filter(s => s.role === r.id).length} members
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">{r.description}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          ))}
        </Layout>

        {/* Staff List */}
        {staff.length === 0 ? (
          <Card>
            <EmptyState
              heading="No staff members"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Invite Staff",
                onAction: openInviteModal,
              }}
            >
              <p>Invite team members to help manage your store's SSActiveWear integration.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={staff.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Member' },
                { title: 'Role' },
                { title: 'Status' },
                { title: 'Last Login' },
                { title: 'Added' },
                { title: 'Actions' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Permissions Reference */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Permissions Reference</Text>
            <Divider />
            <Layout>
              {permissionsList.map(p => (
                <Layout.Section key={p.id} variant="oneThird">
                  <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                    <InlineStack gap="200">
                      <Badge size="small">{p.id}</Badge>
                      <Text as="span" variant="bodySm">{p.name}</Text>
                    </InlineStack>
                  </Box>
                </Layout.Section>
              ))}
            </Layout>
          </BlockStack>
        </Card>

        {/* Invite/Edit Modal */}
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); resetForm(); }}
          title={editingStaff ? "Edit Staff Member" : "Invite Staff Member"}
          primaryAction={{
            content: editingStaff ? "Save Changes" : "Send Invite",
            onAction: handleSubmit,
            loading: isLoading,
            disabled: !email,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => { setModalOpen(false); resetForm(); } },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="team@example.com"
                disabled={!!editingStaff}
              />
              <TextField
                label="Name (optional)"
                value={name}
                onChange={setName}
                autoComplete="name"
                placeholder="John Doe"
              />
              <Select
                label="Role"
                options={roles.map(r => ({ label: r.name, value: r.id }))}
                value={role}
                onChange={setRole}
                helpText={roles.find(r => r.id === role)?.description}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
