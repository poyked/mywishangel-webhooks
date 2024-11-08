const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

exports.handler = async (event) => {
  try {
    if (!event.body) {
      return { statusCode: 400, body: 'No body' };
    }

    const data = JSON.parse(event.body);
    console.log('Received order:', data);

    const lineItems = data.line_items || [];
    for (const item of lineItems) {
      if (item.title.includes('Jeton')) {
        let jetonMiktari = 0;
        
        if (item.title.includes('5')) jetonMiktari = 5;
        if (item.title.includes('10')) jetonMiktari = 10;
        if (item.title.includes('20')) jetonMiktari = 20;
        if (item.title.includes('50')) jetonMiktari = 50;

        const customerId = data.customer.id;
        await updateCustomerBalance(customerId, jetonMiktari);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Success' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process order' })
    };
  }
};

async function updateCustomerBalance(customerId, jetonMiktari) {
  const SHOP_NAME = 'mywishangel';
  const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

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
    throw new Error('Failed to update customer balance');
  }

  return await response.json();
}