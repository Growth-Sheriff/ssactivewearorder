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
    DropZone,
    EmptyState,
    Icon,
    InlineGrid,
    InlineStack,
    Modal,
    Page,
    ProgressBar,
    Select,
    Text,
    TextField,
    Thumbnail
} from "@shopify/polaris";
import {
    CartIcon,
    DeleteIcon,
    ImageIcon
} from "@shopify/polaris-icons";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

interface ColorVariant {
  colorCode: string;
  colorName: string;
  colorSwatchImage: string;
  colorSwatchTextColor: string;
  colorFrontImage: string;
}

interface SizeOption {
  sizeName: string;
  sizeOrder: string;
  piecePrice: number;
  qty: number; // Available stock
}

interface CartItem {
  sku: string;
  colorCode: string;
  colorName: string;
  sizeName: string;
  quantity: number;
  price: number;
  designUrl?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const styleId = url.searchParams.get("styleId");

  // Get imported styles for selection
  const importedProducts = await prisma.productMap.findMany({
    where: { shop },
    take: 200,
    select: { ssStyleId: true },
  });

  const styleIds = [...new Set(importedProducts.map(p => parseInt(p.ssStyleId)))].filter(id => !isNaN(id));

  // Try to get style details from cache first
  let styleDetails = await prisma.sSStyleCache.findMany({
    where: { styleId: { in: styleIds } },
    select: { styleId: true, styleName: true, brandName: true, styleImage: true },
    take: 50,
  });

  // Fallback: if cache is empty, build from productMap data
  if (styleDetails.length === 0 && styleIds.length > 0) {
    styleDetails = styleIds.map(sid => ({
      styleId: sid,
      styleName: `Style ${sid}`,
      brandName: "",
      styleImage: null,
    }));
  }

  let selectedStyleProducts: SSProduct[] = [];
  let colorVariants: ColorVariant[] = [];
  let sizeOptions: Map<string, SizeOption[]> = new Map();

  if (styleId) {
    const ssClient = new SSActiveWearClient();
    try {
      selectedStyleProducts = await ssClient.getProducts(parseInt(styleId));

      // Group by color
      const colorMap = new Map<string, ColorVariant>();
      const sizesPerColor = new Map<string, SizeOption[]>();

      selectedStyleProducts.forEach(product => {
        // Add color variant
        if (!colorMap.has(product.colorCode)) {
          colorMap.set(product.colorCode, {
            colorCode: product.colorCode,
            colorName: product.colorName,
            colorSwatchImage: product.colorSwatchImage,
            colorSwatchTextColor: product.colorSwatchTextColor || "#000",
            colorFrontImage: product.colorFrontImage || product.colorSwatchImage,
          });
          sizesPerColor.set(product.colorCode, []);
        }

        // Add size option for this color
        const sizes = sizesPerColor.get(product.colorCode) || [];
        sizes.push({
          sizeName: product.sizeName,
          sizeOrder: product.sizeOrder,
          piecePrice: product.piecePrice,
          qty: product.qty,
        });
        sizesPerColor.set(product.colorCode, sizes);
      });

      // Sort sizes
      sizesPerColor.forEach((sizes, colorCode) => {
        sizes.sort((a, b) => parseInt(a.sizeOrder) - parseInt(b.sizeOrder));
        sizesPerColor.set(colorCode, sizes);
      });

      colorVariants = Array.from(colorMap.values());
      sizeOptions = sizesPerColor;
    } catch (error) {
      console.error("Failed to fetch products:", error);
    }
  }

  // Load saved cart from session or DB
  const savedCart = await prisma.reorderCart.findFirst({
    where: { shop },
    orderBy: { updatedAt: 'desc' },
  });

  return json({
    styles: styleDetails,
    selectedStyleId: styleId ? parseInt(styleId) : null,
    colorVariants,
    sizeOptions: Object.fromEntries(sizeOptions),
    products: selectedStyleProducts,
    cart: savedCart ? (JSON.parse(savedCart.items) as CartItem[]) : [],
    cartId: savedCart?.id,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "addToCart") {
    const cartData = formData.get("cartData") as string;
    const items = JSON.parse(cartData) as CartItem[];

    // Save or update cart
    const existingCart = await prisma.reorderCart.findFirst({
      where: { shop },
    });

    if (existingCart) {
      const existingItems = JSON.parse(existingCart.items) as CartItem[];
      const mergedItems = [...existingItems, ...items];

      await prisma.reorderCart.update({
        where: { id: existingCart.id },
        data: { items: JSON.stringify(mergedItems), updatedAt: new Date() },
      });
    } else {
      await prisma.reorderCart.create({
        data: { shop, items: JSON.stringify(items) },
      });
    }

    return json({ success: true, message: "Added to cart!" });
  }

  if (action === "removeFromCart") {
    const index = parseInt(formData.get("index") as string);
    const existingCart = await prisma.reorderCart.findFirst({
      where: { shop },
    });

    if (existingCart) {
      const items = JSON.parse(existingCart.items) as CartItem[];
      items.splice(index, 1);
      await prisma.reorderCart.update({
        where: { id: existingCart.id },
        data: { items: JSON.stringify(items) },
      });
    }

    return json({ success: true, message: "Removed from cart" });
  }

  if (action === "clearCart") {
    await prisma.reorderCart.deleteMany({ where: { shop } });
    return json({ success: true, message: "Cart cleared" });
  }

  if (action === "placeOrder") {
    const cartData = formData.get("cartData") as string;
    const items = JSON.parse(cartData) as CartItem[];

    if (items.length === 0) {
      return json({ success: false, message: "Cart is empty" });
    }

    // Create Draft Order in Shopify
    const lineItems = items.map(item => ({
      title: `${item.colorName} - ${item.sizeName}`,
      quantity: item.quantity,
      originalUnitPrice: item.price.toString(),
      customAttributes: [
        { key: "SKU", value: item.sku },
        { key: "Color", value: item.colorName },
        { key: "Size", value: item.sizeName },
        ...(item.designUrl ? [{ key: "Design Image", value: item.designUrl }] : []),
      ],
    }));

    try {
      const response = await admin.graphql(`
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
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
            lineItems,
            note: "Quick Reorder - Created from SSActiveWear App",
          },
        },
      });

      const result = await response.json();
      const draftOrder = result.data?.draftOrderCreate?.draftOrder;

      if (draftOrder) {
        // Clear cart after successful order
        await prisma.reorderCart.deleteMany({ where: { shop } });

        // Log activity
        await prisma.activityLog.create({
          data: {
            shop,
            action: 'quick_reorder',
            resource: 'order',
            details: JSON.stringify({
              draftOrderId: draftOrder.id,
              draftOrderName: draftOrder.name,
              itemCount: items.length,
              totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
            }),
          },
        });

        return json({
          success: true,
          message: `Draft Order ${draftOrder.name} created! Go to Shopify Orders to complete.`,
        });
      } else {
        const errors = result.data?.draftOrderCreate?.userErrors;
        return json({
          success: false,
          message: errors?.[0]?.message || "Failed to create order",
        });
      }
    } catch (error) {
      return json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to create order",
      });
    }
  }

  return json({ success: false, message: "Unknown action" });
};

export default function QuickReorderPage() {
  const {
    styles,
    selectedStyleId,
    colorVariants,
    sizeOptions,
    products,
    cart,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  // Local state
  const [selectedStyle, setSelectedStyle] = useState<string>(selectedStyleId?.toString() || "");
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, number>>({});
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [designUrl, setDesignUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [confirmOrderOpen, setConfirmOrderOpen] = useState(false);

  const isLoading = navigation.state === "submitting" || navigation.state === "loading";

  // Get current color's sizes
  const currentSizes = selectedColor ? (sizeOptions[selectedColor] || []) : [];

  // Calculate totals
  const totalQuantity = Object.values(sizeQuantities).reduce((sum, qty) => sum + (qty || 0), 0);
  const totalPrice = currentSizes.reduce((sum, size) => {
    const qty = sizeQuantities[size.sizeName] || 0;
    return sum + (qty * size.piecePrice);
  }, 0);

  // Set first color as default when colors load
  useEffect(() => {
    if (colorVariants.length > 0 && !selectedColor) {
      setSelectedColor(colorVariants[0].colorCode);
    }
  }, [colorVariants, selectedColor]);

  // Handle style selection change
  const handleStyleChange = useCallback((value: string) => {
    setSelectedStyle(value);
    setSelectedColor("");
    setSizeQuantities({});
    // Navigate to load new style data
    if (value) {
      window.location.href = `/app/quick-reorder?styleId=${value}`;
    }
  }, []);

  // Handle color selection
  const handleColorSelect = useCallback((colorCode: string) => {
    setSelectedColor(colorCode);
    setSizeQuantities({}); // Reset quantities when color changes
  }, []);

  // Handle size quantity change
  const handleQuantityChange = useCallback((sizeName: string, value: string) => {
    const qty = parseInt(value) || 0;
    setSizeQuantities(prev => ({ ...prev, [sizeName]: qty }));
  }, []);

  // Handle design upload
  const handleDropZoneDrop = useCallback(async (_dropFiles: File[], acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setDesignFile(file);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();
        if (result.success && result.url) {
          setDesignUrl(result.url);
        }
      } catch (error) {
        console.error("Upload failed:", error);
      } finally {
        setUploading(false);
      }
    }
  }, []);

  // Add to cart
  const handleAddToCart = useCallback(() => {
    if (!selectedColor || totalQuantity === 0) return;

    const items: CartItem[] = [];
    const colorVariant = colorVariants.find(c => c.colorCode === selectedColor);

    currentSizes.forEach(size => {
      const qty = sizeQuantities[size.sizeName] || 0;
      if (qty > 0) {
        // Find matching product SKU
        const product = products.find(
          p => p.colorCode === selectedColor && p.sizeName === size.sizeName
        );

        items.push({
          sku: product?.sku || `${selectedColor}-${size.sizeName}`,
          colorCode: selectedColor,
          colorName: colorVariant?.colorName || selectedColor,
          sizeName: size.sizeName,
          quantity: qty,
          price: size.piecePrice,
          designUrl: designUrl || undefined,
        });
      }
    });

    const formData = new FormData();
    formData.set("action", "addToCart");
    formData.set("cartData", JSON.stringify(items));
    submit(formData, { method: "POST" });

    // Reset form
    setSizeQuantities({});
  }, [selectedColor, totalQuantity, currentSizes, sizeQuantities, colorVariants, products, designUrl, submit]);

  // Remove from cart
  const handleRemoveFromCart = useCallback((index: number) => {
    const formData = new FormData();
    formData.set("action", "removeFromCart");
    formData.set("index", index.toString());
    submit(formData, { method: "POST" });
  }, [submit]);

  // Place order
  const handlePlaceOrder = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "placeOrder");
    formData.set("cartData", JSON.stringify(cart));
    submit(formData, { method: "POST" });
    setConfirmOrderOpen(false);
  }, [cart, submit]);

  // Build image URL helper
  const buildImageUrl = (imagePath: string) => {
    if (!imagePath) return "";
    if (imagePath.startsWith("http")) return imagePath;
    return `https://www.ssactivewear.com/${imagePath}`;
  };

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Quick Reorder"
      subtitle="Select products, sizes, and quantities for fast ordering"
    >
      <TitleBar title="Quick Reorder" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Style Selection */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">1️⃣ Select Product</Text>
            <Select
              label="Choose a style"
              options={[
                { label: "Select a product...", value: "" },
                ...styles.map(s => ({
                  label: `${s.brandName} - ${s.styleName}`,
                  value: s.styleId.toString(),
                })),
              ]}
              value={selectedStyle}
              onChange={handleStyleChange}
            />
          </BlockStack>
        </Card>

        {/* Color Variants */}
        {colorVariants.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">2️⃣ Select Color</Text>
                {selectedColor && (
                  <Badge tone="info">
                    {colorVariants.find(c => c.colorCode === selectedColor)?.colorName}
                  </Badge>
                )}
              </InlineStack>
              <Divider />
              <InlineStack gap="300" wrap>
                {colorVariants.map(color => (
                  <div
                    key={color.colorCode}
                    onClick={() => handleColorSelect(color.colorCode)}
                    style={{ cursor: "pointer" }}
                  >
                    <Box
                      padding="100"
                      borderWidth="025"
                      borderColor={selectedColor === color.colorCode ? "border-brand" : "border"}
                      borderRadius="200"
                      background={selectedColor === color.colorCode ? "bg-surface-brand-selected" : "bg-surface"}
                    >
                      <BlockStack gap="100" inlineAlign="center">
                        {color.colorFrontImage ? (
                          <Thumbnail
                            source={buildImageUrl(color.colorFrontImage)}
                            alt={color.colorName}
                            size="large"
                          />
                        ) : (
                          <Box
                            background="bg-surface-secondary"
                            padding="400"
                            borderRadius="100"
                          >
                            <Icon source={ImageIcon} tone="subdued" />
                          </Box>
                        )}
                        <Text as="span" variant="bodySm" alignment="center">
                          {color.colorName}
                        </Text>
                      </BlockStack>
                    </Box>
                  </div>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Size Selection with Quantities */}
        {currentSizes.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">3️⃣ Enter Quantities by Size</Text>
                <Badge size="large">{`${totalQuantity} total`}</Badge>
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 3, sm: 5, md: 7 }} gap="300">
                {currentSizes.map(size => (
                  <Card key={size.sizeName}>
                    <BlockStack gap="200" inlineAlign="center">
                      <TextField
                        label=""
                        type="number"
                        value={sizeQuantities[size.sizeName]?.toString() || "0"}
                        onChange={(value) => handleQuantityChange(size.sizeName, value)}
                        autoComplete="off"
                      />
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {size.sizeName}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        ${size.piecePrice.toFixed(2)}
                      </Text>
                      {size.qty < 50 && (
                        <Badge tone="warning" size="small">
                          {`Low: ${size.qty}`}
                        </Badge>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* Design Upload */}
        {totalQuantity > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">4️⃣ Upload Design (Optional)</Text>
              <Divider />
              {!designUrl ? (
                <DropZone
                  onDrop={handleDropZoneDrop}
                  accept="image/*,.pdf,.ai"
                  type="image"
                  label="Drag and drop your design file"
                >
                  <DropZone.FileUpload actionHint="or click to upload" />
                </DropZone>
              ) : (
                <InlineStack align="space-between">
                  <InlineStack gap="300">
                    <Thumbnail source={designUrl} alt="Design" size="large" />
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        Design uploaded ✅
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {designFile?.name}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    icon={DeleteIcon}
                    tone="critical"
                    onClick={() => { setDesignFile(null); setDesignUrl(""); }}
                  >
                    Remove
                  </Button>
                </InlineStack>
              )}
              {uploading && <ProgressBar progress={75} size="small" />}
            </BlockStack>
          </Card>
        )}

        {/* Add to Cart Summary */}
        {totalQuantity > 0 && (
          <Card>
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text as="span" variant="headingMd">Product Total</Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {totalQuantity} items × ${(totalPrice / totalQuantity).toFixed(2)} avg
                </Text>
              </BlockStack>
              <InlineStack gap="300">
                <Text as="span" variant="heading2xl">${totalPrice.toFixed(2)}</Text>
                <Button
                  variant="primary"
                  icon={CartIcon}
                  onClick={handleAddToCart}
                  loading={isLoading}
                >
                  Add to Cart
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        )}

        {/* Cart */}
        {cart.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">🛒 Your Cart ({cart.length} items)</Text>
                <Button
                  tone="critical"
                  variant="plain"
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("action", "clearCart");
                    submit(formData, { method: "POST" });
                  }}
                >
                  Clear Cart
                </Button>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                {cart.map((item, idx) => (
                  <Box key={idx} padding="200" background="bg-surface-secondary" borderRadius="100">
                    <InlineStack align="space-between">
                      <InlineStack gap="300">
                        {item.designUrl && (
                          <Thumbnail source={item.designUrl} alt="Design" size="small" />
                        )}
                        <BlockStack gap="050">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {item.colorName} - {item.sizeName}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            SKU: {item.sku}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Badge>{`×${item.quantity}`}</Badge>
                        <Text as="span" variant="bodyMd">
                          {`$${(item.price * item.quantity).toFixed(2)}`}
                        </Text>
                        <Button
                          icon={DeleteIcon}
                          variant="plain"
                          tone="critical"
                          onClick={() => handleRemoveFromCart(idx)}
                        />
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="span" variant="headingLg">Order Total</Text>
                <Text as="span" variant="heading2xl">
                  ${cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)}
                </Text>
              </InlineStack>
              <Button
                variant="primary"
                size="large"
                fullWidth
                onClick={() => setConfirmOrderOpen(true)}
              >
                {`Place Order (${cart.reduce((sum, item) => sum + item.quantity, 0)} items)`}
              </Button>
            </BlockStack>
          </Card>
        )}

        {/* Empty State */}
        {styles.length === 0 && (
          <Card>
            <EmptyState
              heading="No products imported"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Import Products", url: "/app/products" }}
            >
              <p>Import products from SSActiveWear first, then use Quick Reorder.</p>
            </EmptyState>
          </Card>
        )}

        {/* Confirm Order Modal */}
        <Modal
          open={confirmOrderOpen}
          onClose={() => setConfirmOrderOpen(false)}
          title="Confirm Order"
          primaryAction={{
            content: "Place Order",
            onAction: handlePlaceOrder,
            loading: isLoading,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setConfirmOrderOpen(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="info">
                This will create a Draft Order in Shopify. You can review and complete payment there.
              </Banner>
              <Divider />
              <InlineStack align="space-between">
                <Text as="span" variant="bodyMd">Total Items</Text>
                <Text as="span" variant="headingMd">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)}
                </Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodyMd">Order Total</Text>
                <Text as="span" variant="headingLg">
                  ${cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)}
                </Text>
              </InlineStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
