// App Intents launch a page through the same validated deep-link path as notifications.
// Extend this plugin with native modules/extension targets when adding activities/widgets.
const {withDangerousMod,withXcodeProject} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const identity = require('../app-identity.json');
module.exports = function withNativeShortcuts(config) {
  config=withDangerousMod(config,['ios',async mod=>{
    const projectName=mod.modRequest.projectName;
    const directory=path.join(mod.modRequest.platformProjectRoot,projectName);
    fs.writeFileSync(path.join(directory,'NativeShortcuts.swift'),`
import AppIntents
import Foundation

@available(iOS 18.0, *)
struct OpenMainExperienceIntent: AppIntent {
  static var title: LocalizedStringResource = "Open ${identity.name}"
  static var description = IntentDescription("Open ${identity.name} and continue where you left off.")
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult & OpensIntent {
    return .result(opensIntent: OpenURLIntent(URL(string: "${identity.scheme}:/${identity.entry}")!))
  }
}

@available(iOS 18.0, *)
struct NativeAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenMainExperienceIntent(), phrases: ["Open \\(.applicationName)"], shortTitle: "Open ${identity.name}", systemImageName: "${identity.repo === 'Lacuna' ? 'text.book.closed' : 'music.note'}")
  }
}
`);
    return mod;
  }]);
  return withXcodeProject(config,mod=>{
    const project=mod.modResults;
    const projectName=mod.modRequest.projectName;
    const file=projectName+'/NativeShortcuts.swift';
    const group=project.findPBXGroupKey({name:projectName}) || project.findPBXGroupKey({path:projectName});
    if(!project.hasFile(file)) project.addSourceFile(file,{target:project.getFirstTarget().uuid},group);
    return mod;
  });
};
