import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, unstable_parseMultipartFormData } from "@remix-run/node";

// Cloudflare R2 configuration
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

// Custom upload handler for multipart form data
async function uploadHandler(
  part: { name: string; contentType: string; data: AsyncIterable<Uint8Array> }
) {
  if (part.name !== "file") {
    // For non-file fields, collect the data as text
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

  // Generate unique filename
  const ext = part.contentType.split("/")[1] || "png";
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

  // Return public URL
  return `${PUBLIC_URL}/${filename}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
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

  try {
    const formData = await unstable_parseMultipartFormData(
      request,
      uploadHandler
    );

    const fileUrl = formData.get("file") as string;

    if (!fileUrl || !fileUrl.startsWith("http")) {
      return json(
        { success: false, error: "Upload failed" },
        { status: 400 }
      );
    }

    return json(
      { success: true, url: fileUrl },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Upload error:", error);
    return json(
      { success: false, error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
};
