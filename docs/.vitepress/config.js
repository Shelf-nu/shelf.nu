export default {
  title: "shelf.nu Documentation",
  description: "Open source asset management platform documentation",
  base: "/",

  // Clean URLs (remove .html extension)
  cleanUrls: true,

  // Favicon
  head: [["link", { rel: "icon", href: "/favicon.ico" }]],

  // Isolate VitePress from main app
  vite: {
    // Don't process the main app
    exclude: ["../app/**", "../server/**", "../public/**"],
    // Only include docs-related files
    include: ["**/*.md", "**/*.vue"],
    // Reset resolve to avoid conflicts with main app
    resolve: {
      alias: {},
    },
  },

  // Markdown configuration (merged from duplicate keys)
  markdown: {
    // Line numbers in code blocks
    lineNumbers: true,
    // Configure languages for syntax highlighting
    languages: [
      "js",
      "ts",
      "json",
      "bash",
      "shell",
      "yaml",
      "sql",
      "html",
      "css",
      "tsx",
      "jsx",
    ],
  },

  themeConfig: {
    // Logo in navigation bar
    logo: "/shelf-logo.png",

    // Alternative: Logo with different sizes
    // logo: {
    //   light: '/shelf-logo-light.png',
    //   dark: '/shelf-logo-dark.png'
    // },

    // Search configuration to handle duplicates
    search: {
      provider: "local",
    },

    // Navigation bar
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/local-development" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/Shelf-nu/shelf.nu" },
          { text: "Discord", link: "https://discord.gg/gdPMsSzqCS" },
          { text: "Website", link: "https://shelf.nu" },
        ],
      },
    ],

    // Sidebar navigation
    sidebar: [
      {
        text: "🚀 Getting Started",
        collapsed: false,
        items: [
          { text: "Local Development", link: "/local-development" },
          { text: "Supabase Setup", link: "/supabase-setup" },
          { text: "Deployment", link: "/deployment" },
          { text: "Docker Setup", link: "/docker" },
        ],
      },
      {
        text: "⚙️ Configuration",
        collapsed: true,
        items: [
          { text: "App Configuration", link: "/shelf.config.ts" },
          { text: "Error Handling", link: "/handling-errors" },
          { text: "URL Shortener", link: "/url-shortener" },
        ],
      },
      {
        text: "🗄️ Database",
        collapsed: true,
        items: [
          { text: "Asset Search", link: "/asset-search" },
          { text: "Database Triggers", link: "/database-triggers" },
          { text: "Protected Indexes", link: "/protected-indexes" },
        ],
      },
      {
        text: "🛠️ Development",
        collapsed: true,
        items: [{ text: "Utility Hooks", link: "/hooks" }],
      },
      {
        text: "📊 Advanced Features",
        collapsed: true,
        items: [
          {
            text: "Advanced Asset Index",
            link: "/advanced-index/",
            items: [
              {
                text: "Filtering Guide",
                link: "/advanced-index/advanced-filtering-guide",
              },
              {
                text: "Sorting Guide",
                link: "/advanced-index/advanced-sorting-guide",
              },
              {
                text: "Natural Sorting",
                link: "/advanced-index/natural-sorting-explanation",
              },
              {
                text: "Index Settings",
                link: "/advanced-index/asset-index-settings",
              },
            ],
          },
        ],
      },
      {
        text: "👥 Client Guides",
        collapsed: true,
        items: [
          {
            text: "Single Sign-On Setup",
            link: "/sso/",
            items: [
              {
                text: "Google Workspace",
                link: "/sso/providers/google-workspace",
              },
              {
                text: "Microsoft Entra",
                link: "/sso/providers/microsoft-entra",
              },
            ],
          },
        ],
      },
    ],

    // Social links in top nav
    socialLinks: [
      { icon: "github", link: "https://github.com/Shelf-nu/shelf.nu" },
      { icon: "discord", link: "https://discord.gg/gdPMsSzqCS" },
    ],

    // Edit this page link
    editLink: {
      pattern: "https://github.com/Shelf-nu/shelf.nu/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    // Footer
    footer: {
      message: "Released under the AGPL-3.0 License.",
      copyright: "Copyright © 2024 Shelf Asset Management Inc.",
    },
  },
};
