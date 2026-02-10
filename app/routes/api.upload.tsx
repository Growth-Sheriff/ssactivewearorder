import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, unstable_parseMultipartFormData } from "@remix-run/node";

// Cloudflare R2 configuration
// Cloudflare R2 configuration (Hardcoded for reliability)
const R2 = new S3Client({
  region: "auto",
  endpoint: "https://3b964e63af3f0e752c640e35dab68c9b.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "407a988b60e3771bc982048523562047",
    secretAccessKey: "e343c33e70b5c0ba965b4d7d4d5605693239122f704d1d219a4fec860cf7384b",
  },
});

const BUCKET_NAME = "ssactivewearorder";
const PUBLIC_URL = "https://img-ssa-e.techifyboost.com";

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

// Health Check Loader: Visit /apps/ssactiveorder/api/upload to verify deployment
export const loader = async () => {
  return json({
    status: "ok",
    message: "Upload API is active",
    timestamp: new Date().toISOString()
  });
};

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
        { success: false, error: "Upload failed - No URL returned" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
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
    console.error("Upload Critical Error:", error);
    // Return JSON instead of crashing with 500
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown Server Error",
        details: "Check server logs for R2 client issues"
      },
      {
        status: 200, // Return 200 so client JS can parse the JSON error
        headers: { "Access-Control-Allow-Origin": "*" }
      }
    );
  }
};
