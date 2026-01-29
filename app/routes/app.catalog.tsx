import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    DataTable,
    Divider,
    EmptyState,
    Icon,
    InlineGrid,
    InlineStack,
    Modal,
    Page,
    Pagination,
    ProgressBar,
    Scrollable,
    Spinner,
    Tabs,
    Text,
    TextField
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import { SSActiveWearClient, type SSProduct, type SSStyle, type SSWarehouse } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

// Popular brands for quick access
const POPULAR_BRANDS = [
  "Gildan",
  "Bella+Canvas",
  "Next Level",
  "Hanes",
  "Fruit of the Loom",
  "Champion",
  "Alternative Apparel",
  "American Apparel",
  "Comfort Colors",
  "Port & Company",
  "Sport-Tek",
  "Carhartt",
];

// Product categories
const PRODUCT_CATEGORIES = [
  { label: "T-Shirts", value: "t-shirts" },
  { label: "Polos", value: "polos" },
  { label: "Hoodies & Sweatshirts", value: "hoodies" },
  { label: "Tank Tops", value: "tank" },
  { label: "Headwear", value: "headwear" },
  { label: "Bags", value: "bags" },
  { label: "Jackets", value: "jackets" },
  { label: "Activewear", value: "activewear" },
];

// Warehouse name mapping
const WAREHOUSE_NAMES: Record<string, string> = {
  "IL": "Illinois",
  "NV": "Nevada",
  "PA": "Pennsylvania",
  "KS": "Kansas",
  "NJ": "New Jersey",
  "TX": "Texas",
  "GA": "Georgia",
  "CA": "California",
  "MA": "Massachusetts",
};

interface ColorGroup {
  colorName: string;
  colorCode: string;
  colorHex: string;
  colorSwatchUrl: string;
  frontImageUrl: string;
  backImageUrl: string;
  sideImageUrl: string;
  onModelFrontUrl: string;
  products: SSProduct[];
  sizes: string[];
  totalStock: number;
  warehouseStock: Record<string, number>;
}

interface ProductDetails {
  style: SSStyle;
  products: SSProduct[];
  colorGroups: ColorGroup[];
  allSizes: string[];
  totalStock: number;
  warehouseStock: Record<string, number>;
  priceRange: { min: number; max: number };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const brand = url.searchParams.get("brand") || "";
  const category = url.searchParams.get("category") || "";
  const detailStyleId = url.searchParams.get("detail");
  const page = parseInt(url.searchParams.get("page") || "1");
  const mode = url.searchParams.get("mode") || "search"; // search, brands, browse

  const client = new SSActiveWearClient();

  // Fetch product details for modal
  if (detailStyleId) {
    try {
      const [styles, products] = await Promise.all([
        client.getStyleDetails(Number(detailStyleId)),
        client.getProducts(Number(detailStyleId)),
      ]);

      const colorMap = new Map<string, ColorGroup>();
      const warehouseTotals: Record<string, number> = {};
      let totalStock = 0;
      let minPrice = Infinity;
      let maxPrice = 0;
      const allSizesSet = new Set<string>();

      products.forEach((p: SSProduct) => {
        const colorKey = p.colorName || "Unknown";

        if (!colorMap.has(colorKey)) {
          colorMap.set(colorKey, {
            colorName: p.colorName,
            colorCode: p.colorCode,
            colorHex: p.color1 || "#cccccc",
            colorSwatchUrl: SSActiveWearClient.buildImageUrl(p.colorSwatchImage),
            frontImageUrl: SSActiveWearClient.buildImageUrl(p.colorFrontImage, 'large'),
            backImageUrl: SSActiveWearClient.buildImageUrl(p.colorBackImage, 'large'),
            sideImageUrl: SSActiveWearClient.buildImageUrl(p.colorSideImage, 'large'),
            onModelFrontUrl: SSActiveWearClient.buildImageUrl(p.colorOnModelFrontImage, 'large'),
            products: [],
            sizes: [],
            totalStock: 0,
            warehouseStock: {},
          });
        }

        const group = colorMap.get(colorKey)!;
        group.products.push(p);

        if (p.sizeName && !group.sizes.includes(p.sizeName)) {
          group.sizes.push(p.sizeName);
        }

        if (p.warehouses) {
          p.warehouses.forEach((w: SSWarehouse) => {
            group.totalStock += w.qty;
            totalStock += w.qty;
            group.warehouseStock[w.warehouseAbbr] = (group.warehouseStock[w.warehouseAbbr] || 0) + w.qty;
            warehouseTotals[w.warehouseAbbr] = (warehouseTotals[w.warehouseAbbr] || 0) + w.qty;
          });
        }

        if (p.customerPrice && p.customerPrice < minPrice) minPrice = p.customerPrice;
        if (p.customerPrice && p.customerPrice > maxPrice) maxPrice = p.customerPrice;

        allSizesSet.add(p.sizeName);
      });

      const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
      const allSizes = Array.from(allSizesSet).sort((a, b) => {
        const aIdx = sizeOrder.indexOf(a);
        const bIdx = sizeOrder.indexOf(b);
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
        return a.localeCompare(b);
      });

      return json({
        styles: [] as SSStyle[],
        brands: [] as any[],
        query: search,
        brand,
        category,
        mode,
        page,
        totalPages: 1,
        productDetails: {
          style: styles[0],
          products,
          colorGroups: Array.from(colorMap.values()),
          allSizes,
          totalStock,
          warehouseStock: warehouseTotals,
          priceRange: { min: minPrice === Infinity ? 0 : minPrice, max: maxPrice },
        } as ProductDetails,
      });
    } catch (error) {
      console.error("Failed to fetch product details:", error);
      return json({ styles: [], brands: [], query: search, brand, category, mode, page, totalPages: 1, productDetails: null });
    }
  }

  // Fetch brands list
  if (mode === "brands") {
    try {
      const brands = await client.getBrands();
      return json({
        styles: [],
        brands: brands.sort((a: any, b: any) => a.name.localeCompare(b.name)),
        query: "",
        brand: "",
        category: "",
        mode,
        page: 1,
        totalPages: 1,
        productDetails: null
      });
    } catch (error) {
      console.error("Failed to fetch brands:", error);
      return json({ styles: [], brands: [], query: "", brand: "", category: "", mode, page: 1, totalPages: 1, productDetails: null });
    }
  }

  // Search by brand
  if (brand) {
    try {
      const styles = await client.getStylesByBrand(brand);
      const itemsPerPage = 24;
      const totalPages = Math.ceil(styles.length / itemsPerPage);
      const startIdx = (page - 1) * itemsPerPage;
      const paginatedStyles = styles.slice(startIdx, startIdx + itemsPerPage);

      return json({
        styles: paginatedStyles,
        brands: [],
        query: "",
        brand,
        category,
        mode: "search",
        page,
        totalPages,
        totalResults: styles.length,
        productDetails: null
      });
    } catch (error) {
      console.error("Failed to fetch styles by brand:", error);
      return json({ styles: [], brands: [], query: "", brand, category, mode: "search", page: 1, totalPages: 1, productDetails: null });
    }
  }

  // Regular search
  if (search) {
    try {
      const styles = await client.getStyles(search);
      const itemsPerPage = 24;
      const totalPages = Math.ceil(styles.length / itemsPerPage);
      const startIdx = (page - 1) * itemsPerPage;
      const paginatedStyles = styles.slice(startIdx, startIdx + itemsPerPage);

      return json({
        styles: paginatedStyles,
        brands: [],
        query: search,
        brand: "",
        category,
        mode: "search",
        page,
        totalPages,
        totalResults: styles.length,
        productDetails: null
      });
    } catch (error) {
      console.error("Failed to fetch styles:", error);
      return json({ styles: [], brands: [], query: search, brand: "", category, mode: "search", page: 1, totalPages: 1, productDetails: null });
    }
  }

  return json({
    styles: [],
    brands: [],
    query: "",
    brand: "",
    category: "",
    mode,
    page: 1,
    totalPages: 1,
    productDetails: null
  });
}

export default function CatalogPage() {
  const data = useLoaderData<typeof loader>();
  const styles = data.styles || [];
  const brands = data.brands || [];
  const query = data.query || "";
  const currentBrand = data.brand || "";
  const currentMode = data.mode || "search";
  const currentPage = data.page || 1;
  const totalPages = data.totalPages || 1;
  const totalResults = (data as any).totalResults || styles.length;
  const productDetails = data.productDetails;

  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [searchValue, setSearchValue] = useState(query);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SSStyle | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [localProductDetails, setLocalProductDetails] = useState<ProductDetails | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedColor, setSelectedColor] = useState<ColorGroup | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [activeView, setActiveView] = useState(currentMode === "brands" ? 1 : 0);

  const viewTabs = [
    { id: 'search', content: 'Search Products' },
    { id: 'brands', content: 'Browse by Brand' },
  ];

  const handleSearch = useCallback(() => {
    if (!searchValue.trim()) return;
    setIsSearching(true);
    submit({ search: searchValue, mode: "search" }, { method: "get" });
    setTimeout(() => setIsSearching(false), 500);
  }, [searchValue, submit]);

  const handleBrandClick = useCallback((brandName: string) => {
    submit({ brand: brandName, mode: "search" }, { method: "get" });
  }, [submit]);

  const handleViewChange = useCallback((selected: number) => {
    setActiveView(selected);
    if (selected === 1) {
      submit({ mode: "brands" }, { method: "get" });
    }
  }, [submit]);

  const handlePageChange = useCallback((newPage: number) => {
    const params: Record<string, string> = { page: newPage.toString(), mode: "search" };
    if (currentBrand) params.brand = currentBrand;
    if (query) params.search = query;
    submit(params, { method: "get" });
  }, [submit, currentBrand, query]);

  const handleImport = useCallback((styleId: number) => {
    navigate(`/app/import?styleId=${styleId}`);
  }, [navigate]);

  const handleViewDetails = useCallback(async (style: SSStyle) => {
    setSelectedStyle(style);
    setIsModalOpen(true);
    setIsLoadingDetails(true);
    setSelectedTab(0);
    setSelectedColor(null);
    setSelectedImageIndex(0);

    try {
      const response = await fetch(`/app/catalog?detail=${style.styleID}&_data=routes/app.catalog`);
      const json = await response.json();
      if (json.productDetails) {
        setLocalProductDetails(json.productDetails);
        if (json.productDetails.colorGroups.length > 0) {
          setSelectedColor(json.productDetails.colorGroups[0]);
        }
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
    setSelectedColor(null);
  }, []);

  const getStyleImageUrl = (style: SSStyle) => {
    return SSActiveWearClient.buildImageUrl(style.styleImage, 'medium') ||
           "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
  };

  const getGalleryImages = (color: ColorGroup | null) => {
    if (!color) return [];
    const images = [];
    if (color.frontImageUrl) images.push({ url: color.frontImageUrl, label: "Front" });
    if (color.backImageUrl) images.push({ url: color.backImageUrl, label: "Back" });
    if (color.sideImageUrl) images.push({ url: color.sideImageUrl, label: "Side" });
    if (color.onModelFrontUrl) images.push({ url: color.onModelFrontUrl, label: "On Model" });
    return images;
  };

  const formatStock = (qty: number) => {
    if (qty >= 10000) return `${(qty / 1000).toFixed(0)}K`;
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    return qty.toString();
  };

  const modalTabs = [
    { id: 'overview', content: 'Overview' },
    { id: 'colors', content: 'Colors & Images' },
    { id: 'inventory', content: 'Warehouse Stock' },
    { id: 'sizes', content: 'Size Chart' },
  ];

  return (
    <Page
      title="Browse SSActiveWear Catalog"
      subtitle="Search over 250,000+ products from SSActiveWear's catalog"
    >
      <TitleBar title="Product Catalog" />
      <BlockStack gap="600">
        {/* View Tabs */}
        <Tabs tabs={viewTabs} selected={activeView} onSelect={handleViewChange} />

        {/* Search View */}
        {activeView === 0 && (
          <BlockStack gap="600">
            {/* Search Section */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Search Products</Text>
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      label="Search"
                      labelHidden
                      value={searchValue}
                      onChange={setSearchValue}
                      placeholder="Search by style number, brand, or keyword..."
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                  </div>
                  <Button variant="primary" onClick={handleSearch} loading={isSearching}>
                    Search
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Quick Brand Access */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">Popular Brands</Text>
                <InlineStack gap="200" wrap>
                  {POPULAR_BRANDS.map((b) => (
                    <Button
                      key={b}
                      size="slim"
                      onClick={() => handleBrandClick(b)}
                      pressed={currentBrand === b}
                    >
                      {b}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Current filter info */}
            {(currentBrand || query) && (
              <InlineStack gap="300" blockAlign="center">
                <Text as="span" variant="bodyMd">
                  {currentBrand ? `Brand: ${currentBrand}` : `Search: "${query}"`}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  ({totalResults} products found)
                </Text>
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => {
                    setSearchValue("");
                    submit({ mode: "search" }, { method: "get" });
                  }}
                >
                  Clear
                </Button>
              </InlineStack>
            )}

            {/* Empty States */}
            {styles.length === 0 && !query && !currentBrand && (
              <Card>
                <EmptyState
                  heading="Start browsing the catalog"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Search for products or select a brand above to get started.</p>
                </EmptyState>
              </Card>
            )}

            {styles.length === 0 && (query || currentBrand) && (
              <Card>
                <EmptyState
                  heading="No products found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Try a different search term or brand.</p>
                </EmptyState>
              </Card>
            )}

            {/* Results Grid */}
            {styles.length > 0 && (
              <BlockStack gap="400">
                <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
                  {styles.map((style: SSStyle) => (
                    <Card key={style.styleID}>
                      <BlockStack gap="300">
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
                              src={getStyleImageUrl(style)}
                              alt={style.title}
                              style={{ maxWidth: "100%", maxHeight: "120px", objectFit: "contain" }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
                              }}
                            />
                          </div>
                        </Box>

                        <BlockStack gap="200">
                          <Badge tone="info">{style.brandName}</Badge>
                          <Text as="h3" variant="headingMd" truncate>
                            {style.title}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Style: {style.partNumber} | {style.baseCategory}
                          </Text>
                        </BlockStack>

                        <InlineStack gap="200">
                          <Button onClick={() => handleViewDetails(style)} size="slim">
                            Details
                          </Button>
                          <Button variant="primary" onClick={() => handleImport(style.styleID)} size="slim">
                            Import
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </InlineGrid>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Pagination
                      hasPrevious={currentPage > 1}
                      hasNext={currentPage < totalPages}
                      onPrevious={() => handlePageChange(currentPage - 1)}
                      onNext={() => handlePageChange(currentPage + 1)}
                      label={`Page ${currentPage} of ${totalPages}`}
                    />
                  </div>
                )}
              </BlockStack>
            )}
          </BlockStack>
        )}

        {/* Brands View */}
        {activeView === 1 && (
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">All Brands ({brands.length})</Text>

            {brands.length === 0 ? (
              <Card>
                <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
                  <Spinner size="large" />
                </div>
              </Card>
            ) : (
              <InlineGrid columns={{ xs: 2, sm: 3, md: 4, lg: 6 }} gap="300">
                {brands.map((brand: any) => (
                  <Card key={brand.brandID}>
                    <div
                      style={{ cursor: "pointer", textAlign: "center" }}
                      onClick={() => handleBrandClick(brand.name)}
                    >
                      <BlockStack gap="200" inlineAlign="center">
                        {brand.image && (
                          <img
                            src={SSActiveWearClient.buildImageUrl(brand.image, 'medium')}
                            alt={brand.name}
                            style={{ maxWidth: "80px", maxHeight: "40px", objectFit: "contain" }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {brand.name}
                        </Text>
                      </BlockStack>
                    </div>
                  </Card>
                ))}
              </InlineGrid>
            )}
          </BlockStack>
        )}

        {/* Product Details Modal */}
        <Modal
          open={isModalOpen}
          onClose={closeModal}
          title={selectedStyle?.title || "Product Details"}
          size="fullScreen"
          primaryAction={{
            content: "Import to Store",
            onAction: () => selectedStyle && handleImport(selectedStyle.styleID),
          }}
          secondaryActions={[{ content: "Close", onAction: closeModal }]}
        >
          <Modal.Section>
            {isLoadingDetails ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "60px" }}>
                <BlockStack gap="400" inlineAlign="center">
                  <Spinner size="large" />
                  <Text as="p">Loading product details...</Text>
                </BlockStack>
              </div>
            ) : localProductDetails ? (
              <BlockStack gap="600">
                <Tabs tabs={modalTabs} selected={selectedTab} onSelect={setSelectedTab} />

                {/* Overview Tab */}
                {selectedTab === 0 && (
                  <BlockStack gap="600">
                    <InlineStack gap="600" blockAlign="start" wrap={false}>
                      <Box minWidth="300px">
                        <BlockStack gap="300">
                          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                            <img
                              src={getGalleryImages(selectedColor)[selectedImageIndex]?.url || getStyleImageUrl(selectedStyle!)}
                              alt={selectedStyle?.title}
                              style={{ width: "280px", height: "280px", objectFit: "contain" }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
                              }}
                            />
                          </Box>
                          <InlineStack gap="200">
                            {getGalleryImages(selectedColor).map((img, idx) => (
                              <Box
                                key={idx}
                                background={idx === selectedImageIndex ? "bg-surface-selected" : "bg-surface-secondary"}
                                padding="100"
                                borderRadius="100"
                                borderWidth="025"
                                borderColor={idx === selectedImageIndex ? "border-emphasis" : "border"}
                              >
                                <img
                                  src={img.url}
                                  alt={img.label}
                                  style={{ width: "50px", height: "50px", objectFit: "contain", cursor: "pointer" }}
                                  onClick={() => setSelectedImageIndex(idx)}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              </Box>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </Box>

                      <BlockStack gap="400">
                        <Badge tone="info">{selectedStyle?.brandName}</Badge>
                        <Text as="h2" variant="headingXl">{selectedStyle?.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Style #: {selectedStyle?.partNumber} | {selectedStyle?.baseCategory}
                        </Text>

                        <InlineStack gap="300">
                          <Card><BlockStack gap="100"><Text as="span" variant="headingXl">{localProductDetails.colorGroups.length}</Text><Text as="span" variant="bodySm" tone="subdued">Colors</Text></BlockStack></Card>
                          <Card><BlockStack gap="100"><Text as="span" variant="headingXl">{localProductDetails.allSizes.length}</Text><Text as="span" variant="bodySm" tone="subdued">Sizes</Text></BlockStack></Card>
                          <Card><BlockStack gap="100"><Text as="span" variant="headingXl">{formatStock(localProductDetails.totalStock)}</Text><Text as="span" variant="bodySm" tone="subdued">In Stock</Text></BlockStack></Card>
                          <Card><BlockStack gap="100"><Text as="span" variant="headingXl">${localProductDetails.priceRange.min.toFixed(2)}</Text><Text as="span" variant="bodySm" tone="subdued">From Price</Text></BlockStack></Card>
                        </InlineStack>

                        <Text as="p" variant="bodyMd">
                          {selectedStyle?.description?.replace(/<[^>]*>/g, ' ').substring(0, 400)}...
                        </Text>

                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">Available Sizes</Text>
                          <InlineStack gap="200" wrap>
                            {localProductDetails.allSizes.map((size) => (
                              <Badge key={size}>{size}</Badge>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </BlockStack>
                    </InlineStack>

                    <Card>
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingMd">Available Colors ({localProductDetails.colorGroups.length})</Text>
                        <InlineStack gap="200" wrap>
                          {localProductDetails.colorGroups.map((color) => (
                            <Box
                              key={color.colorCode}
                              background={selectedColor?.colorCode === color.colorCode ? "bg-surface-selected" : "bg-surface-secondary"}
                              padding="200"
                              borderRadius="200"
                              borderWidth="025"
                              borderColor={selectedColor?.colorCode === color.colorCode ? "border-emphasis" : "border"}
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <div
                                  style={{
                                    width: "32px",
                                    height: "32px",
                                    borderRadius: "4px",
                                    backgroundColor: color.colorHex || "#ccc",
                                    border: "1px solid #ddd",
                                    cursor: "pointer",
                                    backgroundImage: color.colorSwatchUrl ? `url(${color.colorSwatchUrl})` : undefined,
                                    backgroundSize: "cover",
                                  }}
                                  onClick={() => { setSelectedColor(color); setSelectedImageIndex(0); }}
                                  title={color.colorName}
                                />
                                <BlockStack gap="050">
                                  <Text as="span" variant="bodySm" fontWeight="medium">{color.colorName}</Text>
                                  <Text as="span" variant="bodySm" tone="subdued">{formatStock(color.totalStock)} in stock</Text>
                                </BlockStack>
                              </InlineStack>
                            </Box>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* Colors Tab */}
                {selectedTab === 1 && (
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
                    {localProductDetails.colorGroups.map((color) => (
                      <Card key={color.colorCode}>
                        <BlockStack gap="300">
                          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                            <img
                              src={color.frontImageUrl || getStyleImageUrl(selectedStyle!)}
                              alt={color.colorName}
                              style={{ width: "100%", height: "150px", objectFit: "contain" }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";
                              }}
                            />
                          </Box>
                          <InlineStack gap="200" blockAlign="center">
                            <div style={{ width: "24px", height: "24px", borderRadius: "4px", backgroundColor: color.colorHex, border: "1px solid #ddd" }} />
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{color.colorName}</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">{color.sizes.length} sizes • {formatStock(color.totalStock)} in stock</Text>
                        </BlockStack>
                      </Card>
                    ))}
                  </InlineGrid>
                )}

                {/* Warehouse Tab */}
                {selectedTab === 2 && (
                  <BlockStack gap="600">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingMd">Warehouse Stock Summary</Text>
                        <BlockStack gap="300">
                          {Object.entries(localProductDetails.warehouseStock)
                            .sort((a, b) => b[1] - a[1])
                            .map(([abbr, qty]) => {
                              const percentage = (qty / localProductDetails.totalStock) * 100;
                              return (
                                <BlockStack key={abbr} gap="100">
                                  <InlineStack align="space-between">
                                    <Text as="span" variant="bodyMd">{WAREHOUSE_NAMES[abbr] || abbr} ({abbr})</Text>
                                    <Text as="span" variant="bodyMd" fontWeight="semibold">{formatStock(qty)} units</Text>
                                  </InlineStack>
                                  <ProgressBar progress={percentage} size="small" tone="primary" />
                                </BlockStack>
                              );
                            })}
                        </BlockStack>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="headingSm">Total Inventory</Text>
                          <Text as="span" variant="headingSm">{formatStock(localProductDetails.totalStock)} units</Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* Size Chart Tab */}
                {selectedTab === 3 && (
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingMd">Size × Color Stock Matrix</Text>
                      <Scrollable horizontal>
                        <DataTable
                          columnContentTypes={["text", ...localProductDetails.allSizes.map(() => "numeric" as const)]}
                          headings={["Color", ...localProductDetails.allSizes]}
                          rows={localProductDetails.colorGroups.slice(0, 20).map((color) => [
                            color.colorName,
                            ...localProductDetails.allSizes.map((size) => {
                              const product = color.products.find(p => p.sizeName === size);
                              return product ? formatStock(product.qty || 0) : "-";
                            }),
                          ])}
                        />
                      </Scrollable>
                      {localProductDetails.colorGroups.length > 20 && (
                        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                          Showing 20 of {localProductDetails.colorGroups.length} colors
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            ) : (
              <Text as="p">Failed to load product details</Text>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
