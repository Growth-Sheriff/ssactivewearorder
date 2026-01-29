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
    EmptyState,
    InlineGrid,
    InlineStack,
    Modal,
    Page,
    Text,
    TextField,
    Thumbnail
} from "@shopify/polaris";
import {
    DeleteIcon,
    EditIcon,
    ImportIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const favorites = await prisma.favorite.findMany({
    where: { shop },
    orderBy: { createdAt: 'desc' },
  });

  return json({ favorites });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "remove") {
    const favoriteId = formData.get("favoriteId") as string;
    await prisma.favorite.delete({
      where: { id: favoriteId },
    });
    return json({ success: true, message: "Removed from favorites" });
  }

  if (action === "updateNotes") {
    const favoriteId = formData.get("favoriteId") as string;
    const notes = formData.get("notes") as string;
    const tags = formData.get("tags") as string;

    await prisma.favorite.update({
      where: { id: favoriteId },
      data: { notes, tags },
    });
    return json({ success: true, message: "Notes updated" });
  }

  if (action === "addToQueue") {
    const styleId = formData.get("styleId") as string;

    // Add to import queue
    await prisma.importQueue.create({
      data: {
        shop,
        styleId: parseInt(styleId),
        status: "pending",
      },
    });
    return json({ success: true, message: "Added to import queue" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function FavoritesPage() {
  const { favorites } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [selectedFavorite, setSelectedFavorite] = useState<typeof favorites[0] | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  const isLoading = navigation.state === "submitting";

  const handleRemove = useCallback((favoriteId: string) => {
    if (confirm("Remove this product from favorites?")) {
      const formData = new FormData();
      formData.set("action", "remove");
      formData.set("favoriteId", favoriteId);
      submit(formData, { method: "POST" });
    }
  }, [submit]);

  const handleEdit = useCallback((favorite: typeof favorites[0]) => {
    setSelectedFavorite(favorite);
    setNotes(favorite.notes || "");
    setTags(favorite.tags || "");
    setEditModalOpen(true);
  }, []);

  const handleSaveNotes = useCallback(() => {
    if (!selectedFavorite) return;
    const formData = new FormData();
    formData.set("action", "updateNotes");
    formData.set("favoriteId", selectedFavorite.id);
    formData.set("notes", notes);
    formData.set("tags", tags);
    submit(formData, { method: "POST" });
    setEditModalOpen(false);
  }, [selectedFavorite, notes, tags, submit]);

  const handleImport = useCallback((styleId: number) => {
    const formData = new FormData();
    formData.set("action", "addToQueue");
    formData.set("styleId", styleId.toString());
    submit(formData, { method: "POST" });
  }, [submit]);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="My Favorites"
      subtitle="Save products for later and quickly import them"
      primaryAction={{
        content: "Browse Catalog",
        url: "/app/catalog",
      }}
    >
      <TitleBar title="Favorites" />
      <BlockStack gap="600">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {favorites.length === 0 ? (
          <Card>
            <EmptyState
              heading="No favorites yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Browse Catalog",
                url: "/app/catalog",
              }}
            >
              <p>Start exploring the SSActiveWear catalog and save products you're interested in.</p>
            </EmptyState>
          </Card>
        ) : (
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
            {favorites.map((favorite) => (
              <Card key={favorite.id}>
                <BlockStack gap="300">
                  {/* Image */}
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <Thumbnail
                        source={favorite.styleImage ? SSActiveWearClient.buildImageUrl(favorite.styleImage, 'medium') : "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"}
                        alt={favorite.styleName}
                        size="large"
                      />
                    </div>
                  </Box>

                  {/* Info */}
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">{favorite.styleName}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{favorite.brandName}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">#{favorite.partNumber}</Text>
                  </BlockStack>

                  {/* Tags */}
                  {favorite.tags && (
                    <InlineStack gap="100" wrap>
                      {favorite.tags.split(',').map((tag, idx) => (
                        <Badge key={idx} size="small">{tag.trim()}</Badge>
                      ))}
                    </InlineStack>
                  )}

                  {/* Notes */}
                  {favorite.notes && (
                    <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                      <Text as="p" variant="bodySm" tone="subdued">{favorite.notes}</Text>
                    </Box>
                  )}

                  {/* Actions */}
                  <InlineStack gap="200">
                    <Button
                      icon={ImportIcon}
                      size="slim"
                      onClick={() => handleImport(favorite.styleId)}
                      loading={isLoading}
                    >
                      Import
                    </Button>
                    <Button
                      icon={EditIcon}
                      size="slim"
                      variant="plain"
                      onClick={() => handleEdit(favorite)}
                    >
                      Notes
                    </Button>
                    <Button
                      icon={DeleteIcon}
                      size="slim"
                      variant="plain"
                      tone="critical"
                      onClick={() => handleRemove(favorite.id)}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        )}

        {/* Edit Notes Modal */}
        <Modal
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          title="Edit Notes"
          primaryAction={{
            content: "Save",
            onAction: handleSaveNotes,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setEditModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                multiline={3}
                autoComplete="off"
                placeholder="Add notes about this product..."
              />
              <TextField
                label="Tags"
                value={tags}
                onChange={setTags}
                autoComplete="off"
                placeholder="summer, bestseller, priority (comma separated)"
                helpText="Add custom tags to organize your favorites"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
