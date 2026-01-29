2026 graphql teknolojine göre ssactive wear apisini kullanarak ssactivewear sipariş teknolojisi yapacağız


onların ürünlerine gelen siparişleri ssactivewaera aktarmak için

GET - Categories
The Categories API gives information about the categories each style is assigned to.
Resource URL:
GET     https://api.ssactivewear.com/v2/categories/
Request Options:
Get All	/v2/categories/	Returns all categories
Filter Results	/v2/categories/{category}
/v2/categories/1	Returns categories by filter

{category} = is a comma separated list of category identifiers
identifiers = CategoryID
Filter Fields	/v2/categories/?fields={fields}/v2/categories/?fields=CategoryID,Name	Returns specifically requested fields

{fields} = is a comma separated list of category object fields
Response Format	/v2/categories/?mediatype={mediatype}/v2/categories/?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/categories/81
Response:
[
   {
    "categoryID": 81,
    "name": "3/4 Sleeve",
    "image": "deprecated"
  }
]
Category Object Definition:
categoryID	Integer	Unique ID for this category (does not change)
name	String	Logical name for the category.
image	String	{deprecated}
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - Styles
The Styles API gives basic style level information that is repeated on every sku within the style.
Resource URL:
GET     https://api.ssactivewear.com/v2/styles/
Request Options:
Get All	/v2/styles/	Returns all styles
Filter Results	/v2/styles/{style}
/v2/styles/39,Gildan 5000/v2/styles/00760,Gildan 5000
Returns styles matching filter condition

{style} = is a comma separated list of style identifiers
identifiers = StyleID, PartNumber, BrandName Name
Search Results	/v2/styles/search={value}
/v2/styles?search=Gildan 2000/v2/styles?search=Gildan
Returns styles matching filter condition

{style} = is a comma separated list of style identifiers
identifiers = StyleID, PartNumber, BrandName Name
Filter Results By StyleID Or PartNumber	/v2/styles/?styleid={style}
/v2/styles/?styleid=39
/v2/styles/?partnumber={partnumber}
/v2/styles/?partnumber=00760	Returns styles matching filter condition

{styleid} = is a comma separated list of styleid
{partnumber} = is a comma separated list of partnumber
Filter Fields	/v2/styles/?fields={fields}/v2/styles/Gildan 5000?fields=BrandName,Name,Title	Returns only the fields that you request

{fields} = is a comma separated list of style object fields
fields = See style object definition below
Response Format	/v2/styles/00760?mediatype={mediatype}/v2/styles/00760?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/styles/00760
Response:
[
   {
    "styleID": 39,
    "partNumber": "00760",
    "brandName": "Gildan",
    "styleName": "2000",
    "title": "Ultra Cotton™ T-Shirt",
    "description":
        "6.0 oz., pre-shrunk 100% cotton (Dark Heather, Heather Cardinal, Heather Indigo, Heather Navy, Heather Sapphire, Safety Green, Safety Orange and Safety Pink are 50/50 cotton/polyester. Antique Cherry Red, Antique Irish Green, Antique Royal and Sport Grey are 90/10 cotton/polyester. Ash Grey is 99/1 cotton/polyester.)
        Safety Green and Safety Orange are compliant with ANSI High Visibility Standards
        Double-needle stitched neckline, bottom hem and sleeves
        Quarter-turned
        Shoulder-to-shoulder taping
        Seven-eighths inch collar",
    "baseCategory": "T-Shirts",
    "categories": "21,57,71,79,87",
    "catalogPageNumber": "182",
    "newStyle": false,
    "comparableGroup": 7,
    "companionGroup": 2,
    "brandImage": "Images/Brand/35_fl.jpg",
    "styleImage": "Images/Style/39_fl.jpg",
    "sustainableStyle": true
  }
]
Style Object Definition:
styleID	Integer	Unique ID for this style (does not change)
partNumber	String	First 5 digits of our sku number. It is the same for all skus in the style.
brandName	String	The brand that makes this style.
styleName	String	The style's name. Style names are unique within a brand.
title	String	A short description of the style.
description	String	Long HTML description of the style.
baseCateogry	String	Primary category for the style. Only one per style.
categories	String	Comma separated list of Categories that the style belongs to.

- Category details can be found in the Categories API.
catalogPageNumber	String	Page number the style appears in our current catalog.
newStyle	Boolean	Defines if the style is new.
comparableGroup	String	Styles with the same ComparableGroup are considered to be similar products.
companionGroup	String	Styles with the same CompanionGroup are considered to be within the same product family.
brandImage	String	URL to the medium image for this styles brand.

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
styleImage	String	URL to the medium image for this style

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
sustainableStyle	Boolean	Defines if the style meets S&S Sustainable Materials, Manufacturing, & Socially Conscious Manufacturing criteria.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - Products
The products API gives information about a product. Certain style level information may need to be looked up using the style API.
Resource URL:
GET     https://api.ssactivewear.com/v2/products/
Request Options:
Get All	/v2/products/	Returns all products
Filter Results	/v2/products/{product}
/v2/products/B00760004
/v2/products/81480,B00760004,00821780008137	Returns products matching filter condition

{product} = is a comma separated list of product identifiers
identifiers = SkuID, Sku, Gtin, YourSku
Filter Results By Styles	/v2/products/?style={style}
/v2/products/?style=00760
/v2/products/?style=00760,Gildan 5000/v2/products/?style=bella%20%2B%20canvas%203001cvc	Returns products matching filter condition

{style} = is a comma separated list of style identifiers
identifiers = StyleID, PartNumber, BrandName Name (When using BrandName Name, special characters and spaces will need to be encoded.)
Filter Results By StyleID Or PartNumber	/v2/products/?styleid={style}
/v2/products/?styleid=39
/v2/products/?partnumber={partnumber}
/v2/products/?partnumber=00760	Returns products matching filter condition

{styleid} = is a comma separated list of styleid
{partnumber} = is a comma separated list of partnumber
Filter Warehouses	/v2/products/B00760003?Warehouses?{WarehouseAbbr}
/v2/products/B00760003?Warehouses=IL,KS	Returns only the warehouses requested

{WarehouseAbbr} = is a comma separated list of warehouseAbbr
Filter Fields	/v2/products/B00760003?fields={fields}
/v2/products/B00760003?fields=Sku,Gtin,Qty,CustomerPrice	Returns only the fields that you request

{fields} = is a comma separated list of product object fields
Response Format	/v2/products/B00760003?mediatype={mediatype}/v2/products/B00760003?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/products/B00760004
Response:
[
    {
        "sku": "B00760004",
        "gtin": "00821780001001",
        "skuID_Master": 2343,
        "yourSku": "",
        "styleID": 39,
        "brandName": "Gildan",
        "styleName": "2000",
        "colorName": "White",
        "colorCode": "00",
        "colorPriceCodeName": "White",
        "colorGroup": "79",
        "colorGroupName": "White",
        "colorFamilyID": "1",
        "colorFamily": "Neutrals",
        "colorSwatchImage": "Images/ColorSwatch/7229_fm.jpg",
        "colorSwatchTextColor": "#000000",
        "colorFrontImage": "Images/Color/17130_f_fm.jpg",
        "colorSideImage": "Images/Color/17130_fm.jpg",
        "colorBackImage": "Images/Color/17130_b_fm.jpg",
        "colorDirectSideImage": "",
        "colorOnModelFrontImage": "",
        "colorOnModelSideImage": "",
        "colorOnModelBackImage": "",
        "color1": "#FFFFFF",
        "color2": "",
        "sizeName": "M",
        "sizeCode": "4",
        "sizeOrder": "B2",
        "sizePriceCodeName": "S-XL",
        "caseQty": 72,
        "unitWeight": 0.4444444444444,
        "mapPrice": x.xx,
        "piecePrice": x.xx,
        "dozenPrice": x.xx,
        "casePrice": x.xx,
        "salePrice": x.xx,
        "customerPrice": x.xx,
        "saleExpiration": "2016-08-05T00:00:00",
        "noeRetailing": false,
        "caseWeight": 28,
        "caseWidth": 16,
        "caseLength": 23.75,
        "caseHeight": 12.5,
        "PolyPackQty":"24",
        "qty": 19536,
        "countryOfOrigin": "NI,DO,HT",
        "warehouses":
        [
            {
                "warehouseAbbr": "IL",
                "skuID": 2343,
                "qty": 10000,
                "closeout": false,
                "dropship": false,
                "excludeFreeFreight": false,
                "fullCaseOnly": false,
                "returnable": true
            },
            {
                "warehouseAbbr": "NV",
                "skuID": 55405,
                "qty": 0,
                "closeout": false,
                "dropship": false,
                "excludeFreeFreight": false,
                "fullCaseOnly": false,
                "returnable": true
            },
            {
                "warehouseAbbr": "PA",
                "skuID": 170872,
                "qty": 2210,
                "closeout": false,
                "dropship": false,
                "excludeFreeFreight": false,
                "fullCaseOnly": false,
                "returnable": true
            },
            {
                "warehouseAbbr": "KS",
                "skuID": 263747,
                "qty": 7326,
                "closeout": false,
                "dropship": false,
                "excludeFreeFreight": false,
                "fullCaseOnly": false,
                "returnable": true
            }
        ]
    }
]
Not Found Response:

HTTP Response Code: 404
{
  "errors":
  [
    {
      "field": "Identifier",
      "message": "Requested item(s) were not found or have been discontinued."
    }
  ]
}
Product Object Definition:
skuID	Integer	Unique ID for this sku (does not change)
sku	String	Our sku number
gtin	String	Industry standard identifier used by all suppliers.
yourSku	String	YourSku has been set up using the CrossRef API.
styleID	Integer	Unique ID for this style (Will never change)
brandName	String	The brand that makes this style.
styleName	String	The style's name. Style names are unique within a brand.
colorName	String	The color of this product.
colorCode	String	Two digit color code part of the InventoryKey.
colorPriceCodeName	String	The pricing category of this color.
colorGroup	String	Colors with a similar color group are considered to be a similar color.
colorGroupName	String	Colors with a similar color group are considered to be a similar color.
colorFamilyID	Integer	Base color the color falls under.
colorFamily	String	Base color the color falls under.
colorSwatchImage	String	URL to the medium swatch image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fs" for the small image
colorSwatchTextColor	String	Html color code that is visible on top of the color swatch
colorFrontImage	String	URL to the medium front image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorSideImage	String	URL to the medium side image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorBackImage	String	URL to the medium back image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorDirectSideImage	String	URL to the medium direct side image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorOnModelFrontImage	String	URL to the medium on model front image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorOnModelSideImage	String	URL to the medium on model side image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
colorOnModelBackImage	String	URL to the medium on model back image for this color

- Example URL: https://www.ssactivewear.com/{Image}
- Replace "_fm" with "_fl" for the large image
- Replace "_fm" with "_fs" for the small image
color1	String	HTML Code for the primary color.
color2	String	HTML Code for the secondary color.
sizeName	String	Size Name that the spec belongs to.
sizeCode	String	One digit size code part of the InventoryKey.
sizeOrder	String	Sort order for the size compared to other sizes in the style.
sizePriceCodeName	String	The pricing category of this size.
caseQty	Integer	Number of units in a full case from the mill.
unitWeight	Decimal	Weight of a single unit.
mapPrice	Decimal	Minimum Advertised Price price
piecePrice	Decimal	Piece price level price
dozenPrice	Decimal	Dozen price level price
casePrice	Decimal	Case price level price
salePrice	Decimal	Sale price level price
customerPrice	Decimal	Your price
saleExpiration	String	MM/DD/YYYY
noeRetailing	Boolean	When true, mill prohibits the selling of products on popular eRetailing platforms such as Amazon, Walmart, EBay.
caseWeight	Decimal	Weight of full case in pounds
caseWidth	Decimal	Width of case in inches
caseLength	Decimal	Length of case in inches
caseHeight	Decimal	Height of case in inches
PolyPackQty	Integer	Number of pieces in a poly pack
qty	Integer	Combined Inventory in all of our warehouses
countryOfOrigin	String	Country of manufacture for product. Provided by mills.
warehouses	List of Object
warehouseAbbr	String	Code identifying the Warehouse.
skuID	Integer	skuID identifying the Sku and Warehouse.
qty	Integer	Quantity available for sale.
closeout	Boolean	Skus that are discontinued and will not be replenished.
dropship	Boolean	This product does not ship from our warehouse.
excludeFreeFreight	Boolean	This product does not qualify for free freight.
fullCaseOnly	Boolean	This product must be ordered in full case quantities.
expectedInventory	String	Current enroute quantities with expected dates of receipt and current quantity on order with the mill. If no dates are available, None will be returned.
returnable	Boolean	This product is eligible for return.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - Inventory
The Inventory API gives information about warehouse inventory. The inventory API has the same filter options as Get Products but has a greatly reduced response payload size.
Resource URL:
GET     https://api.ssactivewear.com/v2/inventory/
Request Options:
Get All	/v2/inventory/	Returns all inventory items
Filter Results	/v2/inventory/{product}
/v2/inventory/B00760004
/v2/inventory/81480,B00760004,00821780008137	Returns inventory matching filter condition

{product} = is a comma separated list of product identifiers
identifiers = SkuID, Sku, Gtin, YourSku
Filter Results By Styles	/v2/inventory/?style={style}
/v2/inventory/?style=00760
/v2/inventory/?style=00760,Gildan 5000/v2/inventory/?style=bella + canvas 3001cvc	Returns inventory matching filter condition

{style} = is a comma separated list of style identifiers
identifiers = StyleID, PartNumber, BrandName Name (When using BrandName Name, special characters and spaces will need to be encoded.)
Filter Results By StyleID Or PartNumber	/v2/inventory/?styleid={style}
/v2/inventory/?styleid=39
/v2/inventory/?partnumber={partnumber}
/v2/inventory/?partnumber=00760	Returns inventory matching filter condition

{styleid} = is a comma separated list of styleid
{partnumber} = is a comma separated list of partnumber
Filter Warehouses	/v2/inventory/B00760003?Warehouses?{WarehouseAbbr}
/v2/inventory/B00760003?Warehouses=IL,KS	Returns only the warehouses requested

{WarehouseAbbr} = is a comma separated list of warehouseAbbr
Response Format	/v2/inventory/B00760003?mediatype={mediatype}/v2/inventory/B00760003?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/inventory/B00760004
Response:
[
    {
        "sku": "B00760004",
        "gtin": "00821780001001",
        "skuID_Master": 2343,
        "yourSku": "",
        "styleID": 39,
        "warehouses":
        [
            {
                "warehouseAbbr": "IL",
                "skuID": 2343,
                "qty": 10000
            },
            {
                "warehouseAbbr": "NV",
                "skuID": 55405,
                "qty": 0
            },
            {
                "warehouseAbbr": "NJ",
                "skuID": 170872,
                "qty": 2210
            },
            {
                "warehouseAbbr": "KS",
                "skuID": 263747,
                "qty": 7326
            }
        ]
    }
]
Not Found Response:

HTTP Response Code: 404
{
  "errors":
  [
    {
      "field": "Identifier",
      "message": "Requested item(s) were not found or have been discontinued."
    }
  ]
}
Inventory Object Definition:
skuID	Integer	Unique ID for this sku (does not change)
sku	String	Our sku number
gtin	String	Industry standard identifier used by all suppliers.
yourSku	String	YourSku has been set up using the CrossRef API.
styleID	Integer	Unique ID for this style (Will never change)
warehouses	List of Object
warehouseAbbr	String	Code identifying the Warehouse.
skuID	Integer	skuID identifying the Sku and Warehouse.
qty	Integer	Quantity available for sale.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

GET - Specs
The specs API gives information about a given style's specs. This information is used to build the spec sheets.
Resource URL:
GET     https://api.ssactivewear.com/v2/specs/
Request Options:
Get All	/v2/specs/	Returns all styles
Filter Results	/v2/specs/{spec}/v2/specs/634	Returns specs matching filter condition

{spec} = is a comma separated list of spec identifiers
identifiers = SpecID
Filter Results By Style	/v2/specs/?style={style}/v2/specs/?style=39,Gildan 5000/v2/specs/?style=00760,Gildan 5000	Returns specs matching filter condition

{style} = is a comma separated list of style identifiers
identifiers = StyleID, PartNumber, BrandName Name
Filter Fields	/v2/spec/39?fields={fields}/v2/spec/39?fields=SizeName,SpecName,Value	Returns only the fields that you request

{fields} = is a comma separated list of style object fields
fields = See style object definition below
Response Format	/v2/specs/39?mediatype={mediatype}/v2/specs/39?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/specs/39
Response:
[
    {
        "specID": 39,
        "styleID": 253,
        "partNumber": "13498",
        "brandName": "IZOD",
        "styleName": "13Z0075",
        "sizeName": "S",
        "sizeOrder": "B1",
        "specName": "Neck Size",
        "value": "16"
    }
]
Specs Object Definition:
specID	Integer	Unique ID for this spec (Will never change)
styleID	Integer	Unique ID for this style (Will never change)
partNumber	String	First 5 digits of our sku number. It is the same for all skus in the style.
brandName	String	The brand that makes this style.
styleName	String	The style's name. Style names are unique within a brand.
sizeName	String	Size Name that the spec belongs to.
sizeOrder	String	Sort order for the size compared to other sizes in the style.
specName	String	The name of the spec.
value	String	The value of the spec.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - Brands
The Brands API gives information about the Brands each style is assigned to.
Resource URL:
GET     https://api.ssactivewear.com/v2/Brands/
Request Options:
Get All	/v2/Brands/	Returns all Brands
Filter Results	/v2/Brands/{brandID}
/v2/Brands/1	Returns Brands by filter

{brandID} = is a comma separated list of category identifiers
identifiers = BrandID
Response Format	/v2/Brands/?mediatype={mediatype}/v2/Brands/?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/Brands/31
Response:
[
   {
    "brandID": 31,
    "name": "Adidas",
    "image": "Images/Brand/31_fm.png",
    "noeRetailing": true
  }
]
Brand Object Definition:
brandID	Integer	Unique ID for this brand (does not change).
name	String	Logical name for the brand.
image	String	URL to the image for this brand. Alternate image sizes are available: _fl is large, _fm is medium and _fs is small.
noeRetailing	Boolean	When true, mill prohibits the selling of products on popular eRetailing platforms such as Amazon, Walmart, EBay.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use



GET - Orders
The orders API gives information about previous and pending orders.
Resource URL:
GET     https://api.ssactivewear.com/v2/orders/
Request Options:
Get All Open	/v2/orders/	Returns all orders that have not been invoiced.
Get All Open and Invoiced (Last 3 months	/v2/orders/?All=True	Returns all orders that have been placed in last 3 months.
Filter Results	/v2/orders/{order}/v2/orders/PO,123456	Returns specs matching filter condition

{order} = is a comma separated list of order identifiers
identifiers = PONumber, OrderNumber, InvoiceNumber, GUID
Filter Results By Invoice Date	/v2/orders/?invoicedate={invoicedate}/v2/orders/?invoicedate=2014-06-18/v2/orders/?invoicedate=2014-06-18,2014-06-19/v2/orders/?invoicestartdate=2014-06-18&invoiceenddate=2015-06-19	Returns specs matching filter condition

{invoicedate} = is a date (fromat = yyyy-MM-dd)
{invoicestartdate&invoiceenddate} = Both InvoiceStartdate, InvoiceEnddate are required (fromat = yyyy-MM-dd)
Filter Results By Shipping Label Barcode	/v2/orders/?shippinglabelbarcode={shippinglabelbarcode}/v2/orders/?shippinglabelbarcode=57926652.0031	Returns specs matching filter condition

{shippinglabelbarcode} = is a string (format = InvoiceNumber.BoxNumberLane)
Filter Fields	/v2/orders/?fields={fields}/v2/orders/?invoicedate=2014-06-18&fields=InvoiceNumber,OrderNumber,TrackingNumber,Total	Returns only the fields that you request

{fields} = is a comma separated list of style object fields
Include Lines	/v2/orders/?lines=true	Returns the order lines for each order.
Include Boxes	/v2/orders/?Boxes=true	Returns the order Boxes for each order.
Include AR Child Invoices	/v2/orders/?includeARChildInvoices=true	Returns orders for the primary (parent) account and also orders for any AR child accounts.
Include Billing Address	/v2/orders/?Billing=true	Returns the Billing Address for each order.
Response Format	/v2/orders/?mediatype={mediatype}/v2/orders/?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/orders/4629304
Response:

[
   {
     "guid": "e66b7667-868f-4ae0-b605-2f45fbd288c0",
     "companyName":"Bolingbrook",
     "warehouseAbbr":"IL",
     "orderNumber": "4629304",
     "invoiceNumber": "907070",
     "poNumber": "Jim B",
     "customerNumber": "00002",
     "orderDate": "2014-06-18T10:59:06.43",
     "shipDate": "2014-06-18T14:15:31.613",
     "invoiceDate": "2014-06-18T00:00:00",
     "orderType": "CSR",
     "terms": "Credit Card",
     "orderStatus": "Shipped",
     "dropship": false,
     "shippingCarrier": "UPS",
     "shippingMethod": "Ground",
     "shipBlind": false,
     "shippingCollectNumber": "",
     "trackingNumber": "1ZE9W0610315091599",
     "shippingAddress":
	 {
       "customer": "Timesaver",
       "attn": "Jim Beale",
       "address": "W8020 W Clay School Rd",
       "city": "Merrillan",
       "state": "WI",
       "zip": "54754"
     },
     "subtotal": 144.38,
     "shipping": 0,
     "shippingSaved": 0.00,
     "cod": 0,
     "tax": 0,
     "smallOrderFee": 0,
     "cuponDiscount": 0,
     "sampleDiscount": 0,
     "setUpFee": 0,
     "restockFee": 0,
     "debitCredit": 0,
     "total": 144.38,
     "totalPieces": 30,
     "totalLines": 18,
     "totalWeight": 17.35,
     "totalBoxes": 1
	}
]

Order Object Definition:
guid	String	Unique ID for this order (does not change)
companyName	String	Company name
warehouseAbbr	String	Options:
IL = Lockport, IL
NV = Reno, NV
NJ = Robbinsville, NJ
KS = Olathe, KS
GA = McDonough, GA
TX = Fort Worth, TX
FL = Pompano Beach, FL
OH = West Chester, OH
DS = Dropship
orderNumber	String	The order and confirmation number assigned when orders are placed.
invoice Number	String	The invoice number is assigned shortly after you place your order.
poNumber	String	The PO number submitted with the order.
customerNumber	String	Customer number of account.
orderDate	DateTime	Date order was placed. Example: 2014-06-12T09:41:17.837 (ISO 8601)
shipDate	DateTime	Date order was shipped. Example: 2014-06-12T09:41:17.837 (ISO 8601)
*Will not be available until the order has shipped.
invoiceDate	DateTime	Date order was Invoiced. Example: 2014-06-12T00:00:00.000 (ISO 8601)
*Will not be available until the order is invoiced.
orderType	String	How the order was placed. (Options: CSR, Web, EDI, Credit)
terms	String	Terms of the order.
orderStatus	String	Status of order. (Order statues: InProgress (order has been received and being prepared for shipment), Shipped (order has shipped), Completed (order is ready for pickup at Will Call), Canceled (order is cancelled))
dropship	Boolean	If the order is a dropship order.
shippingCarrier	String	Carrier used.
shippingMethod	String	Freight service Used
shipBlind	Boolean	Determines if the order has blind shipping.
shippingCollectNumber	String	Freight account that was charged
trackingNumber	String	TrackingNumber if available.
*Will not be available until the order has shipped.
shippingAddress	Object
customer	String	Customer Name
attn	String	Attention Line
address	String	Address Line
city	String	City
state	String	State
zip	String	Zip
billingAddress	Object
billTo	String	Billing Name
attn	String	Attention Line
address	String	Address Line
city	String	City
state	String	State
zip	String	Zip
subtotal	Decimal	Merchandise value of the order.
shipping	Decimal	Shipping and handling charged
shippingSaved	Decimal	Difference between the calculated cost of the shipment from the carrier and what S&S charges.
cod	Decimal	COD amount
tax	Decimal	Tax charged
smallOrderFee	Decimal	Small Order Fee
cuponDiscount	Decimal	Misc discount (not used)
sampleDiscount	Decimal	Sample Discount
setUpFee	Decimal	Set Up Fee
restockFee	Decimal	Restock Fee
debitCredit	Decimal	Debit/Credit
total	Decimal	Total order amount
totalPieces	Integer	Total pieces on order
totalLines	Integer	Total lines on order
totalWeight	Decimal	Total weight of order
totalBoxes	Decimal	Total boxes on the order
deliveryStatus	String	Orders Current Delivery Status. (Options: Picked Up, Shipped, Shipped - Delivered, Shipped - Exception, Shipped - Expired, Shipped - In Transit, Shipped - Out For Delivery, Shipped - Pending, Shipped - Unknown.)
lines	List Of Object
lineNumber	Integer	Line Number of the order
type	String	S = Stocked Skus, NS = Not Stocked Skus
skuID	Integer	Unique ID for this sku (Will never change)
sku	String	Part Number for product
gtin	String	Industry standard identifier used by all suppliers.
yourSku	String	YourSku has been set up using the CrossRef API.
qtyOrdered	Integer	Qty ordered
qtyShipped	Integer	Qty shipped
price	Decimal	Price of each item
brandName	String	Brand name
styleName	String	Style Name
title	String	Description of product
colorName	String	Color name
sizeName	String	Size Name
returnable	Boolean	This product is eligible for return.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

DELETE - Orders
Allows for canceling orders up to 10 minutes after they have been placed.
Resource URL:
DELETE     https://api.ssactivewear.com/v2/orders/
Request Options:
Delete By OrderNumber	/v2/orders/{OrderNumber}	Tries to cancel the specified order number
Example Request:
DELETE     https://api.ssactivewear.com/v2/orders/9490497
Response:
[
    {
        "guid": "74f3e857-9357-4737-9baa-1e5023996f7d",
        "companyName": "S&S Activewear",
        "warehouseAbbr": "IL",
        "orderNumber": "9490497",
        "invoiceNumber": "3933327",
        "poNumber": "Test",
        "customerNumber": "00002",
        "orderDate": "2016-11-18T17:37:48.743",
        "orderType": "API",
        "terms": "Net 30",
        "orderStatus": "Cancelled",
        "dropship": false,
        "shippingCarrier": "UPS",
        "shippingMethod": "Ground",
        "shipBlind": false,
        "shippingCollectNumber": "",
        "shippingAddress": {
            "customer": "Company ABC",
            "attn": "John Doe",
            "address": "123 Main St",
            "city": "Bollingbrook",
            "state": "WI",
            "zip": "60440"
        },
        "subtotal": 0,
        "shipping": 0,
        "cod": 0,
        "tax": 0,
        "smallOrderFee": 0,
        "cuponDiscount": 0,
        "sampleDiscount": 0,
        "setUpFee": 0,
        "restockFee": 0,
        "debitCredit": 0,
        "total": 0,
        "totalPieces": 0,
        "totalLines": 0,
        "totalWeight": 0.54,
        "totalBoxes": 1
    }
]
*Returns a list of orders that were able to be canceled.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use



POST - Orders
The orders API allows orders to be placed and get an immediate confirmation.
Resource URL:
POST     https://api.ssactivewear.com/v2/orders/
Order Object Definition:
shippingAddress	Object
customer	String	Customer Name (Default="")
attn	String	Attention Line (Default="")
address	String	Address Line
city	String	City
state	String	State
zip	String	Zip (5 digits)
residential	Boolean	Residential Address (Default=true)
shippingMethod	String	Select Shipping Method (Default="1")

Options:
1 = Ground (Carrier determined by S&S)
2 = UPS Next Day Air
3 = UPS 2nd Day Air
16 = UPS 3 Day Select
6 = Will Call / PickUp
8 = Messenger Pickup / PickUp
54 = Misc Cheapest (S&S will pick the most cost-effective ground between (USPS First Class, USPS Priority Mail, UPS Surepost, UPS Ground)
17 = UPS Next Day Air Early AM
21 = UPS Next Day Air Saver
19 = UPS Saturday
20 = UPS Saturday Early
22 = UPS 2nd Day Air AM
14 = FedEx Ground
27 = FedEx Next Day Standard
26 = FedEx Next Day Priority
40 = UPS Ground
48 = FedEx 2nd Day Air
Note: For orders exceeding the weight limit (1000 lbs.), the shipping method will return as Echo Logistics LTL. You will be contacted by S&S shipping staff to schedule details of the shipment.
shipBlind	Boolean	When passed in, this setting will override the current customer settings.
poNumber	String	Customer PO Number (Default="")
emailConfirmation	String	Include a email address if you would like to receive a email confirmation. (Default="")
testOrder	Boolean	Test Orders will be created and cancelled (Default=false)
autoselectWarehouse	Boolean	If this is true, we will choose what warehouse we ship from. Each line may be split between multiple warehouses. The warehouseAbbr in the line detail will be ignored. (Default=false)
promotionCode	String	Promotion Code that applies to products on your order.
autoselectWarehouse_Warehouses	String	If you only want to order from selected warehouses, you can pass in a comma separated list of warehouseAbbr's to this field. Only warehouses contained in this list will be used. Example: "IL,KS,GA,NV,TX,FL,OH,PA,DS,CC,CN,FO,GD,KC,MA,PH,TD" (Default="")
AutoSelectWarehouse_Preference	String	Equivalent of the Freight Optimizer selection at checkout. Options: “fewest” or ”fastest” (Default=”fewest”)
AutoSelectWarehouse_Fewest_MaxDIT	Integer	The maximum number of days in transit for “fewest”. If days in transit is higher, selection is switched to “fastest”. (Default = 10)
rejectLineErrors	Boolean	If false: we will place an order(s) for all items that we can. The response body will contain both a list of Orders and LineErrors instead of the default Orders. (Default=true)
rejectLineErrors_Email	Boolean	For line items that we can not fill, a email will be sent to the "emailConfirmation" email address with the details. (Default=true)
paymentProfile	Object	This is used of you would like to pay via a saved credit card or bank account on your www.ssactivewear.com website account.
email	String	Email of the website user where the card is saved
profileID	integer	ProfileID retuned in GET - /V2/paymentprofile api call for the given profile
lines	List Of Object
warehouseAbbr	String	Determines what warehouse to ship from.
identifier	String	SkuID_Master, Sku, Gtin
qty	Integer	Qty to order
*Bold items are required
Extended Description:
The Content-Type header field must be set to application/json or application/xml.
Example Request:
POST                https://api.ssactivewear.com/v2/orders/
POST Data
{
  "shippingAddress":  {
    "customer": "Company ABC",
    "attn": "John Doe",
    "address": "123 Main St",
    "city": "Bolingbrook",
    "state": "IL",
    "zip": "60440",
    "residential": true
  },
  "shippingMethod": "1",
  "shipBlind": false,
  "poNumber": "Test",
  "emailConfirmation": "",
  "testOrder": false,
  "autoselectWarehouse": true,
  "lines":  [
     {
      "identifier": "B00760003",
      "qty": 2
    }
  ]
}
Response:
Response is the same as a GET Orders response
*If you pass in products from multiple warehouses, you will get multiple order responses.
Note: If you receive a 404 Bad Request response, please validate your json request at: http://jsonformatter.curiousconcept.com/
[
  {
    "guid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "companyName": "S&S Activewear",
    "warehouseAbbr": "IL",
    "orderNumber": "12345678",
    "invoiceNumber": "",
    "poNumber": "12345678",
    "customerNumber": "XXXXX",
    "orderDate": "2021-09-28T14:30:22.05",
    "expectedDeliveryDate": "2021-09-29T00:00:00",
    "orderType": "API",
    "terms": "Net",
    "orderStatus": "In Progress",
    "dropship": false,
    "shippingCarrier": "UPS",
    "shippingMethod": "UPS Ground",
    "shipBlind": false,
    "shippingCollectNumber": "",
    "shippingAddress": {
      "customer": "S&S Activewear",
      "attn": "Recipient",
      "address": "220 Remington Blvd",
      "city": "Bolingbrook",
      "state": "IL",
      "zip": "60440"
    },
    "subtotal": XX.XX,
    "shipping": XX.XX,
    "cod": 0,
    "tax": 0,
    "smallOrderFee": 0,
    "cuponDiscount": 0,
    "sampleDiscount": 0,
    "setUpFee": 0,
    "restockFee": 0,
    "debitCredit": 0,
    "total": XX.XX,
    "totalPieces": 0,
    "totalLines": 0,
    "totalWeight": 15.4,
    "totalBoxes": 1,
    "deliveryStatus": "",
    "conveyorLane": "8",
    "lines": [
      {
        "lineNumber": 1,
        "type": "S",
        "skuID": 1133166,
        "sku": "B22060655",
        "gtin": "00821780010012",
        "yourSku": "",
        "qtyOrdered": 12,
        "price": XX.XX,
        "brandName": "Gildan",
        "styleName": "18500",
        "title": "Heavy Blend™ Hooded Sweatshirt",
        "colorName": "Navy",
        "sizeName": "L",
        "returnable": true
      }
    ]
  }
]
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - Payment Profiles
The Payment Profile API gives you access to the profileID of saved credit cards or bank accounts on your www.ssactivewear.com account.
Resource URL:
GET     https://api.ssactivewear.com/v2/paymentprofiles/?email={email}
Request Options:
Get All	/v2/paymentprofiles/?email=test@abc.com	Returns all payment profiles
Response Format	/v2/paymentprofiles/?email=test@abc.com&mediatype={mediatype}/v2/paymentprofiles/?email=test@abc.com&mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/paymentprofiles/?email=test@abc.com
Response:
[
 [
  {
    "profileID": 123456789,
    "profileType": "Credit Card",
    "name": "BMO Harris Bank 1234 (John Doe)"
  }
 ]
]
Category Object Definition:
profileID	Integer	Unique ID for this payment profile (used in POST - Orders)
profyleType	String	Credit Card or Bank.
name	String	Logical name for the payment profile.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use



GET - Invoices
The Invoices API gives information about orders which have been invoiced in the form of PDF documents.
Resource URL:
GET     https://api.ssactivewear.com/v2/Invoices/
Request Options:
Get by Invoice Number	/v2/Invoices/{invoicenumber}
/v2/Invoices/83713072	Returns a PDF Invoice of the order with the given invoice number.
Get by Order GUID	/v2/Invoices/?Guid={guid}
/v2/Brands/?Guid=54d61c23-2b42-4021-ae34-5e6bba9eb36a	Returns a PDF Invoice of the order with the given order GUID.
Get by Order Number	/v2/Invoices/?OrderNumber={ordernumber}
/v2/Brands/?OrderNumber=61519822	Returns a PDF document with all of the Invoices with the given order number.
Example Request:
GET     https://api.ssactivewear.com/v2/Invoices/83713072
Response Body:
PDF Document
Response Headers:
ContentType	application/pdf
ContentDisposition	attachment
ContentDisposition FileName	If by Invoice Number or Order GUID, {warehousename}_Invoice_{invoicenumber}.pdf
If by Order Number, {companyname}_Invoice_{ordernumber}.pdf
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use


GET - CrossRef
The CrossRef API allows visibility to what skus you have mapped to "Your Sku".
Resource URL:
GET     https://api.ssactivewear.com/v2/crossref/
Request Options:
Get All	/v2/crossref/	Returns all Cross References
Filter Results	/v2/crossref/{yoursku}/v2/crossref/TestPartNumber	Returns CrossReferences matching filter condition

{yoursku} = is a comma separated list of Cross Reference identifiers
Filter Fields	/v2/crossref/?fields={fields}/v2/crossref/TestPartNumber?fields=YourSku,BrandName,StyleName,ColorNameSizeName	Returns only the fields that you request

{fields} = is a comma separated list of style object fields
Response Format	/v2/crossref/?mediatype={mediatype}/v2/crossref/?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/crossref/G2000whtxl
Response:
[
   {
    "yourSku": "G2000whtxl",
    "skuID": 2345,
    "sku": "B00760003",
    "gtin": "00821780003735",
    "brandName": "Gildan",
    "styleName": "2000",
    "colorName": "White",
    "sizeName": "S"
  }
]
CrossRef Object Definition:
yourSku	String	Your Sku Number
skuID	Integer	Unique ID for this sku (does not change)
sku	String	Our sku number
gtin	String	Industry standard identifier used by all suppliers.
brandName	String	The brand that makes this style.
styleName	String	The style's name. Style names are unique within a brand.
colorName	String	The color of this product.
sizeName	String	Size name that the style belongs to.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

PUT - CrossRef
The CrossRef API allows modification to Sku Cross References.
Resource URL:
PUT     https://api.ssactivewear.com/v2/crossref/
Request Definition:
yourSku	String	Your Sku number

Limitations:
May only contain the following characters: A-Z,0-9,a-z,-,_,SPACE
identifier	String	SkuID, Sku, Gtin
*Bold items are required
Example Request:
PUT     https://api.ssactivewear.com/v2/crossref/G2000whtxl?Identifier=B00760003
Response:
You will receive one of the following HTTP status codes:
200 OK. If you updated a record
201 Created. If you created a record
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

DELETE - CrossRef
The CrossRef API allows deletions to Sku Cross References.
Resource URL:
DELETE     https://api.ssactivewear.com/v2/crossref/
Request Options:
yourSku	String	Your Sku number

Limitations:
May only contain the following characters: A-Z,0-9,a-z,-,_,SPACE
*Bold items are required
Example Request:
DELETE     https://api.ssactivewear.com/v2/crossref/G2000whtxl
Response:
You will receive a HTTP status code "204 No Content" for this request.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use

GET - DaysInTransit
The daysintransit API gives days in transit and cutoff times for our warehouses.
Resource URL:
GET     https://api.ssactivewear.com/v2/daysintransit/
Request Options:
Get All	/v2/daysintransit/	Returns all categories
Filter Results	/v2/daysintransit/{category}
/v2/daysintransit/60440	Returns categories matching filter condition

{daysintransit} = is a comma separated list of category identifiers
identifiers = zipcode
Response Format	/v2/daysintransit/60440?mediatype={mediatype}/v2/daysintransit/60440?mediatype=json	Determines the response type

{mediatype} = json or xml (Default=json)
Example Request:
GET     https://api.ssactivewear.com/v2/daysintransit/60440
Response:
[
 {
  "zipCode": "60440",
  "warehouses": [
   {
    "warehouseAbbr": "IL",
    "cutOffTime": "4:00 CT",
    "daysInTransit": 1
   },
   {
    "warehouseAbbr": "NJ",
    "cutOffTime": "4:00 ET",
    "daysInTransit": 3
   },
   {
    "warehouseAbbr": "KS",
    "cutOffTime": "4:00 CT",
    "daysInTransit": 2
   }
  ],
  "warehouseAbbr": "NV",
  "cutOffTime": "4:00 PT",
  "daysInTransit": 4
 }
]
DaysInTransit Object Definition:
zipCode	String	Postal Zip Code
warehouses	Object
warehouseAbbr	String	Code that defines
cutOffTime	String	Time your order must be placed by to ship the same day.
daysInTransit	Integer	Amount of days it will take for your order to be delivered.
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use


The tracking API gives the current shipping status of an order.
Resource URL:
GET     https://api.ssactivewear.com/v2/TrackingDataGetAll/
Request Options:
By Invoice Number	GET     https://api.ssactivewear.com/v2/TrackingDataByInvoice/##,##
(Can request multiple invoice numbers. Must be in a comma separated list)	Return tracking data for invoice numbers provided.
By Order Number	GET     https://api.ssactivewear.com/v2/TrackingDataByOrderNum/##,##
(Can request multiple order numbers. Must be in a comma separated list)	Return tracking data for order numbers provided.
By Ship Date	GET     https://api.ssactivewear.com/v2/TrackingDataByShipDate/yyyy-mm-dd,yyyy-mm-dd
(Can request multiple ship dates. Must be in a comma separated list)	Return tracking data for ship dates provided.
By Shipping Date Range	GET     https://api.ssactivewear.com/v2/TrackingDataByShippingDateRange/yyyy-mm-dd,yyyy-mm-dd
(Enter a start and end date separated by a comma)	Return tracking data for range of ship dates.
By Tracking Number	GET     https://api.ssactivewear.com/v2/TrackingDataByTrackingNum/##,##
(Can request multiple tracking numbers. Must be in a comma separated list)	Return tracking data for tracking numbers provided.
By Actual delivery Date	GET     https://api.ssactivewear.com/v2/TrackingDataByActualDeliveryDate/yyyy-mm-dd,yyyy-mm-dd
(Can request multiple ship dates. Must be in a comma separated list)	Return tracking data for orders that arrived on the date requested.
Example Request:
GET     https://api.ssactivewear.com/v2/TrackingDataByOrderNum/32526736,32526740
Response:
[
   [
    {
        "carrierName": "USPS",
        "trackingNumber": "9400111898524897753577",
        "origin": "MCDONOUGH, GA",
        "actualDeliveryDateTime": "2021-05-10T16:11:00",
        "signedBy": "No information from carrier.",
        "latestCheckpoint": {
            "checkpointDate": "5/10/2021",
            "checkpointTime": "4:11 PM",
            "checkpointLocation": "MARSING, ID, US",
            "checkpointStatusMessage": "Delivered - Your item was delivered at 4:11 pm on May 10, 2021 in MARSING, ID 83639."
        },
        "orderNumber": "32526736",
        "invoiceNumber": "43937002"
    }
]
Looking for our customer site? Head to www.ssactivewear.com to view our products.

Terms of Use
