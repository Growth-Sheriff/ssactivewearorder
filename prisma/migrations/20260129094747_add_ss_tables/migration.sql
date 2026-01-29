-- CreateTable
CREATE TABLE "ProductMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyProductId" TEXT NOT NULL,
    "ssStyleId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "VariantMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyVariantId" TEXT NOT NULL,
    "ssSku" TEXT NOT NULL,
    "productMapId" TEXT NOT NULL,
    CONSTRAINT "VariantMap_productMapId_fkey" FOREIGN KEY ("productMapId") REFERENCES "ProductMap" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ssOrderNumber" TEXT,
    "logs" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMap_shopifyProductId_key" ON "ProductMap"("shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMap_shopifyVariantId_key" ON "VariantMap"("shopifyVariantId");
