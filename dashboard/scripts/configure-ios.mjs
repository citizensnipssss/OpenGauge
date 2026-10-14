import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const path = 'ios/App/App/Info.plist';
let xml = readFileSync(path, 'utf8');
if (!xml.includes('<key>NSLocalNetworkUsageDescription</key>')) {
  xml = xml.replace('<dict>', `<dict>
\t<key>NSLocalNetworkUsageDescription</key>
\t<string>OpenGauge connects to your ESP32 on OpenGauge Wi-Fi to display live vehicle sensor readings and install device updates.</string>`);
}
if (!xml.includes('<key>NSAppTransportSecurity</key>')) {
  xml = xml.replace('<dict>', `<dict>
\t<key>NSAppTransportSecurity</key>
\t<dict>
\t\t<key>NSAllowsLocalNetworking</key>
\t\t<true/>
\t</dict>`);
} else if (!xml.includes('<key>NSAllowsLocalNetworking</key>')) {
  throw new Error('Existing ATS configuration needs manual review; add NSAllowsLocalNetworking=true.');
}
writeFileSync(path, xml);
// Include the Filesystem required-reason manifest in the app resource phase.
const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
let project = readFileSync(projectPath, 'utf8');
if (!existsSync('ios/App/App/PrivacyInfo.xcprivacy')) {
  writeFileSync('ios/App/App/PrivacyInfo.xcprivacy', `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyCollectedDataTypes</key><array/>
<key>NSPrivacyAccessedAPITypes</key><array><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
</dict></array></dict></plist>`);
}
if (!project.includes('VERSIONING_SYSTEM = apple-generic;')) {
  project = project.replaceAll('CURRENT_PROJECT_VERSION = 1;', 'CURRENT_PROJECT_VERSION = 1;\n\t\t\t\tVERSIONING_SYSTEM = apple-generic;');
}
if (!project.includes('PrivacyInfo.xcprivacy')) {
  const ref = 'A0E000000000000000000001', build = 'A0E000000000000000000002';
  project = project.replace('/* Begin PBXBuildFile section */', `/* Begin PBXBuildFile section */\n\t\t${build} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${ref}; };`);
  project = project.replace('/* Begin PBXFileReference section */', `/* Begin PBXFileReference section */\n\t\t${ref} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`);
  project = project.replace('504EC3061FED79650016851F /* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (', `504EC3061FED79650016851F /* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t${ref} /* PrivacyInfo.xcprivacy */,`);
  project = project.replace('504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,', `${build} /* PrivacyInfo.xcprivacy in Resources */,\n\t\t\t\t504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,`);
}
writeFileSync(projectPath, project);
console.log('Configured iOS local network permission and local-only ATS allowance.');
