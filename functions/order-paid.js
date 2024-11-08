const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = '4aaec3-2';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

exports.handler = async (event) => {
  let currentBalance = 0;  // currentBalance'ı burada tanımlıyoruz
  let newBalance = 0;      // newBalance'ı da burada tanımlıyoruz

  try {
    if (!event.body) {
      console.log('No body received');
      return { statusCode: 400, body: 'No body' };
    }

    const data = JSON.parse(event.body);
    console.log('Shop name:', SHOP_NAME);
    console.log('Access token:', ACCESS_TOKEN ? 'Present' : 'Missing');

    const customerId = data.customer && data.customer.id;
    if (!customerId) {
      console.log('No customer ID found in order');
      return { statusCode: 400, body: 'No customer ID' };
    }

    console.log('Customer ID:', customerId);

    let jetonMiktari = 0;
    if (data.line_items && Array.isArray(data.line_items)) {
      console.log('Processing line items:', data.line_items.length);
      
      for (const item of data.line_items) {
        console.log('Processing item:', item.title);
        
        const title = (item.title || '').toLowerCase();
        const variant = (item.variant_title || '').toLowerCase();
        const fullTitle = `${title} ${variant}`.toLowerCase();
        
        console.log('Item details:', { title, variant, fullTitle });

        const numbers = fullTitle.match(/\d+/);
        if (numbers) {
          const number = parseInt(numbers[0]);
          if (!isNaN(number)) {
            jetonMiktari += number;
            console.log('Found token amount:', number);
          }
        }
      }
    }

    console.log('Total calculated tokens:', jetonMiktari);

    if (jetonMiktari > 0) {
      console.log('Fetching current balance...');
      const getMetafield = await fetch(
        `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${customerId}/metafields.json`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ACCESS_TOKEN
          }
        }
      );

      if (getMetafield.ok) {
        const metafields = await getMetafield.json();
        console.log('Current metafields:', metafields);
        
        const jetonMetafield = metafields.metafields.find(
          m => m.namespace === 'custom' && m.key === 'jeton_bakiyesi'
        );
        
        if (jetonMetafield) {
          currentBalance = parseInt(jetonMetafield.value) || 0;
        }
      } else {
        console.log('Failed to fetch current balance:', await getMetafield.text());
      }

      newBalance = currentBalance + jetonMiktari;
      console.log('Balance update:', {
        currentBalance,
        jetonMiktari,
        newBalance
      });

      console.log('Updating balance...');
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
      console.log('Balance update result:', result);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Success',
        jetonMiktari,
        customerId,
        currentBalance,
        newBalance
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack
      })
    };
  }
};