// Optional distribution profile. The standard Windows build keeps every engine.
function createWindowsLiteProfile(build) {
  const profile = structuredClone(build);
  if (!Array.isArray(profile.win?.extraResources)) throw new Error('Windows engine resources are required');
  profile.win.extraResources = profile.win.extraResources.filter(resource => resource.to !== 'docstructure');
  profile.extraMetadata = { ...profile.extraMetadata, engineProfile: 'lite' };
  profile.artifactName = '${productName}-Lite-Setup-${version}-${arch}.${ext}';
  return profile;
}
module.exports = { createWindowsLiteProfile };
