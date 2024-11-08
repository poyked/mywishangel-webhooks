const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = 'mywishangel';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

exports.handler = async (event) => {
 try {
   console.log('Received webhook:', event.body);
   
   if (!event.body) {
     return { statusCode: 400, body: 'No body' };
   }

   const data = JSON.parse(event.body);
   console.log('Parsed order data:', data);

   // Test için log ekleyelim
   console.log('Shop name:', SHOP_NAME);
   console.log('Access token:', ACCESS_TOKEN ? 'Present' : 'Missing');

   const customerId = data.customer && data.customer.id;
   if (!customerId) {
     console.log('No customer ID found in order');
     return { statusCode: 400, body: 'No customer ID' };
   }

   let jetonMiktari = 0;
   // Ürünleri kontrol et
   for (const item of data.line_items || []) {
     // Ürün başlığını ve varyant başlığını kontrol et
     const title = (item.title || '').toLowerCase();
     const variant = (item.variant_title || '').toLowerCase();
     const fullTitle = `${title} ${variant}`.toLowerCase();
     
     // Debug için log ekleyelim
     console.log('Processing item:', { title, variant, fullTitle });

     // Sayıyı bul
     const numbers = fullTitle.match(/\d+/);
     if (numbers) {
       const number = parseInt(numbers[0]);
       if (!isNaN(number)) {
         jetonMiktari += number;
         console.log('Found token amount:', number);
       }
     }
   }

   console.log('Calculated tokens:', jetonMiktari);

   if (jetonMiktari > 0) {
     // Önce mevcut bakiyeyi al
     const getMetafield = await fetch(
       `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${customerId}/metafields.json`,
       {
         headers: {
           'Content-Type': 'application/json',
           'X-Shopify-Access-Token': ACCESS_TOKEN
         }
       }
     );

     let currentBalance = 0;
     if (getMetafield.ok) {
       const metafields = await getMetafield.json();
       const jetonMetafield = metafields.metafields.find(
         m => m.namespace === 'custom' && m.key === 'jeton_bakiyesi'
       );
       if (jetonMetafield) {
         currentBalance = parseInt(jetonMetafield.value) || 0;
       }
     }

     const newBalance = currentBalance + jetonMiktari;
     console.log('Current balance:', currentBalance);
     console.log('New balance:', newBalance);

     // Bakiyeyi güncelle
     const response = await fetch(
       `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${customerId}/metafields.json`,
       {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'X-Shopify-Access-Token': ACCESS_TOKEN
         },
         body: JSON.stringify({
           metafield: {
             namespace: 'custom',
             key: 'jeton_bakiyesi',
             value: newBalance.toString(),
             type: 'number_integer'
           }
         })
       }
     );

     if (!response.ok) {
       const errorText = await response.text();
       console.error('Shopify API Error:', errorText);
       throw new Error(`Shopify API Error: ${response.status} ${errorText}`);
     }

     const result = await response.json();
     console.log('Metafield update result:', result);
   }

   return {
     statusCode: 200,
     body: JSON.stringify({ 
       message: 'Success',
       jetonMiktari: jetonMiktari,
       customerId: customerId
     })
   };
 } catch (error) {
   console.error('Error:', error);
   return {
     statusCode: 500,
     body: JSON.stringify({ error: error.message })
   };
 }
};