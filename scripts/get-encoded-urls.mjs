const urls = {
  home: 'http://localhost:3131/',
  categories: 'http://localhost:3131/categories',
  cat: 'http://localhost:3131/c/01a1503f-6e9f-79b4-83ed-29f57961efb1/' + encodeURIComponent('أفطار'),
  sub: 'http://localhost:3131/c/01a1503f-7489-78df-b5bc-76aa0e0c9b86/' + encodeURIComponent('حلاوة-وطحينة-ومربى'),
  product: 'http://localhost:3131/p/01a1503f-7d6b-7e51-811d-f8686c605e72/' + encodeURIComponent('دريم-فانليا'),
  search: 'http://localhost:3131/search?q=' + encodeURIComponent('نسكافيه'),
  cart: 'http://localhost:3131/cart',
  checkout: 'http://localhost:3131/checkout',
  admin: 'http://localhost:3131/admin',
};
for (const [k,v] of Object.entries(urls)) console.log(k, v);
