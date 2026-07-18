# Capture fixtures

Place raw Apple WLOC response captures here as `.bin` files (raw response body bytes),
alongside a matching `.json` metadata file describing the capture context, e.g.:

```json
{
  "source": "surge-mitm-capture",
  "capturedAt": "2026-07-18T12:00:00Z",
  "device": "iPhone 15 Pro, iOS 26.3",
  "note": "Captured via Surge MITM on gs-loc.apple.com/clls/wloc",
  "expectedFieldLayout": "field 2 (location submessage) contains field 1 (lat) and field 2 (lng) as zigzag varints scaled by 1e8"
}
```

Do not commit real device identifiers, MAC addresses, or personally identifying capture data.
Redact BSSID/location lists before committing — only the response tail relevant to coordinate
fields should be kept for test purposes.
