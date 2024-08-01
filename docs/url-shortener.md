# URL Shortener

> [!WARNING]
> Once generated with a shortened url, your QRs cannot be changed. Make sure you always keep your shortener domain.

The url shortener functionality allows you to make your QR codes hold less data, thus making them more readable.
The redirection is handled via the `urlShortener` middleware.

Using the shortener is super easy.

1. Add an env variable with your shortner domain: `URL_SHORTENER="hey.lo"`. You can refer to `.env.example` for further example. The domain should not include the protocol (http/https) or a trailing slash
2. Make sure you point your short domain to your application server
3. Enjoy
