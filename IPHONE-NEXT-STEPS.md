# OpenGauge iPhone cloud build

The prepared source is in `work/OpenGauge-revised`, with `codemagic.yaml` at its root and `dashboard` alongside it.

1. Connect that source repository to Codemagic. The repaired workspace source includes newer changes than the public GitHub main branch; building public main will not include this work.
2. Run `ios-compile-check` first. This compiles on a cloud Mac without signing credentials. Its simulator app cannot be installed on an iPhone.
3. For an installable build, configure Apple Developer signing for `com.citizensnipssss.opengauge`, create the matching App Store Connect app record, and run `ios-signed`.
4. Upload the signed IPA to App Store Connect/TestFlight using the provider's configured Apple integration. The current workflow produces an IPA; it does not automatically publish it.
5. Install through TestFlight and check local-network permission, Test connection, live gauges, reconnect and background/foreground behavior on the real phone.

No Apple credentials are stored in these source files. No cloud build, repository upload or TestFlight distribution has been performed yet.
