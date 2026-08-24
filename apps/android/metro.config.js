const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Workspace packages use NodeNext-style `.js` specifiers while shipping TS source.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // Fall through so genuine JavaScript files retain Metro's normal behavior.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
