import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    EmptyState,
    InlineGrid,
    InlineStack,
    Modal,
    Page,
    Spinner,
    Text,
    TextField
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { SSActiveWearClient, type SSStyle } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

const SS_IMAGE_BASE = "https://www.ssactivewear.com";

interface ProductDetails {
  style: SSStyle;
  products: any[];
  colorGroups: Record<string, any[]>;
  sizeGroups: string[];
  totalStock: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const detailStyleId = url.searchParams.get("detail");

  const client = new SSActiveWearClient();

  // If requesting product details
  if (detailStyleId) {
    try {
      const styles = await client.getStyleDetails(Number(detailStyleId));
      const products = await client.getProducts(Number(detailStyleId));

      // Group by color
      const colorGroups: Record<string, any[]> = {};
      products.forEach((p: any) => {
        const colorName = p.colorName || "Unknown";
        if (!colorGroups[colorName]) {
          colorGroups[colorName] = [];
        }
        colorGroups[colorName].push(p);
      });

      // Get unique sizes
      const sizeGroups = [...new Set(products.map((p: any) => p.sizeName))].filter(Boolean) as string[];

      // Calculate total stock (simplified - actual would need inventory API)
      const totalStock = products.reduce((sum: number, p: any) => sum + (p.qty || 0), 0);

      return json({
        styles: [] as SSStyle[],
        query: search,
        productDetails: {
          style: styles[0],
          products,
          colorGroups,
          sizeGroups,
          totalStock,
        } as ProductDetails,
      });
    } catch (error) {
      console.error("Failed to fetch product details:", error);
      return json({ styles: [] as SSStyle[], query: search, productDetails: null });
    }
  }

  // Regular search
  if (!search) {
    return json({ styles: [] as SSStyle[], query: "", productDetails: null });
  }

  try {
    const styles = await client.getStyles(search);
    return json({ styles: styles as SSStyle[], query: search, productDetails: null });
  } catch (error) {
    console.error("Failed to fetch styles:", error);
    return json({ styles: [] as SSStyle[], query: search, error: "Failed to fetch from SSActiveWear", productDetails: null });
  }
}

export default function CatalogPage() {
  const data = useLoaderData<typeof loader>();
  const styles = data.styles || [];
  const query = data.query || "";
  const productDetails = data.productDetails;
  const submit = useSubmit();
  const navigate = useNavigate();

  const [searchValue, setSearchValue] = useState(query);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SSStyle | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [localProductDetails, setLocalProductDetails] = useState<ProductDetails | null>(null);

  const handleSearch = useCallback(() => {
    if (!searchValue.trim()) return;
    setIsSearching(true);
    submit({ search: searchValue }, { method: "get" });
    setTimeout(() => setIsSearching(false), 500);
  }, [searchValue, submit]);

  const handleImport = useCallback(
    (styleId: number) => {
      navigate(`/app/import?styleId=${styleId}`);
    },
    [navigate]
  );

  const handleViewDetails = useCallback(async (style: SSStyle) => {
    setSelectedStyle(style);
    setIsModalOpen(true);
    setIsLoadingDetails(true);

    // Fetch details via URL param
    try {
      const response = await fetch(`/app/catalog?detail=${style.styleID}&_data=routes/app.catalog`);
      const data = await response.json();
      if (data.productDetails) {
        setLocalProductDetails(data.productDetails);
      }
    } catch (error) {
      console.error("Failed to load details:", error);
    }
    setIsLoadingDetails(false);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedStyle(null);
    setLocalProductDetails(null);
  }, []);

  // Build proper image URL
  const getImageUrl = (styleImage: string) => {
    if (!styleImage) return "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
    if (styleImage.startsWith("http")) return styleImage;
    return `${SS_IMAGE_BASE}/${styleImage}`;
  };

  return (
    <Page
      title="Browse SSActiveWear Catalog"
      subtitle="Search over 250,000 products from SSActiveWear's catalog"
    >
      <TitleBar title="Product Catalog" />
      <BlockStack gap="600">
        {/* Search Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Search Products
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ flexGrow: 1 }}>
                <TextField
                  label="Search by brand, style, or keyword"
                  labelHidden
                  value={searchValue}
                  onChange={setSearchValue}
                  placeholder="e.g. Gildan 5000, Next Level, Bella Canvas..."
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <Button variant="primary" onClick={handleSearch} loading={isSearching}>
                Search Catalog
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Tip: Search by brand name (Gildan, Bella Canvas) or style number (5000, 3001)
            </Text>
          </BlockStack>
        </Card>

        {/* Results Section */}
        {styles.length === 0 && query && (
          <Card>
            <EmptyState
              heading="No products found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Try searching with different keywords or brand names.</p>
            </EmptyState>
          </Card>
        )}

        {styles.length === 0 && !query && (
          <Card>
            <EmptyState
              heading="Start browsing the catalog"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Enter a search term above to find products from SSActiveWear.</p>
            </EmptyState>
          </Card>
        )}

        {styles.length > 0 && (
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Search Results ({styles.length} products)
              </Text>
            </InlineStack>

            <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
              {styles.map((style: SSStyle) => (
                <Card key={style.styleID}>
                  <BlockStack gap="300">
                    {/* Product Image */}
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          cursor: "pointer",
                          minHeight: "120px",
                          alignItems: "center"
                        }}
                        onClick={() => handleViewDetails(style)}
                      >
                        <img
                          src={getImageUrl(style.styleImage)}
                          alt={style.title}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "120px",
                            objectFit: "contain"
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
                          }}
                        />
                      </div>
                    </Box>

                    {/* Product Info */}
                    <BlockStack gap="200">
                      <Badge tone="info">{style.brandName}</Badge>
                      <Text as="h3" variant="headingMd" truncate>
                        {style.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Style: {style.partNumber}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {style.baseCategory}
                      </Text>
                    </BlockStack>

                    {/* Actions */}
                    <InlineStack gap="200">
                      <Button
                        onClick={() => handleViewDetails(style)}
                        size="slim"
                      >
                        View Details
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => handleImport(style.styleID)}
                        size="slim"
                      >
                        Import
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        )}

        {/* Product Details Modal */}
        <Modal
          open={isModalOpen}
          onClose={closeModal}
          title={selectedStyle?.title || "Product Details"}
          size="large"
          primaryAction={{
            content: "Import to Store",
            onAction: () => selectedStyle && handleImport(selectedStyle.styleID),
          }}
          secondaryActions={[
            {
              content: "Close",
              onAction: closeModal,
            },
          ]}
        >
          <Modal.Section>
            {isLoadingDetails ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
                <Spinner size="large" />
              </div>
            ) : selectedStyle ? (
              <BlockStack gap="600">
                {/* Header with Image */}
                <InlineStack gap="600" blockAlign="start">
                  <Box
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                    minWidth="200px"
                  >
                    <img
                      src={getImageUrl(selectedStyle.styleImage)}
                      alt={selectedStyle.title}
                      style={{
                        width: "200px",
                        height: "200px",
                        objectFit: "contain"
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
                      }}
                    />
                  </Box>
                  <BlockStack gap="300">
                    <Badge tone="info">{selectedStyle.brandName}</Badge>
                    <Text as="h2" variant="headingLg">
                      {selectedStyle.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Style #: {selectedStyle.partNumber} | Category: {selectedStyle.baseCategory}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {selectedStyle.description?.replace(/<[^>]*>/g, '').substring(0, 300)}...
                    </Text>
                  </BlockStack>
                </InlineStack>

                {/* Product Stats */}
                {localProductDetails && (
                  <>
                    <InlineStack gap="400">
                      <Card>
                        <BlockStack gap="100">
                          <Text as="span" variant="headingXl">
                            {Object.keys(localProductDetails.colorGroups).length}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Colors
                          </Text>
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="100">
                          <Text as="span" variant="headingXl">
                            {localProductDetails.sizeGroups.length}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Sizes
                          </Text>
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="100">
                          <Text as="span" variant="headingXl">
                            {localProductDetails.products.length}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Total SKUs
                          </Text>
                        </BlockStack>
                      </Card>
                    </InlineStack>

                    {/* Available Sizes */}
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">
                          Available Sizes
                        </Text>
                        <InlineStack gap="200" wrap>
                          {localProductDetails.sizeGroups.map((size) => (
                            <Badge key={size} size="medium">
                              {size}
                            </Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    {/* Colors with Swatches */}
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingMd">
                          Available Colors ({Object.keys(localProductDetails.colorGroups).length})
                        </Text>
                        <BlockStack gap="300">
                          {Object.entries(localProductDetails.colorGroups).slice(0, 12).map(([colorName, colorProducts]) => {
                            const firstProduct = colorProducts[0];
                            const colorSwatchImage = firstProduct?.colorSwatchImage
                              ? getImageUrl(firstProduct.colorSwatchImage)
                              : null;
                            const colorFrontImage = firstProduct?.colorFrontImage
                              ? getImageUrl(firstProduct.colorFrontImage)
                              : null;

                            return (
                              <Box
                                key={colorName}
                                background="bg-surface-secondary"
                                padding="300"
                                borderRadius="100"
                              >
                                <InlineStack gap="300" blockAlign="center">
                                  {colorSwatchImage && (
                                    <img
                                      src={colorSwatchImage}
                                      alt={colorName}
                                      style={{ width: "24px", height: "24px", borderRadius: "4px" }}
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  )}
                                  <BlockStack gap="100">
                                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                                      {colorName}
                                    </Text>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {colorProducts.length} sizes available
                                    </Text>
                                  </BlockStack>
                                  <div style={{ marginLeft: "auto" }}>
                                    <InlineStack gap="100">
                                      {colorProducts.slice(0, 5).map((p: any) => (
                                        <Badge key={p.sku} size="small">
                                          {p.sizeName}
                                        </Badge>
                                      ))}
                                      {colorProducts.length > 5 && (
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          +{colorProducts.length - 5} more
                                        </Text>
                                      )}
                                    </InlineStack>
                                  </div>
                                </InlineStack>
                              </Box>
                            );
                          })}
                          {Object.keys(localProductDetails.colorGroups).length > 12 && (
                            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                              And {Object.keys(localProductDetails.colorGroups).length - 12} more colors...
                            </Text>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </>
                )}
              </BlockStack>
            ) : null}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
