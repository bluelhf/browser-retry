![Promotional image for Browser Retry with tabs and a refresh icon](assets/promotional/promotional-440.png)
# Browser Retry
Browser Retry is an extension for Google Chrome and Mozilla Firefox that automatically reloads tabs when they fail to load.

No configuration is needed from the user; after a failed tab load, another attempt is automatically scheduled shortly. If the tab still does not load, further timeouts become exponentially longer, up to a maximum of one minute. The timeout duration is reset after a successful page load, or if the browser is restarted.

## Not for General Use

This extension is primarily aimed at developers who, for example, have a kiosk web app that needs to be resistant to server failures. There is no way to control the rate of the reloads nor the pages on which they apply; the extension will happily reload any page anywhere, even pages that never existed in the first place.

<img src="assets/screenshots/screenshot-1200.png" width="1200" alt="Screenshot of Browser Retry's debugger">
