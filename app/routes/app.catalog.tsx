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
    Page,
    Text,
    TextField,
    Thumbnail
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

const R2_IMAGE_BASE = "https://img-ssa-e.techifyboost.com";

interface SSStyle {
  styleID: number;
  partNumber: string;
  brandName: string;
  styleName: string;
  title: string;
  description: string;
  baseCategory: string;
  styleImage: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";

  if (!search) {
    return json({ styles: [] as SSStyle[], query: "" });
  }

  const client = new SSActiveWearClient();
  try {
    const styles = await client.getStyles(search);
    return json({ styles: styles as SSStyle[], query: search });
  } catch (error) {
    console.error("Failed to fetch styles:", error);
    return json({ styles: [] as SSStyle[], query: search, error: "Failed to fetch from SSActiveWear" });
  }
}

export default function CatalogPage() {
  const data = useLoaderData<typeof loader>();
  const styles = data.styles || [];
  const query = data.query || "";
  const submit = useSubmit();
  const navigate = useNavigate();

  const [searchValue, setSearchValue] = useState(query);
  const [isSearching, setIsSearching] = useState(false);

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
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <Thumbnail
                          source={style.styleImage || `${R2_IMAGE_BASE}/placeholder.jpg`}
                          alt={style.title}
                          size="large"
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

                    {/* Action */}
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={() => handleImport(style.styleID)}
                    >
                      Import to Store
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        )}
      </BlockStack>
    </Page>
  );
}
