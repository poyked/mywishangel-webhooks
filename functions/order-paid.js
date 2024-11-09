const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = '4aaec3-2';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

exports.handler = async (event) => {
  let currentBalance = 0;
  let newBalance = 0;

  try {
    if (!event.body) {
      return { statusCode: 400, body: 'No body' };
    }

    // İsteğin tipini kontrol et
    const isWishRequest = event.headers['x-wish-request'] === 'true';
    
    if (isWishRequest) {
      // Dilek isteği işleme
      const wishData = JSON.parse(event.body);
      const customerId = wishData.customerId;

      // Mevcut bakiyeyi kontrol et
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
        const jetonMetafield = metafields.metafields.find(
          m => m.namespace === 'custom' && m.key === 'jeton_bakiyesi'
        );
        
        if (jetonMetafield) {
          currentBalance = parseInt(jetonMetafield.value) || 0;
          
          if (currentBalance < 1) {
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'Yetersiz jeton bakiyesi' })
            };
          }

          // Bakiyeden 1 jeton düş
          newBalance = currentBalance - 1;

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
            throw new Error('Bakiye güncellenemedi');
          }

          // Dileği kaydet
          // Burada dileği kaydetmek için ayrı bir metafield oluşturabiliriz
          const wishResponse = await fetch(
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
                  key: 'dilekler',
                  value: JSON.stringify([
                    ...(jetonMetafield.dilekler || []),
                    {
                      dilek: wishData.dilek,
                      tarih: new Date().toISOString()
                    }
                  ]),
                  type: 'json_string'
                }
              })
            }
          );

          return {
            statusCode: 200,
            body: JSON.stringify({
              message: 'Dilek başarıyla kaydedildi',
              newBalance
            })
          };
        }
      }

      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Kullanıcı bakiyesi bulunamadı' })
      };
    }

  

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