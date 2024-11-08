const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = 'mywishangel'; // Shopify mağaza adınız
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
      if (item.title.includes('Jeton')) {
        if (item.title.includes('5')) jetonMiktari += 5;
        if (item.title.includes('10')) jetonMiktari += 10;
        if (item.title.includes('20')) jetonMiktari += 20;
        if (item.title.includes('50')) jetonMiktari += 50;
      }
    }

    console.log('Calculated tokens:', jetonMiktari);

    if (jetonMiktari > 0) {
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
              value: jetonMiktari.toString(),
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
        jetonMiktari: jetonMiktari
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