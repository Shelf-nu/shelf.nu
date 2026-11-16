module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          // The app uses neither Reanimated nor worklets. expo-router's
          // drawer still brings them into node_modules as peers, and the
          // preset adds its worklet transform whenever it can resolve them,
          // which rewrites `.value` reads in styles. package.json's
          // `expo.autolinking.exclude` keeps their native code out as well.
          reanimated: false,
          worklets: false,
        },
      ],
    ],
  };
};
