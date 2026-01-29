import type { LoaderFunctionArgs } from "@remix-run/node";

// Proxy SSActiveWear images through our server
// This bypasses Cloudflare bot protection by using server-side fetch
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const imagePath = url.searchParams.get("path");

  if (!imagePath) {
    return new Response("Missing image path", { status: 400 });
  }

  // Construct the SSActiveWear image URL
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
      // Return a placeholder image
      return Response.redirect("https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", 302);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await response.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400", // Cache for 24 hours
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error(`[Image Proxy] Error fetching image:`, error);
    return Response.redirect("https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", 302);
  }
}
