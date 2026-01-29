import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { LoaderFunctionArgs } from "@remix-run/node";

// R2 Configuration
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

let r2Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    return null;
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

// Convert SSActiveWear path to R2 key
function pathToR2Key(imagePath: string): string {
  // e.g., "Images/Style/16_fm.jpg" -> "ssactivewear/style/16_fm.jpg"
  return `ssactivewear/${imagePath.toLowerCase().replace("images/", "")}`;
}

// Check if image exists in R2
async function checkR2Cache(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

// Upload image to R2
async function uploadToR2(client: S3Client, key: string, buffer: ArrayBuffer, contentType: string): Promise<void> {
  try {
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: new Uint8Array(buffer),
      ContentType: contentType,
      CacheControl: "public, max-age=31536000", // Cache for 1 year
    }));
    console.log(`[Image Proxy] Cached to R2: ${key}`);
  } catch (error) {
    console.error(`[Image Proxy] Failed to cache to R2:`, error);
  }
}

// Proxy SSActiveWear images through our server with R2 caching
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const imagePath = url.searchParams.get("path");

  if (!imagePath) {
    return new Response("Missing image path", { status: 400 });
  }

  const r2 = getR2Client();
  const r2Key = pathToR2Key(imagePath);

  // Check R2 cache first
  if (r2 && R2_PUBLIC_URL) {
    const exists = await checkR2Cache(r2, r2Key);
    if (exists) {
      // Redirect to R2 public URL
      const r2Url = `${R2_PUBLIC_URL}/${r2Key}`;
      console.log(`[Image Proxy] Serving from R2: ${r2Url}`);
      return Response.redirect(r2Url, 302);
    }
  }

  // Fetch from SSActiveWear
  const ssImageUrl = `https://www.ssactivewear.com/${imagePath}`;

  try {
    const response = await fetch(ssImageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.ssactivewear.com/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    if (!response.ok) {
      console.error(`[Image Proxy] Failed to fetch ${ssImageUrl}: ${response.status}`);
      return Response.redirect("https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", 302);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await response.arrayBuffer();

    // Upload to R2 for future requests (non-blocking)
    if (r2) {
      uploadToR2(r2, r2Key, imageBuffer, contentType).catch(() => {});
    }

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error(`[Image Proxy] Error fetching image:`, error);
    return Response.redirect("https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", 302);
  }
}
