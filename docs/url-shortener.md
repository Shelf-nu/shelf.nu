# URL Shortener

> [!WARNING]
> Once generated with a shortened url, your QRs cannot be changed. Make sure you always keep your shortener domain.

The url shortener functionality allows you to make your QR codes hold less data, thus making them more readable.
The redirection is handled via the `urlShortener` middleware.

## How to use it?

Using the shortener is super easy.

1. Add an env variable with your shortner domain: `URL_SHORTENER="eam.sh"`. You can refer to `.env.example` for further example. The domain should not include the protocol (http/https) or a trailing slash
2. Make sure you point your short domain to your application server
3. Enjoy

## How does it work?

1. When a request is received starting with the shortened url, it gets handled by the `urlShortener` middleware
2. The following conditions need to be met for the middleware to redirect to a QR code. In the rest of the cases, it just redirects to app root.
   - The path should NOT include any special characters
   - The path should start with a small letter
   - The path should only have small letters and optional number
   - The path's length should fit within the allowed character lengths(10 for new and 25 for legacy QR codes)
