import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { BlockStack, Button, Card, IndexTable, Layout, Page, Text, TextField } from "@shopify/polaris";
import { useState } from "react";
import { ImporterService } from "../services/importer.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";

  if (!search) return json({ styles: [] });

  const client = new SSActiveWearClient();
  try {
    const styles = await client.getStyles(search);
    return json({ styles });
  } catch (error) {
    return json({ styles: [], error: "Failed to fetch styles" });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const styleId = formData.get("styleId");

  if (!styleId) return json({ error: "Style ID required" }, { status: 400 });

  const importer = new ImporterService();
  try {
    await importer.importStyle(admin, Number(styleId));
    return json({ success: true, message: `Style ${styleId} imported successfully` });
  } catch (error) {
    console.error(error);
    return json({ error: "Import failed" }, { status: 500 });
  }
}

export default function ImportPage() {
  const { styles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();

  const [query, setQuery] = useState("");

  const handleSearch = () => {
    submit({ search: query }, { method: "get" });
  };

  const handleImport = (styleId: number) => {
    submit({ styleId: String(styleId) }, { method: "post" });
  };

  const resourceName = {
    singular: 'style',
    plural: 'styles',
  };

  const rowMarkup = styles.map(
    (
      { styleID, title, brandName, partNumber, baseCategory, styleImage },
      index
    ) => (
      <IndexTable.Row id={String(styleID)} key={styleID} position={index}>
        <IndexTable.Cell>{brandName}</IndexTable.Cell>
        <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold" as="span">{title}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{partNumber}</IndexTable.Cell>
        <IndexTable.Cell>{baseCategory}</IndexTable.Cell>
        <IndexTable.Cell>
            <Button onClick={() => handleImport(styleID)} loading={nav.state === "submitting"}>Import</Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page title="Import Products from SSActiveWear">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
               <div style={{ padding: "16px" }}>
                  <TextField
                    label="Search Styles"
                    value={query}
                    onChange={setQuery}
                    autoComplete="off"
                    connectedRight={<Button onClick={handleSearch}>Search</Button>}
                    placeholder="e.g. Gildan 5000"
                  />
               </div>

               {styles.length > 0 && (
                 <IndexTable
                   resourceName={resourceName}
                   itemCount={styles.length}
                   headings={[
                     { title: 'Brand' },
                     { title: 'Title' },
                     { title: 'Part #' },
                     { title: 'Category' },
                     { title: 'Action' },
                   ]}
                 >
                   {rowMarkup}
                 </IndexTable>
               )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
