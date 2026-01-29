# v1.1.0

## Added
- Added support for retrying when the page returned content successfully but had an erroneous HTTP status code (4xx or 5xx).
    - The page load is now only considered successful if both the navigation and its corresponding web request succeed.

## Changed
- Some service worker messages are now only sent with the `debug` console verbosity.
- The extension now requires the `webRequest` permission as well as access to all URLs.

# v1.0.1

## Changed
- Reduced the default retry interval to improve user experience.

# v1.0.0

Initial release.