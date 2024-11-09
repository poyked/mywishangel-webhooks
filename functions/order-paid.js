const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const SHOP_NAME = '4aaec3-2';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

exports.handler = async (event) => {
    let currentBalance = 0;
    let newBalance = 0;

    try {
        console.log('========== YENİ İSTEK ==========');
        console.log('İstek Detayları:', {
            method: event.httpMethod,
            path: event.path,
            headers: event.headers,
            body: event.body
        });

        if (!event.body) {
            console.log('Body boş geldi');
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'İstek body\'si boş' })
            };
        }

        // İsteğin türünü kontrol et
        const isWishRequest = event.headers['x-wish-request'] === 'true';
        console.log('İstek Türü:', isWishRequest ? 'Dilek İsteği' : 'Sipariş Webhook');

        const data = JSON.parse(event.body);
        
        if (isWishRequest) {
            console.log('Dilek isteği işleniyor:', data);

            if (!data.customerId || !data.dilek) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Müşteri ID veya dilek metni eksik' })
                };
            }

            // Mevcut bakiyeyi kontrol et
            const getMetafield = await fetch(
                `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${data.customerId}/metafields.json`,
                {
                    headers: {
                        'X-Shopify-Access-Token': ACCESS_TOKEN
                    }
                }
            );

            const metafields = await getMetafield.json();
            console.log('Mevcut metafields:', metafields);

            const jetonMetafield = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'jeton_bakiyesi'
            );

            if (!jetonMetafield || parseInt(jetonMetafield.value) < 1) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Yetersiz jeton bakiyesi' })
                };
            }

            currentBalance = parseInt(jetonMetafield.value);
            newBalance = currentBalance - 1;

            console.log('Bakiye güncelleniyor:', {
                currentBalance,
                newBalance
            });

            // Bakiyeyi güncelle
            const updateBalance = await fetch(
                `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${data.customerId}/metafields.json`,
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
                throw new Error('Bakiye güncellenemedi');
            }

            // Dileği kaydet
            const dileklerMetafield = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'dilekler'
            );

            let currentWishes = [];
            if (dileklerMetafield) {
                try {
                    const parsedWishes = JSON.parse(dileklerMetafield.value);
                    currentWishes = parsedWishes.dilekler || [];
                } catch (e) {
                    console.log('Mevcut dilekler parse edilemedi:', e);
                }
            }

            const newWish = {
                dilek: data.dilek,
                tarih: new Date().toISOString()
            };

            const saveWish = await fetch(
                `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${data.customerId}/metafields.json`,
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
                                dilekler: [...currentWishes, newWish]
                            }),
                            type: 'json_string'
                        }
                    })
                }
            );

            if (!saveWish.ok) {
                console.error('Dilek kaydedilemedi:', await saveWish.text());
                throw new Error('Dilek kaydedilemedi');
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Dilek başarıyla kaydedildi',
                    newBalance
                })
            };

        } else {
            // Sipariş webhook'u işleniyor
            console.log('Sipariş işleniyor:', data);

            const customerId = data.customer && data.customer.id;
            if (!customerId) {
                return { 
                    statusCode: 400, 
                    body: JSON.stringify({ error: 'Müşteri ID bulunamadı' })
                };
            }

            let jetonMiktari = 0;
            if (data.line_items && Array.isArray(data.line_items)) {
                for (const item of data.line_items) {
                    const title = (item.title || '').toLowerCase();
                    const variant = (item.variant_title || '').toLowerCase();
                    const fullTitle = `${title} ${variant}`.toLowerCase();
                    
                    console.log('Ürün işleniyor:', { title, variant, fullTitle });

                    const numbers = fullTitle.match(/\d+/);
                    if (numbers) {
                        const number = parseInt(numbers[0]);
                        if (!isNaN(number)) {
                            jetonMiktari += number;
                            console.log('Bulunan jeton miktarı:', number);
                        }
                    }
                }
            }

            console.log('Toplam jeton miktarı:', jetonMiktari);

            if (jetonMiktari > 0) {
                // Mevcut bakiyeyi kontrol et
                const getMetafield = await fetch(
                    `https://${SHOP_NAME}.myshopify.com/admin/api/2024-01/customers/${customerId}/metafields.json`,
                    {
                        headers: {
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
                        currentBalance = parseInt(jetonMetafield.value);
                    }
                }

                newBalance = currentBalance + jetonMiktari;
                console.log('Bakiye güncelleniyor:', {
                    currentBalance,
                    jetonMiktari,
                    newBalance
                });

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
                    throw new Error(`Bakiye güncellenemedi: ${errorText}`);
                }

                console.log('Bakiye güncellendi');
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'İşlem başarılı',
                    jetonMiktari,
                    newBalance
                })
            };
        }

    } catch (error) {
        console.error('Hata:', {
            message: error.message,
            stack: error.stack
        });
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Bir hata oluştu: ' + error.message
            })
        };
    }
};