/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  webpack(config) {
    // Find and remove the existing Next.js SVG rule
    const fileLoaderRule = config.module.rules.find(
      (/** @type {any} */ rule) => rule.test?.test?.(".svg"),
    );
    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...(fileLoaderRule.resourceQuery?.not || []), /url/] },
        use: [
          {
            loader: "@svgr/webpack",
            options: {
              svgo: true,
              svgoConfig: {
                plugins: [
                  {
                    name: "preset-default",
                    params: {
                      overrides: {
                        // Keep viewBox so SVGs scale with CSS
                        removeViewBox: false,
                      },
                    },
                  },
                  // Remove width/height attributes so CSS controls sizing
                  "removeDimensions",
                  // Prefix IDs to avoid clipPath/mask collisions
                  "prefixIds",
                ],
              },
            },
          },
        ],
      },
    );
    // Modify the file loader rule to ignore *.svg
    fileLoaderRule.exclude = /\.svg$/i;
    return config;
  },
};

export default config;
