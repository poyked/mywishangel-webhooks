const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = '4aaec3-2';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

exports.handler = async (event) => {
    let currentBalance = 0;
    let newBalance = 0;

    try {
        console.log('Received event:', {
            method: event.httpMethod,
            headers: event.headers,
            body: event.body
        });

        if (!event.body) {
            console.log('No body received');
            return { statusCode: 400, body: 'No body' };
        }

        // Determine if this is a wish request
        const isWishRequest = event.headers['x-wish-request'] === 'true';
        
        if (isWishRequest) {
            console.log('Processing wish request');
            const wishData = JSON.parse(event.body);
            console.log('Wish data:', wishData);

            if (!wishData.customerId || !wishData.dilek) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Geçersiz dilek verisi' })
                };
            }

            // Check current balance
            console.log('Checking balance for customer:', wishData.customerId);
            const getMetafield = await fetch(
                `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${wishData.customerId}/metafields.json`,
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
                    
                    if (currentBalance < 1) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'Yetersiz jeton bakiyesi' })
                        };
                    }

                    // Decrease balance by 1
                    newBalance = currentBalance - 1;
                    console.log('Updating balance:', { currentBalance, newBalance });

                    // Update balance
                    const updateBalance = await fetch(
                        `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${wishData.customerId}/metafields.json`,
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

                    if (!updateBalance.ok) {
                        const errorText = await updateBalance.text();
                        console.error('Balance update error:', errorText);
                        throw new Error('Bakiye güncellenemedi');
                    }

                    // Save the wish
                    console.log('Saving wish');
                    const wishResult = await fetch(
                        `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${wishData.customerId}/metafields.json`,
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
                                    value: JSON.stringify({
                                        dilekler: [
                                            ...(JSON.parse(jetonMetafield.dilekler || '{"dilekler":[]}').dilekler || []),
                                            {
                                                dilek: wishData.dilek,
                                                tarih: new Date().toISOString()
                                            }
                                        ]
                                    }),
                                    type: 'json_string'
                                }
                            })
                        }
                    );

                    if (!wishResult.ok) {
                        console.error('Wish save error:', await wishResult.text());
                    }

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
        } else {
            // Handle order paid webhook
            console.log('Processing order paid webhook');
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
        console.error('Detailed Error:', {
            message: error.message,
            stack: error.stack,
            event: {
                body: event.body,
                headers: event.headers
            }
        });
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                details: 'Lütfen log kayıtlarını kontrol edin',
                time: new Date().toISOString()
            })
        };
    }
};