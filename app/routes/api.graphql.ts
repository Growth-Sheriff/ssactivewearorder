import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, unstable_parseMultipartFormData } from "@remix-run/node";
import { createYoga } from "graphql-yoga";
import { resolvers } from "../graphql/resolvers";
import { typeDefs } from "../graphql/schema";

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Request, Response, fetch },
});

// ─── Cloudflare R2 Upload Handler ───
const R2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "designs";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

async function handleFileUpload(request: Request) {
  try {
    const formData = await unstable_parseMultipartFormData(
      request,
      async (part: {
        name: string;
        contentType: string;
        data: AsyncIterable<Uint8Array>;
      }) => {
        if (part.name !== "file") {
          const chunks: Uint8Array[] = [];
          for await (const chunk of part.data) {
            chunks.push(chunk);
          }
          return new TextDecoder().decode(Buffer.concat(chunks));
        }

        // Collect file data
        const chunks: Uint8Array[] = [];
        for await (const chunk of part.data) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Determine file extension from content type or filename
        const extMap: Record<string, string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/jpg": "jpg",
          "image/gif": "gif",
          "image/svg+xml": "svg",
          "image/webp": "webp",
          "image/tiff": "tiff",
          "image/bmp": "bmp",
          "application/pdf": "pdf",
          "application/postscript": "ai",
          "image/vnd.adobe.photoshop": "psd",
          "application/x-photoshop": "psd",
          "application/octet-stream": "bin",
        };
        const ext = extMap[part.contentType] || part.contentType.split("/")[1] || "bin";
        const filename = `designs/${crypto.randomUUID()}.${ext}`;

        // Upload to R2
        await R2.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
            Body: buffer,
            ContentType: part.contentType,
          })
        );

        return `${PUBLIC_URL}/${filename}`;
      }
    );

    const fileUrl = formData.get("file") as string;

    if (!fileUrl || !fileUrl.startsWith("http")) {
      return json(
        { success: false, error: "Upload failed - no URL returned" },
        {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    return json(
      { success: true, url: fileUrl },
      {
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (error) {
    console.error("Upload error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      },
      {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
}

// ─── Route Handlers ───

export async function loader({ request }: LoaderFunctionArgs) {
  return yoga.handleRequest(request, {});
}

export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const contentType = request.headers.get("content-type") || "";

  // Route: If multipart/form-data → file upload
  // Route: If application/json → GraphQL
  if (contentType.includes("multipart/form-data")) {
    return handleFileUpload(request);
  }

  // Default: GraphQL
  return yoga.handleRequest(request, {});
}
